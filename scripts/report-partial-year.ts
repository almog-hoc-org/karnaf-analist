#!/usr/bin/env tsx
/**
 * Who is ready for the running year, and who is not — city by city, with counts.
 *
 * WHY THIS EXISTS
 * The site used to refuse the current year outright: "2026 חלקית, לא מחושבת".
 * That rule was half right. Deal COUNTS do grow with time, so comparing seven
 * months of volume against twelve is simply wrong. But ₪/m² is a RATE — seven
 * months produce the same kind of number as twelve, from a smaller sample — and
 * blanket-excluding it pinned every headline to a year that gets staler daily,
 * in cities already holding hundreds of fresh deals.
 *
 * lib/nadlanTransactionSeries now qualifies a partial year per city, on
 * evidence. This script is the audit of that decision: it answers "which
 * cities, and on how much data" in numbers rather than in confidence, and it
 * reads the SAME two admin rules the site reads, so the report and the site can
 * never disagree about where the line is.
 *
 * The per-cell breakdown matters as much as the verdict. The site's chart hides
 * any cell under the n floor, so a city can be a legitimate endpoint for
 * "כללי" and show nothing at all for "5 חדרים, חדשות" — which is correct, not
 * a bug. The table shows both so that distinction is visible.
 *
 *   npx tsx scripts/report-partial-year.ts            the running year
 *   npx tsx scripts/report-partial-year.ts --year=2026
 *   npx tsx scripts/report-partial-year.ts --all      every city, not just a head
 *   npx tsx scripts/report-partial-year.ts --json
 *
 * Read-only, and always exits 0: this is a report, not a gate.
 */
import Database from "better-sqlite3";
import path from "path";
import { getRuleNum } from "../lib/systemRules";

const DATA_DIR = process.env.KARNAF_DATA_DIR ?? "./data";
const DB_PATH = path.resolve(DATA_DIR, "realestate.db");

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(`--${f}`);
const val = (f: string) => argv.find((a) => a.startsWith(`--${f}=`))?.split("=")[1];

const YEAR = Number(val("year") ?? new Date().getFullYear());

/**
 * The scopes a reader actually chooses between in the chart, in the order the
 * UI offers them.
 *
 * "כללי" reads TWO stored scopes. Cities whose nadlan coverage is too thin get
 * their headline series built from govmap instead, stored as "all_govmap"
 * (scripts/aggregate-nadlan-transactions), and lib/nadlanTransactionSeries
 * falls back to it. The first version of this report read only "all" and
 * therefore declared a dozen govmap-sourced cities — Dimona, Karmiel, Migdal
 * HaEmek — unready for a year their own city page was already using. A report
 * that disagrees with the site is worse than no report, so the fallback is
 * mirrored here and the substitution is marked in the output rather than
 * hidden.
 */
const SCOPES = [
  { key: "all", label: "כללי", fallback: "all_govmap" },
  { key: "secondhand", label: "יד-2", fallback: null },
  { key: "new", label: "חדשות", fallback: null },
] as const;
const STORED_SCOPES = ["all", "all_govmap", "secondhand", "new"] as const;
const BUCKETS = ["all", "3", "4", "5"] as const;

type Verdict = "qualified" | "partial" | "none";

interface CityReport {
  city: string;
  months: number;
  deals: number;
  /** scope → bucket → n */
  cells: Record<string, Record<string, number>>;
  /** headline cell: scope "all", room "all" — what the qualification test reads */
  headlineN: number;
  /** how many of the 12 scope×size cells clear the n floor */
  cellsOverFloor: number;
  /** true when "כללי" came from the govmap series because no nadlan "all" exists */
  govmapHeadline: boolean;
  verdict: Verdict;
}


/** n for a scope×bucket cell, through the same govmap fallback the site uses. */
function nOf(c: CityReport, scope: string, fallback: string | null, bucket: string): number {
  const direct = c.cells[scope]?.[bucket] ?? 0;
  if (direct > 0 || !fallback) return direct;
  return c.cells[fallback]?.[bucket] ?? 0;
}

