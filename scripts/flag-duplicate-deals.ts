#!/usr/bin/env tsx
/**
 * Flag DUPLICATE REPORTS of the same sale (user rule).
 *
 * The tax authority republishes the same transaction days apart (correction /
 * re-publication), and the two collection channels see it independently. Two
 * deals with the SAME price to the shekel, the SAME area, the SAME room count
 * and a compatible build-year, dated within a few days of each other, are one
 * sale reported twice — not two sales. Left alone they inflate the deal count
 * and give that one price double weight in every average.
 *
 * This is different from a price anomaly: the extra copy is not a deal that
 * happened, so it leaves the COUNTS too (excluded=1, like every other
 * exclusion) — while a luxury deal did happen and only leaves the prices.
 *
 * Cluster = same city, |Δprice| ≤ dupe_price_tolerance, |Δarea| ≤
 * dupe_area_tolerance, identical rooms, compatible year_built (equal, or one
 * side unknown — that is the govmap↔nadlan case), dates within
 * dupe_window_days. Chained: A~B and B~C put A, B and C in one cluster.
 *
 * SURVIVOR = the most complete record (build-year first — it drives the
 * second-hand/new classification — then address), ties broken by the earliest
 * date. The survivor is then ENRICHED with the address fields its twins hold,
 * so the cluster collapses to one row that is the union of what we knew.
 *
 * Reversible + logged. Idempotent (clears its own prior marks first). Last 10
 * years. Pipeline: merge-cross-channel → reclassify-rooms → THIS → flag-outlier
 * → flag-luxury → aggregate. Running before the anomaly pass matters: the
 * cohort medians there must not be skewed by double-counted prices.
 *
 * Run: npx tsx scripts/flag-duplicate-deals.ts
 */
import Database from "better-sqlite3";
import path from "path";
import { getRuleNum, getRuleBool } from "../lib/systemRules";
import { ensureAuditLog } from "../lib/auditLog";

const YEARS_BACK = 10;
const REASON_PREFIX = "כפילות-דיווח";
/** guard against a pathological admin tolerance turning the sweep quadratic */
const MAX_LOOKAHEAD = 250;

interface Row {
  id: number; city_name: string; deal_date: string; price: number; area: number;
  rooms: number | null; year_built: number | null; source: string;
  street: string | null; house_num: string | null; floor: number | string | null; neighborhood: string | null;
}

/** days since epoch — deal_date is "YYYY-MM-DD…" */
const dayOf = (s: string) => Math.floor(Date.parse(s.slice(0, 10)) / 86_400_000);

/** How complete is this record? Build-year outranks address: it decides
 *  second-hand vs new, which the whole price axis depends on. */
function completeness(r: Row): number {
  return (r.year_built ? 16 : 0) + (r.street ? 8 : 0) + (r.house_num ? 4 : 0) +
    (r.neighborhood ? 2 : 0) + (r.floor != null ? 1 : 0);
}

