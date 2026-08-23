#!/usr/bin/env tsx
/**
 * How many rows of the live /cities table actually show a 3-year change.
 *
 * WHY THIS AND NOT A DATABASE QUERY
 * scripts/diagnose-price-change-3y.ts asked the database and got a clean bill
 * of health: 122 of 122 cities can form a 3-year window from
 * nadlan_price_trends, every one of them 2020–2025 with no gaps. The column is
 * still empty in every row on the phone. Both statements can be true at once,
 * because the table is not built from the database directly — it is built from
 * loadAllCityPriceChanges(), which is memoised for six hours, and a script
 * cannot see that cache: lib/cache.ts deliberately falls through to the
 * uncached loader outside the Next runtime.
 *
 * This is the same blind spot that kept the movers board blank across several
 * rounds of "fixes" while the diagnostic reported everything fine. So this asks
 * the SERVER, over HTTP, and reads the HTML that came back — the only vantage
 * point from which the cache is visible.
 *
 *   npx tsx scripts/probe-cities-table.ts [url]
 */
const URL_ = process.argv[2] ?? "http://127.0.0.1:3000/cities";

/** The column is found by its HEADER, not by a fixed index: the visible set and
 *  its order are both editable, so an index would quietly read the wrong column
 *  the first time someone reorders the table. */
const HEADER_TEXT = "שינוי 3 שנים";
const CITY_COL = 0;

/** Text of one cell/header, given the fragment that FOLLOWS its "<td"/"<th".
 *  The attributes have to go first: they are full of digits (top-14, z-10),
 *  and a naive tag-strip leaves them in — which made the first version of this
 *  probe report "has a number" for every empty cell on the page. */
const cellText = (fragment: string) => {
  const gt = fragment.indexOf(">");
  const inner = gt < 0 ? fragment : fragment.slice(gt + 1);
  return inner
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
};

async function main(): Promise<number> {
  let html: string;
  try {
    const res = await fetch(URL_, { headers: { "user-agent": "karnaf-probe/1.0" }, signal: AbortSignal.timeout(45_000) });
    if (!res.ok) { console.error(`✗ ${URL_} החזיר ${res.status}`); return 1; }
    html = await res.text();
  } catch (e) {
    console.error(`✗ לא הצלחנו למשוך את ${URL_}: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  const head = html.split("<thead")[1]?.split("</thead")[0];
  if (!head) { console.error("✗ אין <thead> בעמוד — הטבלה לא רונדרה כלל"); return 1; }
  const headers = head.split("<th").slice(1).map(cellText);
  const col = headers.findIndex((h) => h.includes(HEADER_TEXT));
  if (col < 0) {
    console.error(`✗ אין עמודה בשם ״${HEADER_TEXT}״ בטבלה. העמודות שנמצאו: ${headers.join(" | ")}`);
    return 1;
  }
  console.log(`עמודת ״${HEADER_TEXT}״ נמצאה במקום ${col + 1} מתוך ${headers.length}`);

  const body = html.split("<tbody")[1];
  if (!body) { console.error("✗ אין <tbody> בעמוד — הטבלה לא רונדרה כלל"); return 1; }
  const rows = body.split("<tr").slice(1);
  if (rows.length === 0) { console.error("✗ אין שורות בטבלה"); return 1; }

  let withValue = 0;
  const empty: string[] = [];
  for (const row of rows) {
    const cells = row.split("<td").slice(1).map(cellText);
    const city = cells[CITY_COL] ?? "?";
    const chg = cells[col] ?? "";
    if (/\d/.test(chg)) withValue++;
    else if (empty.length < 10) empty.push(city);
  }

  console.log(`שורות בטבלה: ${rows.length}`);
  console.log(`מתוכן עם נתון ״שינוי 3 שנים״: ${withValue}`);
  if (empty.length) console.log(`דוגמאות ללא נתון: ${empty.join(" · ")}`);

  if (withValue === 0) {
    console.error("✗ אף שורה לא מציגה שינוי 3 שנים — הנתון קיים במסד, ולכן הכשל הוא בין הטעינה לתצוגה");
    return 1;
  }
  console.log(`✓ ${Math.round((withValue / rows.length) * 100)}% מהשורות מציגות שינוי 3 שנים`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });

// module scope, not global: these scripts each define main(), and a file with
// no top-level import/export is a GLOBAL script to tsc, so two of them collide.
export {};
