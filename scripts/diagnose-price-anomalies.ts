#!/usr/bin/env tsx
/**
 * Find city-years whose price level is dominated by SUBSIDIZED sales.
 *
 * THE REPORT THAT PROMPTED THIS (operator, 16.8.2026): מבשרת ציון shows
 * +104% over three years. Looking at the deals, 2022 is full of מחיר למשתכן
 * (the state's subsidized-lottery programme) at ~13-15K ₪/m² while the open
 * market in that city sits above 30K. The 2022 baseline is therefore not a
 * market price at all, and "the market doubled" is an artefact of which deals
 * happened to close that year.
 *
 * WHY THIS IS NOT THE LUXURY FILTER IN REVERSE
 * A luxury deal is a real transaction at a real market price, excluded from
 * averages because it is unrepresentative of the stock. A subsidized deal is a
 * real transaction at an ADMINISTERED price — the buyer won a lottery and paid
 * a rate the seller did not set. Both are real; neither should be silently
 * averaged into "what an apartment costs here".
 *
 * WHAT THIS SCRIPT DOES — MEASURE, DO NOT ACT
 * There is no "subsidized" flag in the tax authority feed, so the programme
 * has to be inferred, and inference must be shown before it is trusted. For
 * every city-year it compares the NEW-build deals against the SAME YEAR's
 * second-hand median in the SAME city — the only baseline immune to the
 * contamination — and reports how many new deals sit far below it.
 *
 * The second-hand median is the right yardstick precisely because the
 * programme sells new apartments only: a subsidized batch cannot move it.
 *
 * Run: npx tsx scripts/diagnose-price-anomalies.ts [--min-share 0.25]
 */
import Database from "better-sqlite3";
import path from "path";
import { getRuleNum } from "../lib/systemRules";
import { historyFromYear } from "../lib/historyWindow";

const DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db");

/** A new-build deal at or below this fraction of the local second-hand median
 *  is priced outside the open market. 0.65 is deliberately generous: genuine
 *  new-build discounts (periphery, early-stage presale) rarely reach 35% off,
 *  while the subsidized programme routinely lands at 45-60% off. */
const SUBSIDIZED_MAX_RATIO = 0.65;

interface Row { city_name: string; deal_year: number; price_sqm: number; is_secondhand: number | null; class_source: string | null; }

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function main() {
  const minShare = Number(process.argv.find((a) => a.startsWith("--min-share"))?.split("=")[1] ?? 0.25);
  const minYear = historyFromYear();
  const MIN_SQM = getRuleNum("min_sqm_price", 2000), MAX_SQM = getRuleNum("max_sqm_price", 200000);

  const db = new Database(DB, { readonly: true });
  db.pragma("busy_timeout = 30000");

  const rows = db.prepare(
    `SELECT city_name, deal_year, price_sqm, is_secondhand, class_source
       FROM nadlan_transactions
      WHERE COALESCE(excluded,0)=0 AND COALESCE(luxury,0)=0
        AND deal_year >= ? AND price_sqm BETWEEN ? AND ?`
  ).all(minYear, MIN_SQM, MAX_SQM) as Row[];

  // city|year → { sh: prices, nw: prices }
  const cells = new Map<string, { sh: number[]; nw: number[] }>();
  for (const r of rows) {
    const k = `${r.city_name}|${r.deal_year}`;
    let c = cells.get(k);
    if (!c) { c = { sh: [], nw: [] }; cells.set(k, c); }
    if (r.is_secondhand === 1) c.sh.push(r.price_sqm);
    else if (r.is_secondhand === 0 && r.class_source != null) c.nw.push(r.price_sqm);
  }

  interface Finding {
    city: string; year: number; nNew: number; nLow: number; share: number;
    medLow: number; medSh: number; ratio: number;
  }
  const findings: Finding[] = [];
  for (const [k, c] of cells) {
    // Need a trustworthy second-hand baseline AND enough new deals to matter.
    if (c.sh.length < 10 || c.nw.length < 10) continue;
    const medSh = median(c.sh);
    const low = c.nw.filter((p) => p <= medSh * SUBSIDIZED_MAX_RATIO);
    const share = low.length / c.nw.length;
    if (share < minShare) continue;
    const [city, year] = k.split("|");
    findings.push({
      city, year: Number(year), nNew: c.nw.length, nLow: low.length, share,
      medLow: median(low), medSh, ratio: median(low) / medSh,
    });
  }

  findings.sort((a, b) => b.share - a.share || b.nLow - a.nLow);

  console.log(`עסקאות חדשות במחיר מנהלי (חשד מחיר למשתכן) — סף ${(minShare * 100).toFixed(0)}% מהעסקאות החדשות בשנה\n`);
  console.log(`נבדקו ${cells.size} תאי עיר×שנה מ-${minYear} ואילך\n`);
  if (!findings.length) { console.log("לא נמצאו תאים חשודים."); db.close(); return; }

  console.log("  עיר                     שנה   חדשות  מהן נמוכות   חלק    חציון נמוכות   חציון יד-2   יחס");
  console.log("  " + "─".repeat(96));
  for (const f of findings.slice(0, 40)) {
    console.log(
      `  ${f.city.padEnd(22)} ${f.year}   ${String(f.nNew).padStart(5)}  ${String(f.nLow).padStart(9)}  ` +
      `${(f.share * 100).toFixed(0).padStart(4)}%  ${Math.round(f.medLow).toLocaleString("he-IL").padStart(12)}  ` +
      `${Math.round(f.medSh).toLocaleString("he-IL").padStart(12)}  ${(f.ratio * 100).toFixed(0).padStart(4)}%`
    );
  }
  if (findings.length > 40) console.log(`\n  … ועוד ${findings.length - 40} תאים`);

  const cities = new Set(findings.map((f) => f.city));
  console.log(`\nסיכום: ${findings.length} תאי עיר×שנה ב-${cities.size} ערים.`);
  console.log(`ערים: ${[...cities].slice(0, 25).join(", ")}${cities.size > 25 ? " …" : ""}`);

  db.close();
}

main();
