#!/usr/bin/env tsx
/**
 * What the archive actually covers, city by city and year by year.
 *
 * WHY THIS EXISTS
 * Collecting from nadlan is a campaign, not a single run: an anonymous session
 * returns roughly 2,400 deals per city, so ten years of build-year data arrives
 * over repeated passes (see lib/dealKey.ts). A campaign you cannot measure is
 * indistinguishable from one that has stopped working — and until the union fix
 * it HAD stopped working, silently, because every pass discarded the one before
 * it. Nothing in the repo would have shown that.
 *
 * So this answers three questions and nothing else:
 *
 *   1. which city × year cells are missing?
 *   2. did the last pulse improve anything?
 *   3. when is it no longer worth another pass?
 *
 * Question 2 is the reason for --save. A number alone cannot answer it; only a
 * comparison against the previous run can, and that comparison has to survive
 * between sessions.
 *
 *   npx tsx scripts/coverage-report.ts              summary + the worst gaps
 *   npx tsx scripts/coverage-report.ts --all        every city
 *   npx tsx scripts/coverage-report.ts --city=חיפה  one city, year by year
 *   npx tsx scripts/coverage-report.ts --save       record a snapshot to compare against
 *   npx tsx scripts/coverage-report.ts --json       machine-readable
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { getRuleNum } from "../lib/systemRules";

const DATA_DIR = process.env.KARNAF_DATA_DIR ?? "./data";
const DB_PATH = path.resolve(DATA_DIR, "realestate.db");
const SNAPSHOT = path.resolve(DATA_DIR, "coverage-snapshot.json");

/** The window every rule, graph and aggregation in the project assumes. */
const FROM_YEAR = 2016;
const TO_YEAR = 2025;

interface CityCoverage {
  city: string;
  deals: number;
  population: number | null;
  /**
   * Deals per 1,000 residents over the whole window.
   *
   * THE ONLY NUMBER THAT SEPARATES TWO VERY DIFFERENT PROBLEMS.
   * The first baseline showed every one of the 25 worst-covered places to be an
   * Arab locality — Rahat with 38 deals in ten years against roughly 80,000
   * residents, Shefa-'Amr with 95. A raw count cannot say whether that is a real
   * market (much housing there is self-built on family land and changes hands by
   * inheritance rather than registered sale) or a collector that fails on those
   * cities. The two call for opposite responses, and guessing between them on a
   * site published to the public is not acceptable.
   *
   * Normalised by population it becomes measurable: compared against the median
   * rate across all cities, a genuinely thin market sits in a plausible band,
   * while a collection failure sits orders of magnitude below everything else.
   */
  dealsPer1k: number | null;
  /** years in FROM..TO with enough second-hand deals to produce a price point */
  coveredYears: number;
  /** years with any deal at all — the difference is where a pulse can still help */
  presentYears: number;
  withBuildYear: number;
  classified: number;
  statRows: number;
}

