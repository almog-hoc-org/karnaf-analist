#!/usr/bin/env tsx
/**
 * Mark the city-years whose NEW-build price level is an administered price,
 * not a market price — the מחיר למשתכן programme.
 *
 * MEASURED, NOT SUSPECTED (live run, 16.8.2026):
 *   מבשרת ציון 2022 — 223 new deals, 203 of them (91%) at a median of
 *   ₪13,544/m² while the city's own second-hand median that year was ₪25,945.
 *   The site read that as the baseline and reported "+104% in three years".
 *   The market did not double; the 2022 sample was a lottery allocation.
 *   41 such city-years across 25 cities, including three of the six cities
 *   sitting at the top of the "biggest risers" board (עתלית, נהרייה,
 *   קריית טבעון).
 *
 * WHY FLAG AND NOT EXCLUDE
 * These are real transactions at prices real people really paid. Dropping them
 * would misstate the market in the other direction — and would quietly delete
 * the single most useful fact about those years for a buyer. The site already
 * makes this distinction for luxury deals: counted, disclosed, kept out of the
 * average. Here the deals stay in every series; what changes is that a WINDOW
 * anchored on such a year is labelled, so a reader knows the percentage is
 * measuring a change of programme, not a change of price.
 *
 * THE BASELINE IS THE POINT
 * The comparison is against the SAME city-year's second-hand median, the one
 * number the programme cannot move — it sells new apartments only. Comparing
 * against the new-build median would compare the contamination with itself.
 *
 * Writes `city_year_subsidized` (city, year, n_new, n_low, share, med_low,
 * med_secondhand) in one transaction. Idempotent: full replace each run.
 *
 * Run: npx tsx scripts/flag-subsidized-cells.ts   (pipeline: after classify)
 */
import Database from "better-sqlite3";
import path from "path";
import { getRuleNum } from "../lib/systemRules";
import { historyFromYear } from "../lib/historyWindow";

const DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db");

interface Row { city_name: string; deal_year: number; price_sqm: number; is_secondhand: number | null; class_source: string | null; }

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function main() {
  // Both admin-tunable: the ratio decides what counts as "outside the market",
  // the share decides when a year is dominated rather than merely touched.
  const maxRatio = getRuleNum("subsidized_max_ratio_pct", 65) / 100;
  const minShare = getRuleNum("subsidized_min_share_pct", 25) / 100;
  const MIN_BASE = 10; // usable second-hand baseline
  const MIN_NEW = 10;  // enough new deals for a share to mean anything
  const minYear = historyFromYear();
  const MIN_SQM = getRuleNum("min_sqm_price", 2000), MAX_SQM = getRuleNum("max_sqm_price", 200000);

  const db = new Database(DB);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 60000");

  const rows = db.prepare(
    `SELECT city_name, deal_year, price_sqm, is_secondhand, class_source
       FROM nadlan_transactions
      WHERE COALESCE(excluded,0)=0 AND COALESCE(luxury,0)=0
        AND deal_year >= ? AND price_sqm BETWEEN ? AND ?`
  ).all(minYear, MIN_SQM, MAX_SQM) as Row[];

  const cells = new Map<string, { sh: number[]; nw: number[] }>();
  for (const r of rows) {
    const k = `${r.city_name}|${r.deal_year}`;
    let c = cells.get(k);
    if (!c) { c = { sh: [], nw: [] }; cells.set(k, c); }
    if (r.is_secondhand === 1) c.sh.push(r.price_sqm);
    else if (r.is_secondhand === 0 && r.class_source != null) c.nw.push(r.price_sqm);
  }

  const out: Array<[string, number, number, number, number, number, number]> = [];
  for (const [k, c] of cells) {
    if (c.sh.length < MIN_BASE || c.nw.length < MIN_NEW) continue;
    const medSh = median(c.sh);
    const low = c.nw.filter((p) => p <= medSh * maxRatio);
    const share = low.length / c.nw.length;
    if (share < minShare) continue;
    const [city, year] = k.split("|");
    out.push([city, Number(year), c.nw.length, low.length, share, median(low), medSh]);
  }

  db.exec(`CREATE TABLE IF NOT EXISTS city_year_subsidized (
    city_name TEXT NOT NULL,
    year INTEGER NOT NULL,
    n_new INTEGER NOT NULL,
    n_low INTEGER NOT NULL,
    share REAL NOT NULL,
    med_low REAL,
    med_secondhand REAL,
    PRIMARY KEY (city_name, year)
  )`);

  const ins = db.prepare(
    `INSERT INTO city_year_subsidized (city_name, year, n_new, n_low, share, med_low, med_secondhand)
     VALUES (?,?,?,?,?,?,?)`
  );
  db.transaction(() => {
    db.prepare("DELETE FROM city_year_subsidized").run();
    for (const r of out) ins.run(...r);
  })();

  const cities = new Set(out.map((r) => r[0]));
  console.log(
    `flag-subsidized-cells: ${out.length} תאי עיר×שנה ב-${cities.size} ערים ` +
    `(מתחת ל-${(maxRatio * 100).toFixed(0)}% מחציון היד-2 המקומי, לפחות ${(minShare * 100).toFixed(0)}% מהעסקאות החדשות)`
  );
  for (const r of out.sort((a, b) => b[4] - a[4]).slice(0, 8)) {
    console.log(`  ${r[0]} ${r[1]}: ${r[3]}/${r[2]} עסקאות (${(r[4] * 100).toFixed(0)}%) · ` +
      `חציון ₪${Math.round(r[5]).toLocaleString("he-IL")} מול ₪${Math.round(r[6]).toLocaleString("he-IL")} ביד-2`);
  }
  db.close();
}

main();