function main() {
  const minMonths = getRuleNum("partial_year_min_months", 4);
  const minDeals = getRuleNum("min_deals_per_year", 10);
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

  // Months and raw deal volume come from the transactions themselves — the same
  // COUNT(DISTINCT substr(deal_date,6,2)) the series loader uses, so "7 חודשים"
  // here means exactly what "7 חודשים" means on the city page.
  const monthRows = db.prepare(`
    SELECT city_name AS city,
           COUNT(DISTINCT substr(deal_date,6,2)) AS months,
           COUNT(*) AS deals
      FROM nadlan_transactions
     WHERE deal_year = ? AND COALESCE(excluded,0) = 0
     GROUP BY city_name
  `).all(YEAR) as { city: string; months: number; deals: number }[];

  const statRows = db.prepare(`
    SELECT city_name AS city, scope, room_bucket AS bucket, n
      FROM nadlan_year_room_stats
     WHERE year = ?
  `).all(YEAR) as { city: string; scope: string; bucket: string; n: number }[];

  // Every city the archive knows about, not just those with rows in THIS year —
  // a city with zero 2026 deals is a finding, and dropping it would hide it.
  const allCities = (db.prepare(
    "SELECT DISTINCT city_name AS city FROM nadlan_year_room_stats"
  ).all() as { city: string }[]).map((r) => r.city);

  const byCity = new Map<string, CityReport>();
  for (const city of allCities) {
    byCity.set(city, {
      city, months: 0, deals: 0,
      cells: Object.fromEntries(STORED_SCOPES.map((s) => [s, {} as Record<string, number>])),
      headlineN: 0, cellsOverFloor: 0, verdict: "none", govmapHeadline: false,
    });
  }
  for (const r of monthRows) {
    const c = byCity.get(r.city);
    if (!c) continue;
    c.months = Number(r.months);
    c.deals = Number(r.deals);
  }
  for (const r of statRows) {
    const c = byCity.get(r.city);
    if (!c || !c.cells[r.scope]) continue;
    c.cells[r.scope][r.bucket] = Number(r.n);
  }

  for (const c of byCity.values()) {
    c.govmapHeadline = (c.cells.all?.all ?? 0) === 0 && (c.cells.all_govmap?.all ?? 0) > 0;
    // Exactly the site's expression, in the same order — see lib/nadlanTransactionSeries.
    c.headlineN = c.cells.all?.all ?? c.cells.all_govmap?.all ?? 0;
    c.cellsOverFloor = SCOPES.reduce(
      (s, sc) => s + BUCKETS.filter((b) => nOf(c, sc.key, sc.fallback, b) >= minDeals).length, 0
    );
    // The verdict mirrors lib/nadlanTransactionSeries EXACTLY. If that rule
    // changes, this line changes with it or the report starts lying.
    c.verdict =
      c.months >= minMonths && c.headlineN >= minDeals ? "qualified"
      : c.deals > 0 ? "partial"
      : "none";
  }

  const cities = [...byCity.values()].sort(
    (a, b) => b.deals - a.deals || a.city.localeCompare(b.city, "he")
  );
  const qualified = cities.filter((c) => c.verdict === "qualified");
  const partial = cities.filter((c) => c.verdict === "partial");
  const none = cities.filter((c) => c.verdict === "none");

  if (has("json")) {
    console.log(JSON.stringify({
      year: YEAR, rules: { minMonths, minDeals },
      totals: {
        cities: cities.length,
        qualified: qualified.length, partial: partial.length, none: none.length,
        deals: cities.reduce((s, c) => s + c.deals, 0),
      },
      cities,
    }, null, 2));
    db.close();
    return;
  }

  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - [...s].length));
  const cell = (c: CityReport, scope: string, fallback: string | null, bucket: string) => {
    const n = nOf(c, scope, fallback, bucket);
    return n === 0 ? "·" : n >= minDeals ? String(n) : `(${n})`;
  };

  console.log(`\nכשירות ${YEAR} כנקודת קצה · סף ${minMonths} חודשים + ${minDeals} עסקאות בתא הכותרת\n`);
  console.log(`  ערים במאגר            ${cities.length}`);
  console.log(`  ✓ כשירות ל-${YEAR}       ${qualified.length}`);
  console.log(`  ~ יש דאטה, לא מספיק   ${partial.length}`);
  console.log(`  ✗ אין דאטה כלל        ${none.length}`);
  console.log(`  סה״כ עסקאות ${YEAR}     ${cities.reduce((s, c) => s + c.deals, 0).toLocaleString("en")}`);

  const head = () => {
    console.log(`\n  ${pad("עיר", 20)}${pad("חוד׳", 6)}${pad("עסקאות", 9)}` +
      SCOPES.map((s) => pad(s.label, 22)).join(""));
    console.log(`  ${pad("", 35)}${SCOPES.map(() => pad("הכל  3    4    5", 22)).join("")}`);
  };
  const line = (c: CityReport) => {
    console.log(`  ${pad(c.city, 20)}${pad(String(c.months), 6)}${pad(c.deals.toLocaleString("en"), 9)}` +
      SCOPES.map((s) => pad(BUCKETS.map((b) => pad(cell(c, s.key, s.fallback, b), 5)).join(""), 22)).join("") +
      (c.govmapHeadline ? "  ג" : ""));
  };

  const show = has("all") ? qualified : qualified.slice(0, 40);
  console.log(`\n\n✓ ערים שבהן ${YEAR} נכנסת לגרף כנקודת קצה (${qualified.length})`);
  console.log(`  מספר בסוגריים = תא מתחת לסף; הגרף יסתיר אותו ויציג את השאר.`);
  console.log(`  ג = סדרת "כללי" מגיעה מ-govmap, כי כיסוי רשות המסים בעיר דל מדי.`);
  head();
  for (const c of show) line(c);
  if (show.length < qualified.length) console.log(`  … ועוד ${qualified.length - show.length} (--all לרשימה המלאה)`);

  console.log(`\n\n~ ערים עם דאטה ${YEAR} שאינה מספיקה כנקודת קצה (${partial.length})`);
  console.log(`  אלו ממשיכות להשוות עד השנה המלאה האחרונה, בדיוק כמו קודם.`);
  if (partial.length) {
    head();
    for (const c of (has("all") ? partial : partial.slice(0, 25))) line(c);
    if (!has("all") && partial.length > 25) console.log(`  … ועוד ${partial.length - 25}`);
  }

  console.log(`\n\n✗ ערים ללא אף עסקה ב-${YEAR} (${none.length})`);
  if (none.length) {
    const names = none.map((c) => c.city);
    for (let i = 0; i < names.length; i += 5) console.log(`  ${names.slice(i, i + 5).map((n) => pad(n, 20)).join("")}`);
  }
  console.log("");
  db.close();
}

main();
