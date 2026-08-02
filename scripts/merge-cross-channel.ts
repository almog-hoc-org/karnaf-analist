#!/usr/bin/env tsx
/**
 * MERGE cross-channel duplicates into one complete record.
 *
 * The same real transaction is collected by BOTH channels, each holding half the
 * fields:  nadlan = year_built (no street/floor) · govmap = street+floor (no
 * year_built).  They were never merged, so every such deal sat in the DB TWICE
 * (double-counting) and NO single row was complete.
 *
 * For each group  city + deal_date + round(price) + round(area) + round(rooms)
 * that has both a nadlan and a govmap row:
 *   1. ENRICH the nadlan row with street / house_num / floor from the govmap copy
 *      (only where the nadlan row is missing them) → one COMPLETE record:
 *      deal-year + build-year + area + floor + rooms + address.
 *   2. EXCLUDE the redundant govmap copy (excluded=1, reason 'מוזג …') via the
 *      existing reversible/logged pipeline → the double-count disappears.
 * Unique govmap rows (no nadlan twin — the deep history) are untouched.
 *
 * Scope: last 10 years only. Idempotent — first un-excludes its own prior marks.
 * Uses better-sqlite3 directly (75k+ groups) for a single fast transaction.
 *
 * Run: npx tsx scripts/merge-cross-channel.ts   (pipeline: FIRST, before flag/aggregate)
 */
import Database from "better-sqlite3";
import path from "path";

const YEARS_BACK = 10;
const REASON = "מוזג (כפילות בין-ערוצית)";

interface Row {
  id: number; city_name: string; deal_date: string; price: number; area: number; rooms: number;
  source: string; street: string | null; house_num: string | null; floor: number | string | null;
}

function main() {
  const db = new Database(path.resolve("./data/realestate.db"));
  db.pragma("journal_mode = WAL");   // concurrent reader (dev server) + writer (this script)
  db.pragma("busy_timeout = 60000"); // wait up to 60s for any transient lock
  const minYear = new Date().getFullYear() - YEARS_BACK;

  // 1. idempotent reset — un-exclude our own prior merge marks (in scope)
  const reset = db.prepare(
    `UPDATE nadlan_transactions SET excluded=0, exclusion_reason=NULL
     WHERE exclusion_reason LIKE 'מוזג%' AND deal_year >= ?`).run(minYear);

  // 2. load active, in-scope, keyable rows
  const rows = db.prepare(
    `SELECT id, city_name, deal_date, price, area, rooms, source, street, house_num, floor
     FROM nadlan_transactions
     WHERE COALESCE(excluded,0)=0 AND deal_year >= ? AND price>0 AND area>0 AND rooms>0`
  ).all(minYear) as Row[];

  // 3. group by the cross-channel key
  const groups = new Map<string, { nadlan: Row[]; govmap: Row[] }>();
  for (const r of rows) {
    const key = `${r.city_name}|${r.deal_date}|${Math.round(r.price)}|${Math.round(r.area)}|${Math.round(r.rooms)}`;
    let g = groups.get(key);
    if (!g) { g = { nadlan: [], govmap: [] }; groups.set(key, g); }
    if (r.source === "nadlan") g.nadlan.push(r);
    else if (r.source === "govmap") g.govmap.push(r);
  }

  // 4. merge inside a single transaction
  const enrich = db.prepare(
    `UPDATE nadlan_transactions SET street=COALESCE(street,?), house_num=COALESCE(house_num,?), floor=COALESCE(floor,?) WHERE id=?`);
  const exclude = db.prepare(`UPDATE nadlan_transactions SET excluded=1, exclusion_reason=? WHERE id=?`);
  let enriched = 0, excluded = 0, mergedGroups = 0;
  const run = db.transaction(() => {
    for (const g of groups.values()) {
      if (!g.nadlan.length || !g.govmap.length) continue;
      mergedGroups++;
      const donor = g.govmap.find((x) => x.street) ?? g.govmap[0]; // best address donor
      for (const n of g.nadlan) {
        if (!n.street && donor.street) { enrich.run(donor.street, donor.house_num, donor.floor, n.id); enriched++; }
      }
      for (const gm of g.govmap) { exclude.run(REASON, gm.id); excluded++; } // drop the duplicate copies
    }
  });
  run();

  if (excluded) db.prepare(
    `INSERT INTO admin_exclusion_log (action, affected, reason, created_at) VALUES ('exclude', ?, ?, datetime('now'))`
  ).run(excluded, REASON);

  // ── PASS 2 (soft): the strict key misses real twins over sub-m² area / rooms
  // disagreements between the two feeds. For nadlan rows STILL without an address,
  // match govmap by city+date+exact-price only, with an area tolerance of ≤2 m².
  // Guard: if candidate donors disagree on the street → skip (never guess).
  const SOFT_REASON = "מוזג (התאמה רכה — כפילות בין-ערוצית)";
  const targets = db.prepare(
    `SELECT id, city_name, deal_date, price, area FROM nadlan_transactions
     WHERE COALESCE(excluded,0)=0 AND deal_year >= ? AND source='nadlan' AND street IS NULL AND price>0 AND area>0`
  ).all(minYear) as Row[];
  // donors: every govmap row with an address (incl. ones excluded in pass 1 — address donation is harmless)
  const donors = db.prepare(
    `SELECT id, city_name, deal_date, price, area, street, house_num, floor, COALESCE(excluded,0) ex
     FROM nadlan_transactions WHERE deal_year >= ? AND source='govmap' AND street IS NOT NULL AND price>0 AND area>0`
  ).all(minYear) as (Row & { ex: number })[];
  const byLoose = new Map<string, (Row & { ex: number })[]>();
  for (const d of donors) {
    const k = `${d.city_name}|${d.deal_date}|${Math.round(d.price)}`;
    const a = byLoose.get(k); if (a) a.push(d); else byLoose.set(k, [d]);
  }
  let softEnriched = 0, softExcluded = 0, ambiguous = 0;
  const soft = db.transaction(() => {
    for (const t of targets) {
      const cands = (byLoose.get(`${t.city_name}|${t.deal_date}|${Math.round(t.price)}`) ?? [])
        .filter((d) => Math.abs(d.area - t.area) <= 2);
      if (!cands.length) continue;
      const streets = new Set(cands.map((d) => d.street));
      if (streets.size > 1) { ambiguous++; continue; } // conflicting addresses → don't guess
      const donor = cands[0];
      enrich.run(donor.street, donor.house_num, donor.floor, t.id);
      softEnriched++;
      for (const d of cands) if (!d.ex) { exclude.run(SOFT_REASON, d.id); d.ex = 1; softExcluded++; }
    }
  });
  soft();
  if (softExcluded) db.prepare(
    `INSERT INTO admin_exclusion_log (action, affected, reason, created_at) VALUES ('exclude', ?, ?, datetime('now'))`
  ).run(softExcluded, SOFT_REASON);

  console.log(`merge-cross-channel (last ${YEARS_BACK}y): reset ${reset.changes} prior · ` +
    `${mergedGroups.toLocaleString("en")} groups merged · ${enriched.toLocaleString("en")} nadlan rows enriched with address · ` +
    `${excluded.toLocaleString("en")} govmap duplicates excluded`);
  console.log(`  soft pass: +${softEnriched.toLocaleString("en")} addresses (area ≤2m² tolerance) · ` +
    `${softExcluded.toLocaleString("en")} more govmap copies merged · ${ambiguous.toLocaleString("en")} skipped (conflicting addresses)`);
  db.close();
}
main();