function main() {
  const argv = process.argv.slice(2);
  const has = (f: string) => argv.includes(`--${f}`);
  const val = (f: string) => argv.find((a) => a.startsWith(`--${f}=`))?.split("=").slice(1).join("=");

  if (!fs.existsSync(DB_PATH)) {
    console.error(`✗ אין מסד ב-${DB_PATH}`);
    process.exit(1);
  }

  // Same threshold the charts use, read from the live rules rather than copied.
  // A report that measures against a different bar than the site renders is
  // worse than no report — it would call a city covered while its page is blank.
  const MIN_N = getRuleNum("min_deals_per_year", 10);

  const db = new Database(DB_PATH, { readonly: true });

  const singleCity = val("city");
  if (singleCity) {
    printCity(db, singleCity, MIN_N);
    db.close();
    return;
  }

  const rows = db.prepare(`
    SELECT t.city_name AS city,
           (SELECT c.population_2026 FROM cities c WHERE c.city_name = t.city_name) AS population,
           COUNT(*) AS deals,
           SUM(CASE WHEN t.year_built > 0 THEN 1 ELSE 0 END) AS withBuildYear,
           SUM(CASE WHEN t.class_source IS NOT NULL THEN 1 ELSE 0 END) AS classified,
           COUNT(DISTINCT t.deal_year) AS presentYears
      FROM nadlan_transactions t
     WHERE COALESCE(t.excluded,0) = 0 AND t.deal_year BETWEEN ? AND ?
     GROUP BY t.city_name
  `).all(FROM_YEAR, TO_YEAR) as Array<Omit<CityCoverage, "coveredYears" | "statRows" | "dealsPer1k">>;

  // A "covered" year is one that can actually produce a second-hand price point.
  // Counting deals would overstate it: a year with nine deals contributes
  // nothing a visitor can see.
  const coveredStmt = db.prepare(`
    SELECT COUNT(*) c FROM (
      SELECT deal_year FROM nadlan_transactions
       WHERE city_name = ? AND is_secondhand = 1 AND COALESCE(excluded,0) = 0
         AND deal_year BETWEEN ? AND ?
       GROUP BY deal_year HAVING COUNT(*) >= ?)
  `);
  const statStmt = db.prepare(
    "SELECT COUNT(*) c FROM nadlan_year_room_stats WHERE city_name = ?"
  );

  const cities: CityCoverage[] = rows.map((r) => ({
    ...r,
    population: r.population != null ? Number(r.population) : null,
    dealsPer1k: r.population ? (r.deals / Number(r.population)) * 1000 : null,
    coveredYears: Number((coveredStmt.get(r.city, FROM_YEAR, TO_YEAR, MIN_N) as { c: number }).c),
    statRows: Number((statStmt.get(r.city) as { c: number }).c),
  }));
  cities.sort((a, b) => a.coveredYears - b.coveredYears || b.deals - a.deals);

  const span = TO_YEAR - FROM_YEAR + 1;
  const totals = {
    at: new Date().toISOString(),
    cities: cities.length,
    deals: cities.reduce((s, c) => s + c.deals, 0),
    coveredCells: cities.reduce((s, c) => s + c.coveredYears, 0),
    possibleCells: cities.length * span,
    fullCoverage: cities.filter((c) => c.coveredYears >= span).length,
    noStats: cities.filter((c) => c.statRows === 0).length,
    withBuildYear: cities.reduce((s, c) => s + c.withBuildYear, 0),
    classified: cities.reduce((s, c) => s + c.classified, 0),
  };

  if (has("json")) {
    console.log(JSON.stringify({ totals, cities }, null, 2));
    db.close();
    return;
  }

  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "0.0");
  const num = (v: number) => v.toLocaleString("en");

  console.log(`\nכיסוי נתונים · ${FROM_YEAR}–${TO_YEAR} · סף ${MIN_N} עסקאות לשנה\n`);
  console.log(`  ערים                    ${num(totals.cities)}`);
  console.log(`  עסקאות בחלון            ${num(totals.deals)}`);
  console.log(`  תאי עיר×שנה מכוסים      ${num(totals.coveredCells)} / ${num(totals.possibleCells)}  (${pct(totals.coveredCells, totals.possibleCells)}%)`);
  console.log(`  ערים עם כל ${span} השנים    ${num(totals.fullCoverage)}`);
  console.log(`  עם שנת בנייה            ${num(totals.withBuildYear)}  (${pct(totals.withBuildYear, totals.deals)}%)`);
  console.log(`  מסווגות                 ${num(totals.classified)}  (${pct(totals.classified, totals.deals)}%)`);
  if (totals.noStats) {
    console.log(`\n  ⚠ ${totals.noStats} ערים עם עסקאות אך אפס שורות סטטיסטיקה — עמוד ריק לגולש`);
  }

  // Rate outliers. A city an order of magnitude below the national rate is
  // either a market that barely trades or a collector that fails on it, and
  // those need opposite responses — so name them rather than let them sit
  // inside an aggregate.
  const rated = cities.filter((c) => c.dealsPer1k != null).sort((a, b) => a.dealsPer1k! - b.dealsPer1k!);
  if (rated.length > 4) {
    const median = rated[Math.floor(rated.length / 2)].dealsPer1k!;
    const suspect = rated.filter((c) => c.dealsPer1k! < median / 10);
    console.log(`\n  קצב עסקאות ל-1,000 תושבים · חציון ארצי ${median.toFixed(1)}`);
    console.log(`  הנמוכות ביותר:`);
    for (const c of rated.slice(0, 8)) {
      console.log(`    ${c.city.padEnd(20)}${c.dealsPer1k!.toFixed(2).padStart(7)}  (${c.deals.toLocaleString("en")} עסקאות · ${(c.population ?? 0).toLocaleString("en")} תושבים)`);
    }
    if (suspect.length) {
      console.log(`\n  ⚠ ${suspect.length} ערים מתחת לעשירית מהחציון הארצי.`);
      console.log(`    זה או שוק שכמעט לא נסחר, או כשל איסוף שיטתי — שני דברים`);
      console.log(`    שדורשים תגובה הפוכה. לבדוק עיר אחת מהן ידנית לפני שמסיקים.`);
    }
  }

  // ── comparison with the last snapshot ────────────────────────────
  // The single most useful line in the report: it is what tells you whether the
  // last pulse was worth running.
  if (fs.existsSync(SNAPSHOT)) {
    try {
      const prev = JSON.parse(fs.readFileSync(SNAPSHOT, "utf-8")) as { totals: typeof totals };
      const d = (a: number, b: number) => (a - b >= 0 ? `+${num(a - b)}` : num(a - b));
      console.log(`\nמאז ${prev.totals.at.slice(0, 16).replace("T", " ")}:`);
      console.log(`  עסקאות          ${d(totals.deals, prev.totals.deals)}`);
      console.log(`  תאים מכוסים     ${d(totals.coveredCells, prev.totals.coveredCells)}`);
      console.log(`  עם שנת בנייה    ${d(totals.withBuildYear, prev.totals.withBuildYear)}`);
      console.log(`  מסווגות         ${d(totals.classified, prev.totals.classified)}`);
      if (totals.coveredCells === prev.totals.coveredCells && totals.deals > prev.totals.deals) {
        console.log(`\n  ℹ נוספו עסקאות אך אף תא לא חצה את הסף — הפעימה הבאה כנראה לא תשנה הרבה.`);
      }
    } catch { console.log("\n(קובץ ההשוואה הקודם פגום — מדלג)"); }
  } else {
    console.log(`\n(אין תמונת מצב קודמת. הרץ עם --save כדי שהריצה הבאה תוכל להשוות.)`);
  }

  // ── the gaps ─────────────────────────────────────────────────────
  const gaps = cities.filter((c) => c.coveredYears < span);
  const show = has("all") ? gaps : gaps.slice(0, 25);
  if (show.length) {
    console.log(`\n${has("all") ? "כל" : "25"} הערים החסרות ביותר (${num(gaps.length)} סה"כ):\n`);
    console.log(`  ${"עיר".padEnd(22)}${"שנים".padStart(7)}${"עסקאות".padStart(10)}${"שנת בנייה".padStart(11)}${"סטט׳".padStart(8)}`);
    console.log(`  ${"─".repeat(56)}`);
    for (const c of show) {
      const flag = c.statRows === 0 ? " ⚠" : "";
      console.log(
        `  ${c.city.padEnd(22)}${`${c.coveredYears}/${span}`.padStart(7)}${num(c.deals).padStart(10)}` +
        `${num(c.withBuildYear).padStart(11)}${num(c.statRows).padStart(8)}${flag}`
      );
    }
    if (!has("all") && gaps.length > show.length) {
      console.log(`\n  … ועוד ${num(gaps.length - show.length)}. --all להצגת כולן.`);
    }
  } else {
    console.log(`\n✓ כל הערים מכוסות לכל ${span} השנים.`);
  }

  if (has("save")) {
    fs.writeFileSync(SNAPSHOT, JSON.stringify({ totals, cities }, null, 2), "utf-8");
    console.log(`\n✓ תמונת מצב נשמרה → ${SNAPSHOT}`);
  } else {
    console.log(`\n(--save כדי לשמור תמונת מצב להשוואה אחרי הפעימה הבאה)`);
  }

  db.close();
}

