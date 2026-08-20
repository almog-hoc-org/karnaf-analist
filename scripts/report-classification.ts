#!/usr/bin/env tsx
/**
 * Which cities can show the second-hand / new split, and which genuinely cannot.
 *
 * WHY THIS EXISTS
 * The split was disabled for twelve cities by a single condition —
 * `govCity && k !== "all"` in the chart — that read the city's SOURCE LABEL
 * instead of its data. Cities with a hundred classified second-hand deals in
 * the current year had both buttons greyed out, with a tooltip explaining a
 * limitation of a channel those series do not use. Nothing in the codebase
 * could have surfaced that, because nothing was asking the question.
 *
 * So this asks it, for every city, against the same rule the site now applies:
 *   · a deal is classifiable ONLY if it carries a usable build year
 *   · a cell is displayable only at min_deals_per_year or above
 *   · everything clean goes into "כללי", build year or not
 *
 * IT ALSO RE-MEASURES THE FINDING THAT THE OLD RULE WAS PROTECTING. "כללי"
 * used to exclude unclassified deals because in Tel Aviv the no-build-year
 * group is heavy with presale marketing prices and pushed the headline ABOVE
 * both of its own subsets. Dropping those deals was the wrong instrument — they
 * happened — but the risk was real, so the check ships with the change rather
 * than being argued away: any city where "כללי" sits above both subsets is
 * printed with the gap.
 *
 *   npx tsx scripts/report-classification.ts          summary + the notable cities
 *   npx tsx scripts/report-classification.ts --all    every city
 *   npx tsx scripts/report-classification.ts --json
 *
 * Read-only, and always exits 0: a report, not a gate.
 */
import Database from "better-sqlite3";
import path from "path";
import { getRuleNum } from "../lib/systemRules";
import { historyFromYear } from "../lib/historyWindow";

const DATA_DIR = process.env.KARNAF_DATA_DIR ?? "./data";
const DB_PATH = path.resolve(DATA_DIR, "realestate.db");

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(`--${f}`);

type Verdict = "split" | "sh-only" | "none";

interface CityRow {
  city: string;
  deals: number;
  withBuildYear: number;
  buildYearPct: number;
  /** year×bucket cells clearing the floor, per scope */
  cellsAll: number;
  cellsSh: number;
  cellsNew: number;
  /** best single-year n, per scope — what actually decides availability */
  bestSh: number;
  bestNew: number;
  govmapHeadline: boolean;
  verdict: Verdict;
  /** the sanity check: headline ₪/m² vs both subsets in the reference year */
  headlineAbovePct: number | null;
}

