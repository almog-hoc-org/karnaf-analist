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
import { ensureAuditLog } from "../lib/auditLog";
import { historyFromYear } from "../lib/historyWindow";
import { CITY_ALIASES } from "../lib/cityAliases";

// Window comes from the shared history floor (lib/historyWindow) — every
// stage must process the SAME range or later stages aggregate rows earlier
// stages never cleaned. Was a private `YEARS_BACK = 10` per script.
const REASON = "מוזג (כפילות בין-ערוצית)";

interface Row {
  id: number; city_name: string; deal_date: string; price: number; area: number; rooms: number;
  source: string; street: string | null; house_num: string | null; floor: number | string | null;
  neighborhood: string | null;
}

function main() {
  const db = new Database(path.resolve("./data/realestate.db"));
  db.pragma("journal_mode = WAL");
  ensureAuditLog(db); // seven writers, no owner — see lib/auditLog.ts   // concurrent reader (dev server) + writer (this script)
  db.pragma("busy_timeout = 60000"); // wait up to 60s for any transient lock
  const minYear = historyFromYear();

  // 0. canonical city names — BEFORE anything groups by city_name. "מכבים
  //    רעות" lived as a whole second city beside מודיעין-מכבים-רעות (own
  //    stats, own page) because nothing ever folded aliases in the raw data.
  //    Idempotent: rows already canonical don't match the WHERE.
  for (const [alias, canonical] of Object.entries(CITY_ALIASES)) {
    const r = db.prepare(`UPDATE nadlan_transactions SET city_name = ? WHERE city_name = ?`).run(canonical, alias);
    if (r.changes > 0) console.log(`alias: ${alias} → ${canonical} (${r.changes} rows)`);
  }

  // 1. idempotent reset — un-exclude our own prior merge marks (in scope)
  const reset = db.prepare(
    `UPDATE nadlan_transactions SET excluded=0, exclusion_reason=NULL
     WHERE exclusion_reason LIKE 'מוזג%' AND deal_year >= ?`).run(minYear);

  // 2-4 run PER CITY. Every grouping key below starts with city_name, so the
  // chunking changes nothing semantically — but it bounds memory to one city's
  // rows. Loading the whole 1998+ scope at once (1.4M rows with address
  // strings) blew Node's heap inside the 3GB container on the first full run.
  // neighborhood rides along with the address, under the same COALESCE rule.
  // This is a fact-copy, not inference: the donor is the SAME deal reported
  // through the govmap channel, which carries the neighbourhood the nadlan
  // channel long dropped. The same donation already existed inside duplicate
  // clusters (flag-duplicate-deals) — this extends it to the cross-channel
  // twins, which is most of the repository.
  const enrich = db.prepare(
    `UPDATE nadlan_transactions SET street=COALESCE(street,?), house_num=COALESCE(house_num,?), floor=COALESCE(floor,?), neighborhood=COALESCE(neighborhood,?) WHERE id=?`);
  // floor is a TEXT column (the feed returns Hebrew floor names as often as
  // digits). Donating a legacy integer would copy the defect onto a clean row,
  // and Prisma refuses to read a row whose text column holds a number — which
  // is a 500 on the whole city page, not a missing floor cell.
  const floorText = (v: number | string | null) => (v == null ? null : String(v));
  const exclude = db.prepare(`UPDATE nadlan_transactions SET excluded=1, exclusion_reason=? WHERE id=?`);
  const SOFT_REASON = "מוזג (התאמה רכה — כפילות בין-ערוצית)";
  const selectRows = db.prepare(
    `SELECT id, city_name, deal_date, price, area, rooms, source, street, house_num, floor, neighborhood
     FROM nadlan_transactions
     WHERE COALESCE(excluded,0)=0 AND deal_year >= ? AND city_name = ? AND price>0 AND area>0`);
  const selectTargets = db.prepare(
    `SELECT id, city_name, deal_date, price, area, street, neighborhood FROM nadlan_transactions
     WHERE COALESCE(excluded,0)=0 AND deal_year >= ? AND city_name = ? AND source='nadlan'
       AND (street IS NULL OR neighborhood IS NULL) AND price>0 AND area>0`);
  const selectDonors = db.prepare(
    `SELECT id, city_name, deal_date, price, area, street, house_num, floor, neighborhood, COALESCE(excluded,0) ex
     FROM nadlan_transactions WHERE deal_year >= ? AND city_name = ? AND source='govmap'
       AND (street IS NOT NULL OR neighborhood IS NOT NULL) AND price>0 AND area>0`);

  const cities = (db.prepare(
    `SELECT DISTINCT city_name FROM nadlan_transactions WHERE deal_year >= ?`
  ).all(minYear) as Array<{ city_name: string }>).map((c) => c.city_name);

  let enriched = 0, excluded = 0, mergedGroups = 0, hoodEnriched = 0;
  let softEnriched = 0, softExcluded = 0, ambiguous = 0;

  for (const city of cities) {
    // 2. load this city's active, in-scope, keyable rows
    const rows = selectRows.all(minYear, city) as Row[];

    // 3. group by the cross-channel key (city fixed by the loop)
    const groups = new Map<string, { nadlan: Row[]; govmap: Row[] }>();
    for (const r of rows) {
      const key = `${r.deal_date}|${Math.round(r.price)}|${Math.round(r.area)}|${Math.round(r.rooms)}`;
      let g = groups.get(key);
      if (!g) { g = { nadlan: [], govmap: [] }; groups.set(key, g); }
      if (r.source === "nadlan") g.nadlan.push(r);
      else if (r.source === "govmap") g.govmap.push(r);
    }

    // 4. merge inside one transaction per city
    db.transaction(() => {
      for (const g of groups.values()) {
        if (!g.nadlan.length || !g.govmap.length) continue;
        mergedGroups++;
        const donor = g.govmap.find((x) => x.street) ?? g.govmap[0]; // best address donor
        const hoodDonor = g.govmap.find((x) => x.neighborhood) ?? null;
        for (const n of g.nadlan) {
          const wantStreet = !n.street && donor.street;
          const wantHood = !n.neighborhood && hoodDonor;
          if (wantStreet || wantHood) {
            enrich.run(donor.street, donor.house_num, floorText(donor.floor), hoodDonor?.neighborhood ?? null, n.id);
            if (wantStreet) enriched++;
            if (wantHood) hoodEnriched++;
          }
        }
        for (const gm of g.govmap) { exclude.run(REASON, gm.id); excluded++; } // drop the duplicate copies
      }
    })();

    // ── PASS 2 (soft): the strict key misses real twins over sub-m² area / rooms
    // disagreements between the two feeds. For nadlan rows STILL without an address,
    // match govmap by date+exact-price only, with an area tolerance of ≤2 m².
    // Guard: if candidate donors disagree on the street → skip (never guess).
    const targets = selectTargets.all(minYear, city) as Row[];
    // donors: every govmap row with an address (incl. ones excluded in pass 1 — address donation is harmless)
    const donors = selectDonors.all(minYear, city) as (Row & { ex: number })[];
    const byLoose = new Map<string, (Row & { ex: number })[]>();
    for (const d of donors) {
      const k = `${d.deal_date}|${Math.round(d.price)}`;
      const a = byLoose.get(k); if (a) a.push(d); else byLoose.set(k, [d]);
    }
    db.transaction(() => {
      for (const t of targets) {
        const cands = (byLoose.get(`${t.deal_date}|${Math.round(t.price)}`) ?? [])
          .filter((d) => Math.abs(d.area - t.area) <= 2);
        if (!cands.length) continue;
        const streets = new Set(cands.map((d) => d.street).filter(Boolean));
        if (streets.size > 1) { ambiguous++; continue; } // conflicting addresses → don't guess
        // The never-guess rule applies to the neighbourhood too: donors that
        // agree on the street but disagree on the hood donate no hood.
        const hoods = new Set(cands.map((d) => d.neighborhood).filter(Boolean));
        const donor = cands.find((d) => d.street) ?? cands[0];
        const hood = hoods.size === 1 ? [...hoods][0] : null;
        if (!(!t.street && donor.street) && !(!t.neighborhood && hood)) continue; // nothing to give this row
        enrich.run(donor.street, donor.house_num, floorText(donor.floor), hood, t.id);
        if (!t.street && donor.street) softEnriched++;
        if (!t.neighborhood && hood) hoodEnriched++;
        for (const d of cands) if (!d.ex) { exclude.run(SOFT_REASON, d.id); d.ex = 1; softExcluded++; }
      }
    })();
  }

  if (excluded) db.prepare(
    `INSERT INTO admin_exclusion_log (action, affected, reason, created_at) VALUES ('exclude', ?, ?, datetime('now'))`
  ).run(excluded, REASON);
  if (softExcluded) db.prepare(
    `INSERT INTO admin_exclusion_log (action, affected, reason, created_at) VALUES ('exclude', ?, ?, datetime('now'))`
  ).run(softExcluded, SOFT_REASON);


  console.log(`merge-cross-channel (since ${minYear}): reset ${reset.changes} prior · ` +
    `${mergedGroups.toLocaleString("en")} groups merged · ${enriched.toLocaleString("en")} nadlan rows enriched with address · ` +
    `${hoodEnriched.toLocaleString("en")} received a neighbourhood · ` +
    `${excluded.toLocaleString("en")} govmap duplicates excluded`);
  console.log(`  soft pass: +${softEnriched.toLocaleString("en")} addresses (area ≤2m² tolerance) · ` +
    `${softExcluded.toLocaleString("en")} more govmap copies merged · ${ambiguous.toLocaleString("en")} skipped (conflicting addresses)`);
  db.close();
}
main();