/** Year-by-year detail for one city — what a pulse for it would actually fix. */
function printCity(db: Database.Database, city: string, minN: number) {
  const rows = db.prepare(`
    SELECT deal_year AS y,
           COUNT(*) AS deals,
           SUM(CASE WHEN is_secondhand = 1 THEN 1 ELSE 0 END) AS sh,
           SUM(CASE WHEN year_built > 0 THEN 1 ELSE 0 END) AS yb,
           SUM(CASE WHEN source = 'nadlan' THEN 1 ELSE 0 END) AS nadlan
      FROM nadlan_transactions
     WHERE city_name = ? AND COALESCE(excluded,0) = 0 AND deal_year BETWEEN ? AND ?
     GROUP BY deal_year ORDER BY deal_year
  `).all(city, FROM_YEAR, TO_YEAR) as Array<{ y: number; deals: number; sh: number; yb: number; nadlan: number }>;

  if (!rows.length) { console.log(`\nאין עסקאות ל"${city}" בין ${FROM_YEAR} ל-${TO_YEAR}.`); return; }

  console.log(`\n${city} · ${FROM_YEAR}–${TO_YEAR} · סף ${minN}\n`);
  console.log(`  ${"שנה".padEnd(7)}${"עסקאות".padStart(9)}${"יד-2".padStart(8)}${"שנת בנייה".padStart(11)}${"nadlan".padStart(9)}`);
  console.log(`  ${"─".repeat(45)}`);
  const byYear = new Map(rows.map((r) => [r.y, r]));
  for (let y = FROM_YEAR; y <= TO_YEAR; y++) {
    const r = byYear.get(y);
    if (!r) { console.log(`  ${String(y).padEnd(7)}${"—".padStart(9)}${"—".padStart(8)}${"—".padStart(11)}${"—".padStart(9)}  ✗ אין נתונים`); continue; }
    const ok = r.sh >= minN;
    console.log(
      `  ${String(y).padEnd(7)}${r.deals.toLocaleString("en").padStart(9)}${r.sh.toLocaleString("en").padStart(8)}` +
      `${r.yb.toLocaleString("en").padStart(11)}${r.nadlan.toLocaleString("en").padStart(9)}  ${ok ? "✓" : "✗ מתחת לסף"}`
    );
  }
}

main();