function main() {
  const minDeals = getRuleNum("min_deals_per_year", 10);
  const fromYear = historyFromYear();
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

  // Build-year coverage comes from the transactions, with the SAME sanity
  // filters the aggregation applies — otherwise the percentage here describes
  // a population the graph never sees.
  const coverage = db.prepare(`
    SELECT city_name AS city,
           COUNT(*) AS deals,
           SUM(CASE WHEN COALESCE(year_built,0) > 1800 THEN 1 ELSE 0 END) AS withBuildYear
      FROM nadlan_transactions
     WHERE COALESCE(excluded,0) = 0 AND COALESCE(luxury,0) = 0
       AND deal_year >= ? AND source <> 'govmap'
     GROUP BY city_name
  `).all(fromYear) as Array<{ city: string; deals: number; withBuildYear: number }>;

  const cells = db.prepare(`
    SELECT city_name AS city, scope, COUNT(*) AS cells, MAX(n) AS best
      FROM nadlan_year_room_stats
     WHERE n >= ?
     GROUP BY city_name, scope
  `).all(minDeals) as Array<{ city: string; scope: string; cells: number; best: number }>;

  const govmapCities = new Set(
    (db.prepare(
      "SELECT DISTINCT city_name AS city FROM nadlan_year_room_stats WHERE scope='all_govmap'"
    ).all() as Array<{ city: string }>).map((r) => r.city)
  );

  // The sanity check, in the reference year: headline vs both subsets.
  const refYear = getRuleNum("ref_year");
  const levels = db.prepare(`
    SELECT city_name AS city, scope, avg_sqm AS sqm
      FROM nadlan_year_room_stats
     WHERE year = ? AND room_bucket = 'all' AND n >= ? AND avg_sqm IS NOT NULL
  `).all(refYear, minDeals) as Array<{ city: string; scope: string; sqm: number }>;
  const levelOf = new Map<string, Map<string, number>>();
  for (const r of levels) {
    let m = levelOf.get(r.city);
    if (!m) { m = new Map(); levelOf.set(r.city, m); }
    m.set(r.scope, Number(r.sqm));
  }

  const byCity = new Map<string, CityRow>();
  const allCities = new Set<string>([...coverage.map((c) => c.city), ...cells.map((c) => c.city)]);
  for (const city of allCities) {
    byCity.set(city, {
      city, deals: 0, withBuildYear: 0, buildYearPct: 0,
      cellsAll: 0, cellsSh: 0, cellsNew: 0, bestSh: 0, bestNew: 0,
      govmapHeadline: govmapCities.has(city), verdict: "none", headlineAbovePct: null,
    });
  }
  for (const c of coverage) {
    const row = byCity.get(c.city);
    if (!row) continue;
    row.deals = Number(c.deals);
    row.withBuildYear = Number(c.withBuildYear);
    row.buildYearPct = row.deals ? Math.round((row.withBuildYear / row.deals) * 100) : 0;
  }
  for (const c of cells) {
    const row = byCity.get(c.city);
    if (!row) continue;
    if (c.scope === "all" || c.scope === "all_govmap") row.cellsAll += Number(c.cells);
    if (c.scope === "secondhand") { row.cellsSh = Number(c.cells); row.bestSh = Number(c.best); }
    if (c.scope === "new") { row.cellsNew = Number(c.cells); row.bestNew = Number(c.best); }
  }

  for (const row of byCity.values()) {
    // Mirrors dealTypeAvailable() in components/MultiChartStudio: a deal type
    // is offered when its own series clears the floor in at least one year.
    row.verdict = row.cellsSh > 0 && row.cellsNew > 0 ? "split"
      : row.cellsSh > 0 ? "sh-only"
      : "none";

    const m = levelOf.get(row.city);
    const head = m?.get("all") ?? m?.get("all_govmap");
    const sh = m?.get("secondhand");
    const nw = m?.get("new");
    if (head != null && sh != null && nw != null && head > sh && head > nw) {
      row.headlineAbovePct = Math.round((head / Math.max(sh, nw) - 1) * 100);
    }
  }

  const cities = [...byCity.values()].sort((a, b) => b.deals - a.deals || a.city.localeCompare(b.city, "he"));
  const split = cities.filter((c) => c.verdict === "split");
  const shOnly = cities.filter((c) => c.verdict === "sh-only");
  const none = cities.filter((c) => c.verdict === "none");
  // The cities the old rule silenced: govmap-headline cities that DO have a split.
  const unblocked = cities.filter((c) => c.govmapHeadline && c.verdict !== "none");
  const suspicious = cities.filter((c) => c.headlineAbovePct != null && c.headlineAbovePct >= 5);

  if (has("json")) {
    console.log(JSON.stringify({
      rules: { minDeals, fromYear, refYear },
      totals: { cities: cities.length, split: split.length, shOnly: shOnly.length, none: none.length,
                unblocked: unblocked.length, suspicious: suspicious.length },
      cities,
    }, null, 2));
    db.close();
    return;
  }

  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - [...s].length));
  console.log(`\nסיווג יד-2/חדשות · סף ${minDeals} עסקאות לתא · שנת בנייה בלבד · משנת ${fromYear}\n`);
  console.log(`  ערים                     ${cities.length}`);
  console.log(`  ✓ פילוח מלא (יד-2+חדשות) ${split.length}`);
  console.log(`  ~ יד-2 בלבד              ${shOnly.length}`);
  console.log(`  ✗ ללא פילוח              ${none.length}`);
  console.log(`  ↑ נפתחו בתיקון הזה       ${unblocked.length}  (ערים שסדרת הכותרת שלהן מ-govmap ושהפילוח בהן היה חסום)`);

  const head = () => {
    console.log(`\n  ${pad("עיר", 20)}${pad("עסקאות", 9)}${pad("שנת בנייה", 11)}${pad("תאי יד-2", 10)}${pad("תאי חדשות", 11)}${pad("שיא יד-2", 10)}${pad("שיא חדשות", 10)}`);
  };
  const line = (c: CityRow) => {
    console.log(`  ${pad(c.city, 20)}${pad(c.deals.toLocaleString("en"), 9)}${pad(`${c.buildYearPct}%`, 11)}` +
      `${pad(String(c.cellsSh), 10)}${pad(String(c.cellsNew), 11)}${pad(String(c.bestSh), 10)}${pad(String(c.bestNew), 10)}` +
      (c.govmapHeadline ? " ג" : ""));
  };

  if (unblocked.length) {
    console.log(`\n\n↑ ערים שהפילוח בהן היה חסום ועכשיו זמין (${unblocked.length})`);
    head();
    for (const c of unblocked) line(c);
  }

  console.log(`\n\n✗ ערים ללא פילוח — אין בהן מספיק עסקאות עם שנת בנייה (${none.length})`);
  if (none.length) {
    head();
    for (const c of (has("all") ? none : none.slice(0, 30))) line(c);
    if (!has("all") && none.length > 30) console.log(`  … ועוד ${none.length - 30} (--all לרשימה המלאה)`);
  }

  if (has("all")) {
    console.log(`\n\n✓ ערים עם פילוח מלא (${split.length})`);
    head();
    for (const c of split) line(c);
  }

  console.log(`\n\nבדיקת שפיות — "כללי" מעל שתי תת-הסדרות בשנת ${refYear} (${suspicious.length} ערים)`);
  console.log(`  זו הבדיקה של הממצא שבגללו "כללי" סינן פעם עסקאות לא-מסווגות. פער קטן`);
  console.log(`  הוא תמהיל רגיל; פער גדול אומר שקבוצת חסרי-שנת-הבנייה מושכת את הכותרת למעלה.`);
  if (!suspicious.length) {
    console.log(`  ✓ אין ערים כאלה — הסינון של חריגים ויוקרה תופס את מה שהפילטר הישן תפס.`);
  } else {
    for (const c of suspicious.slice(0, 20)) {
      console.log(`    ${pad(c.city, 20)}+${c.headlineAbovePct}%  (${c.buildYearPct}% מהעסקאות עם שנת בנייה)`);
    }
  }
  console.log("");
  db.close();
}

main();