function main() {
  const on = getRuleBool("duplicate_detection_on", true);
  const requireSameUnit = getRuleBool("dupe_require_same_unit", true);
  const sameBuildingMax = Math.max(1, getRuleNum("dupe_same_building_max", 2));
  const windowDays = getRuleNum("dupe_window_days", 7);
  const priceTol = getRuleNum("dupe_price_tolerance", 0);
  const areaTol = getRuleNum("dupe_area_tolerance", 0);
  const minYear = new Date().getFullYear() - YEARS_BACK;

  const db = new Database(path.resolve("./data/realestate.db"));
  db.pragma("journal_mode = WAL");
  ensureAuditLog(db); // seven writers, no owner — see lib/auditLog.ts
  db.pragma("busy_timeout = 60000");

  // 1. idempotent reset — changing the window in the dashboard must drop the old marks
  const reset = db.prepare(
    `UPDATE nadlan_transactions SET excluded=0, exclusion_reason=NULL
     WHERE exclusion_reason LIKE '${REASON_PREFIX}%' AND deal_year >= ?`).run(minYear);

  if (!on) {
    console.log(`flag-duplicate-deals: rule DISABLED — released ${reset.changes.toLocaleString("en")} previously-flagged rows.`);
    db.close();
    return;
  }
  console.log(`flag duplicate reports: identical price(±${priceTol})/area(±${areaTol})/rooms, dates ≤${windowDays}d apart · years≥${minYear}`);

  // 2. in-scope, keyable rows from BOTH channels — cross-channel twins are the point.
  //
  //    Scope note: rows currently carrying an ANOMALY or SANITY flag are included.
  //    Those flags are transient — flag-outlier-deals clears and recomputes them on
  //    every run, right after this script. Skipping such rows here let a released
  //    row come back as an un-deduplicated active deal (measured: 724 surviving
  //    duplicate clusters). Permanent exclusions — cross-channel merges and manual
  //    admin exclusions — stay out.
  const rows = db.prepare(
    `SELECT id, city_name, deal_date, price, area, rooms, year_built, source,
            street, house_num, floor, neighborhood
     FROM nadlan_transactions
     WHERE deal_year >= ? AND price > 0 AND area > 0
       AND (COALESCE(excluded,0)=0
            OR exclusion_reason LIKE 'אנומליית מחיר%'
            OR exclusion_reason LIKE 'סינון-שפיות%'
            OR exclusion_reason LIKE 'חריג-שוק%')
     ORDER BY city_name, price, deal_date`
  ).all(minYear) as Row[];
  console.log(`  scanning ${rows.length.toLocaleString("en")} deals (active + transiently-flagged)…`);

  // 3. clustering.
  //    Default tolerances are 0 (exact price + area), so candidates can be hashed
  //    into city|price|area|rooms blocks — complete AND near-linear. A sliding
  //    price sweep would be quadratic inside big blocks of identical round prices
  //    (₪1,500,000 recurs hundreds of times in a large city over a decade).
  //    Non-zero tolerances fall back to the sweep, capped so a wide admin value
  //    can't hang the nightly run.
  const exact = priceTol === 0 && areaTol === 0;
  const blocks = new Map<string, Row[]>();
  for (const r of rows) {
    const key = exact
      ? `${r.city_name}|${r.price}|${r.area}|${r.rooms ?? "?"}`
      : r.city_name;
    const a = blocks.get(key);
    if (a) a.push(r); else blocks.set(key, [r]);
  }

  const clusters: Row[][] = [];
  let cappedScans = 0;
  /** same sale? (the date bound is enforced by the sweep, not here) */
  const compatible = (a: Row, b: Row) =>
    Math.abs(b.area - a.area) <= areaTol &&
    Math.abs(b.price - a.price) <= priceTol &&
    (a.rooms ?? -1) === (b.rooms ?? -1) &&
    // build-year: equal, or unknown on one side (the govmap↔nadlan case)
    !(a.year_built != null && b.year_built != null && a.year_built !== b.year_built);

  for (const list of blocks.values()) {
    if (list.length < 2) continue;
    // sort by DATE and stop each scan at the window edge: the inner loop then only
    // ever walks the handful of deals inside one 7-day window, in both modes.
    list.sort((a, b) => dayOf(a.deal_date) - dayOf(b.deal_date));
    const days = list.map((r) => dayOf(r.deal_date));
    const n = list.length;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };

    let linked = false;
    for (let i = 0; i < n; i++) {
      let seen = 0;
      for (let j = i + 1; j < n && days[j] - days[i] <= windowDays; j++) {
        if (++seen > MAX_LOOKAHEAD) { cappedScans++; break; }
        if (!compatible(list[i], list[j])) continue;
        union(i, j);
        linked = true;
      }
    }
    if (!linked) continue;

    const groups = new Map<number, Row[]>();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      const g = groups.get(root);
      if (g) g.push(list[i]); else groups.set(root, [list[i]]);
    }
    for (const g of groups.values()) if (g.length >= 2) clusters.push(g);
  }

  // 3b. How many of a cluster's rows are plausible SEPARATE sales?
  //     · different ADDRESSES  → different buildings → all of them are real, keep the cluster whole.
  //     · same address, different FLOORS → a builder can genuinely sell two identical
  //       flats in one building in one week; five is not a market, it is a feed artefact.
  //       Keep up to dupe_same_building_max (default 2), drop the surplus.
  //     · everything identical → one sale published twice → keep 1.
  //     Measured: where the flat is provably the same, 82.5% of the reports land exactly
  //     1 day apart (the re-publication signature); where the flats provably differ, 39.3%.
  //     Chaining can pull two different units into one cluster through a row with no
  //     floor, so both checks look at every row in the cluster.
  type Kind = "same-unit" | "same-building" | "different-buildings";
  const addrOf = (r: Row) => (r.street ? `${r.street}|${r.house_num ?? ""}` : null);
  /** most complete first; ties to the earliest report, then the lowest id */
  const bestFirst = (g: Row[]) =>
    [...g].sort((a, b) => completeness(b) - completeness(a) || dayOf(a.deal_date) - dayOf(b.deal_date) || a.id - b.id);

  /**
   * Which rows of this cluster are real, separate sales?
   *
   * Counting survivors was not enough: chaining can pull three reports of flat
   * #2 and three of flat #7 into one cluster, and "keep 2" then kept two copies
   * of flat #2. So we keep at most ONE row per identifiable FLAT, and at most
   * dupe_same_building_max flats per building.
   */
  /** within ONE building: one row per identifiable flat, at most sameBuildingMax flats */
  const unitSurvivors = (g: Row[]): { keep: Row[]; multiUnit: boolean } => {
    const ranked = bestFirst(g);
    const units = new Map<string, Row[]>();
    for (const r of ranked) {
      if (r.floor == null) continue; // unknown floor can't prove a different flat
      const k = String(r.floor);
      const a = units.get(k);
      if (a) a.push(r); else units.set(k, [r]);
    }
    // no distinguishing floor, or all on one floor → one flat → one sale
    if (units.size <= 1) return { keep: ranked.slice(0, 1), multiUnit: false };
    return { keep: [...units.values()].slice(0, sameBuildingMax).map((u) => u[0]), multiUnit: true };
  };

  const survivorsOf = (g: Row[]): { keep: Row[]; kind: Kind } => {
    if (!requireSameUnit) return { keep: bestFirst(g).slice(0, 1), kind: "same-unit" };

    // Split by address FIRST. Two addresses mean two buildings, but each building
    // can still hold its own re-published copies — an earlier version bailed out
    // of the whole cluster here and left those in.
    const byAddr = new Map<string, Row[]>();
    for (const r of g) {
      const k = addrOf(r) ?? "?";
      const a = byAddr.get(k);
      if (a) a.push(r); else byAddr.set(k, [r]);
    }
    const knownAddrs = [...byAddr.keys()].filter((k) => k !== "?");
    if (knownAddrs.length > 1) {
      const keep: Row[] = [];
      for (const [k, rowsOfAddr] of byAddr) {
        // A row with no address is not a protected row — only a PROVABLE difference
        // (another building, another floor) keeps a deal alive. Sitting beside
        // identified sales of the same price, area, rooms and week, it is another
        // copy of one of them, and keeping it would double-count that sale.
        if (k === "?") continue;
        keep.push(...unitSurvivors(rowsOfAddr).keep);
      }
      return { keep, kind: "different-buildings" };
    }

    const { keep, multiUnit } = unitSurvivors(g);
    return { keep, kind: multiUnit ? "same-building" : "same-unit" };
  };

  let keptWholeClusters = 0, cappedBuildings = 0;
  const candidates: Array<{ g: Row[]; keep: Row[]; kind: Kind }> = [];
  for (const g of clusters) {
    const { keep, kind } = survivorsOf(g);
    if (keep.length >= g.length) { keptWholeClusters++; continue; } // nothing to drop
    if (kind === "same-building") cappedBuildings++;
    candidates.push({ g, keep, kind });
  }

  // 4. keep the most complete row per cluster, enrich it, exclude the rest
  const enrich = db.prepare(
    `UPDATE nadlan_transactions
     SET street=COALESCE(street,?), house_num=COALESCE(house_num,?), floor=COALESCE(floor,?), neighborhood=COALESCE(neighborhood,?)
     WHERE id=?`);
  const exclude = db.prepare(`UPDATE nadlan_transactions SET excluded=1, exclusion_reason=? WHERE id=?`);
  const reasonDup = `${REASON_PREFIX} (עסקה זהה בהפרש עד ${windowDays} ימים)`;
  const reasonBld = `${REASON_PREFIX} (מעל ${sameBuildingMax} עסקאות זהות באותו בניין באותו שבוע)`;

  let dropped = 0, droppedBuilding = 0, enriched = 0, crossChannel = 0;
  const perCity = new Map<string, number>();
  const samples: string[] = [];

  const run = db.transaction(() => {
    for (const { g, keep: survivors, kind } of candidates) {
      const keepIds = new Set(survivors.map((r) => r.id));
      const keep = survivors[0], drop = g.filter((r) => !keepIds.has(r.id));
      if (new Set(g.map((r) => r.source)).size > 1) crossChannel++;

      // only a true re-publication lets the survivor absorb its twin's address —
      // separate flats in one building each keep their own details
      if (kind === "same-unit") {
        const donor = drop.find((r) => r.street) ?? null;
        if (donor && (!keep.street || !keep.neighborhood || keep.floor == null)) {
          enrich.run(donor.street, donor.house_num, donor.floor, donor.neighborhood ?? keep.neighborhood, keep.id);
          enriched++;
        }
      }
      const reason = kind === "same-building" ? reasonBld : reasonDup;
      for (const r of drop) { exclude.run(reason, r.id); dropped++; if (kind === "same-building") droppedBuilding++; }
      perCity.set(keep.city_name, (perCity.get(keep.city_name) ?? 0) + drop.length);
      if (samples.length < 5 && keep.price >= 2_000_000) {
        samples.push(g.map((r) => `${r.deal_date.slice(0, 10)} ₪${Math.round(r.price).toLocaleString("he-IL")} ${r.area}מ״ר [${r.source}]`).join("  |  ") + `  ← ${keep.city_name}`);
      }
    }
  });
  run();

  if (dropped - droppedBuilding) db.prepare(
    `INSERT INTO admin_exclusion_log (action, affected, reason, created_at) VALUES ('exclude', ?, ?, datetime('now'))`
  ).run(dropped - droppedBuilding, reasonDup);
  if (droppedBuilding) db.prepare(
    `INSERT INTO admin_exclusion_log (action, affected, reason, created_at) VALUES ('exclude', ?, ?, datetime('now'))`
  ).run(droppedBuilding, reasonBld);

  const pct = rows.length ? (dropped / rows.length * 100).toFixed(2) : "0";
  console.log(`  reset ${reset.changes.toLocaleString("en")} prior marks`);
  console.log(`  ${candidates.length.toLocaleString("en")} duplicate clusters · excluded ${dropped.toLocaleString("en")} extra copies (${pct}% of scanned)`);
  console.log(`    of which ${droppedBuilding.toLocaleString("en")} from ${cappedBuildings.toLocaleString("en")} clusters over the ${sameBuildingMax}-per-building cap (same address, floors differ)`);
  console.log(`  kept ${keptWholeClusters.toLocaleString("en")} clusters whole — different buildings, or already within the cap`);
  console.log(`  ${crossChannel.toLocaleString("en")} clusters spanned BOTH channels (missed by the same-date merge) · ${enriched.toLocaleString("en")} survivors enriched with an address`);
  if (cappedScans) console.log(`  ⚠ ${cappedScans} scans hit the ${MAX_LOOKAHEAD}-row look-ahead cap — tolerances may be too wide`);
  for (const [c, n] of [...perCity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`    ${c}: ${n.toLocaleString("en")}`);
  for (const s of samples) console.log(`    · ${s}`);
  db.close();
}
main();
