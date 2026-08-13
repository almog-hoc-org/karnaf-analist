/**
 * verify-data-contract — the raw↔stats contract, checked on every pipeline run.
 *
 * WHY THIS EXISTS
 * For months the stats table quietly covered a rolling decade while the raw
 * table reached back to 1998 — 20,447 usable transactions had no chart point,
 * and nothing noticed, because every audit only inspected cells that already
 * existed. This script checks the NEGATIVE space: what should exist and
 * doesn't. It is the in-repo equivalent of the QA team's
 * `price_candidate_missing_stat_row` metric.
 *
 * Checks:
 *   1. YEAR RANGE — stats MIN(year)/MAX(year) must track the raw range within
 *      the processed window (history_from_year rule).
 *   2. MISSING STAT ROWS — city×year pairs with ≥ min_deals_per_year sane,
 *      active, priced deals but NO stats row at all (any scope).
 *   3. ACTIVE CITY, ZERO STATS — a city with meaningful raw volume and not a
 *      single stats row (the "empty page for a real city" failure).
 *   4. ALIAS LEAKS — raw rows still carrying a name listed in CITY_ALIASES
 *      (the merge stage should have folded them).
 *
 * Output: data/data-contract.json (read by the admin panel), human summary to
 * stdout. Registered in lib/pipeline.ts as a REPORT stage — it never blocks
 * a run; its job is to make the gap loud, not to stop the nightly.
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { historyFromYear } from "../lib/historyWindow";
import { CITY_ALIASES } from "../lib/cityAliases";
import { getRuleNum } from "../lib/systemRules";

const DATA_DIR = process.env.KARNAF_DATA_DIR ?? "./data";
const DB = path.resolve(DATA_DIR, "realestate.db");

function main() {
  const db = new Database(DB, { readonly: true });
  const fromYear = historyFromYear();
  const minN = getRuleNum("min_deals_per_year", 10);
  const problems: string[] = [];

  // ── 1. year-range contract ────────────────────────────────────────
  const raw = db.prepare(
    `SELECT MIN(deal_year) lo, MAX(deal_year) hi, COUNT(*) n FROM nadlan_transactions
      WHERE COALESCE(excluded,0)=0 AND deal_year >= ?`
  ).get(fromYear) as { lo: number | null; hi: number | null; n: number };
  const stats = db.prepare(
    `SELECT MIN(year) lo, MAX(year) hi, COUNT(*) n FROM nadlan_year_room_stats`
  ).get() as { lo: number | null; hi: number | null; n: number };

  if (stats.n === 0) {
    problems.push("nadlan_year_room_stats is EMPTY");
  } else {
    // Allow slack at the old end: the earliest raw years may not clear the
    // per-cell minimums anywhere. More than 3 years of unexplained gap at
    // either end means the aggregation window is not honoring the contract.
    if (raw.lo != null && stats.lo != null && stats.lo - raw.lo > 3) {
      problems.push(`stats start at ${stats.lo} but raw reaches back to ${raw.lo} — aggregation window too narrow?`);
    }
    if (raw.hi != null && stats.hi != null && raw.hi - stats.hi > 0) {
      problems.push(`raw has years up to ${raw.hi} but stats stop at ${stats.hi}`);
    }
  }

  // ── 2. usable deals with no stat row (the QA metric) ─────────────
  // "Usable" here must mean AGGREGATABLE, not merely priced. The aggregation
  // refuses — deliberately, with documented rationale — to build a series from
  // deals that carry no channel classification and no build year (presale
  // lumps distort "all" upward), and it never mixes govmap into a nadlan
  // city's line. A city-year of purely-unclassified deals therefore CANNOT
  // have a stat row under the quality gates; counting it as a violation makes
  // ok:false the permanent state and turns the contract into alarm fatigue.
  // So: pairs with ≥minN CLASSIFIABLE deals and no stat row are problems
  // (the aggregation should have emitted something); pairs rich in raw deals
  // that are all unclassifiable are reported as a separate, informational
  // "structural gap" count — visible, never alarming.
  // Mirror the aggregation's sanity bounds too (same rules, same defaults) —
  // a deal outside them is excluded from stats by design, not by a bug.
  const MIN_SQM = getRuleNum("min_sqm_price", 2_000), MAX_SQM = getRuleNum("max_sqm_price", 200_000);
  const MIN_AREA = getRuleNum("min_area", 20), MAX_AREA = getRuleNum("max_area", 500);
  const SANE = `t.price_sqm >= ${MIN_SQM} AND t.price_sqm <= ${MAX_SQM} AND t.area >= ${MIN_AREA} AND t.area <= ${MAX_AREA}`;
  // class_source is added by classify-sale-channel's ensureColumn — absent on a
  // DB that has never been through classification (fresh clones, dev copies).
  const hasClassSource = (db.prepare(`PRAGMA table_info(nadlan_transactions)`).all() as Array<{ name: string }>)
    .some((c) => c.name === "class_source");
  const CLASSIFIED = hasClassSource
    ? `(t.class_source IS NOT NULL OR COALESCE(t.year_built,0) > 0)`
    : `COALESCE(t.year_built,0) > 0`;
  const AGGREGATABLE = `(${SANE} AND ${CLASSIFIED})`;
  const missing = db.prepare(
    `SELECT t.city_name, t.deal_year, COUNT(*) n
       FROM nadlan_transactions t
      WHERE COALESCE(t.excluded,0)=0 AND COALESCE(t.luxury,0)=0
        AND t.deal_year >= ? AND t.price_sqm > 0 AND ${AGGREGATABLE}
        AND NOT EXISTS (
          SELECT 1 FROM nadlan_year_room_stats s
           WHERE s.city_name = t.city_name AND s.year = t.deal_year
        )
      GROUP BY t.city_name, t.deal_year
     HAVING COUNT(*) >= ?
      ORDER BY n DESC`
  ).all(fromYear, minN) as Array<{ city_name: string; deal_year: number; n: number }>;
  const missingDeals = missing.reduce((s, r) => s + r.n, 0);
  if (missing.length) {
    problems.push(`${missing.length} city×year pairs (${missingDeals} deals) have ≥${minN} aggregatable deals but NO stat row`);
  }

  // structural gaps — informational only (unclassifiable raw volume the
  // quality gates keep out of the stats by design)
  const structural = db.prepare(
    `SELECT COUNT(*) pairs, COALESCE(SUM(n),0) deals FROM (
       SELECT t.city_name, t.deal_year, COUNT(*) n
         FROM nadlan_transactions t
        WHERE COALESCE(t.excluded,0)=0 AND COALESCE(t.luxury,0)=0
          AND t.deal_year >= ? AND t.price_sqm > 0 AND NOT ${AGGREGATABLE}
          AND NOT EXISTS (
            SELECT 1 FROM nadlan_year_room_stats s
             WHERE s.city_name = t.city_name AND s.year = t.deal_year
          )
        GROUP BY t.city_name, t.deal_year
       HAVING COUNT(*) >= ?
     )`
  ).get(fromYear, minN) as { pairs: number; deals: number };

  // ── 3. active city with zero stats ───────────────────────────────
  const emptyCities = db.prepare(
    `SELECT t.city_name, COUNT(*) n
       FROM nadlan_transactions t
      WHERE COALESCE(t.excluded,0)=0 AND t.deal_year >= ? AND ${AGGREGATABLE}
        AND NOT EXISTS (SELECT 1 FROM nadlan_year_room_stats s WHERE s.city_name = t.city_name)
      GROUP BY t.city_name
     HAVING COUNT(*) >= ?
      ORDER BY n DESC`
  ).all(fromYear, minN * 3) as Array<{ city_name: string; n: number }>;
  if (emptyCities.length) {
    problems.push(`${emptyCities.length} cities have aggregatable volume but ZERO stat rows: ${emptyCities.slice(0, 5).map((c) => c.city_name).join(", ")}${emptyCities.length > 5 ? "…" : ""}`);
  }

  // ── 4. alias leaks ───────────────────────────────────────────────
  const aliasNames = Object.keys(CITY_ALIASES);
  const leaks: Array<{ city_name: string; n: number }> = aliasNames.length
    ? (db.prepare(
        `SELECT city_name, COUNT(*) n FROM nadlan_transactions
          WHERE city_name IN (${aliasNames.map(() => "?").join(",")})
          GROUP BY city_name`
      ).all(...aliasNames) as Array<{ city_name: string; n: number }>)
    : [];
  if (leaks.length) {
    problems.push(`alias names still present in raw (merge stage should fold them): ${leaks.map((l) => `${l.city_name}(${l.n})`).join(", ")}`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    window: { fromYear, minN },
    raw: { from: raw.lo, to: raw.hi, activeDeals: raw.n },
    stats: { from: stats.lo, to: stats.hi, rows: stats.n },
    missingStatPairs: missing.length,
    missingStatDeals: missingDeals,
    missingSample: missing.slice(0, 20),
    /** unclassifiable raw volume kept out of stats BY DESIGN — info, not a problem */
    structuralGaps: structural,
    citiesWithoutStats: emptyCities,
    aliasLeaks: leaks,
    problems,
    ok: problems.length === 0,
  };
  fs.mkdirSync(path.resolve(DATA_DIR), { recursive: true });
  fs.writeFileSync(path.resolve(DATA_DIR, "data-contract.json"), JSON.stringify(report, null, 2));

  console.log(`data-contract: raw ${raw.lo}–${raw.hi} (${raw.n.toLocaleString()} active) · stats ${stats.lo}–${stats.hi} (${stats.n.toLocaleString()} rows)`);
  console.log(`  missing stat rows: ${missing.length} pairs / ${missingDeals.toLocaleString()} deals · cities w/o stats: ${emptyCities.length} · alias leaks: ${leaks.length}`);
  console.log(`  structural gaps (unclassifiable by design, informational): ${structural.pairs} pairs / ${structural.deals.toLocaleString()} deals`);
  if (problems.length) {
    for (const p of problems) console.log(`  ✗ ${p}`);
  } else {
    console.log("  ✓ contract holds");
  }
  db.close();
}

main();
