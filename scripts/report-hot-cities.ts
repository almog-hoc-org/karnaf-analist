#!/usr/bin/env tsx
/**
 * Print exactly what the home page's "ערים חמות" cards will show.
 *
 * WHY THIS EXISTS. Everything else about this section is verified against
 * synthetic rows: a seeded city has a clean price series, a 4-room bucket and
 * a second-hand count for every year, so the cards always look full. Real
 * cities do not. `loadSecondhandChanges` drops thin-sample cities entirely,
 * the 4-room figure needs n>=10 in the reference year, and a city can be in
 * the database with no usable second-hand series at all.
 *
 * The failure mode is not a crash — it is three cards rendering "—" on the
 * first screen of the site, which is worse than not having the section. So
 * this prints the real values and exits non-zero if a card would come out
 * empty, which is the only way to find out before a visitor does.
 *
 *   npx tsx scripts/report-hot-cities.ts
 */
import { loadHotCities } from "../lib/hotCities";

async function main() {
  const { cities, source } = await loadHotCities(3);
  console.log(`source = ${source}  ·  ${cities.length} cards\n`);

  if (!cities.length) {
    console.error("FAIL: no cards at all — the rule names cities that are not in the database");
    return 1;
  }

  let bad = 0;
  for (const c of cities) {
    const trend = c.trend.length ? c.trend.map((p) => `${p.year}:${Math.round(p.value)}`).join(" ") : "—";
    console.log(`${c.cityName}`);
    console.log(`  מגמת מחיר    : ${c.changePct == null ? "— (חסר!)" : `${c.changePct.toFixed(1)}% (${c.changeFromYear}→${c.changeToYear})${c.partial ? " חלקית" : ""}`}`);
    console.log(`  גרף מוקטן    : ${c.trend.length} נקודות  ${trend}`);
    console.log(`  קונים יד-2   : ${
      c.buyers
        ? `${c.buyers.pct == null ? "— (מדגם קטן מדי)" : `${c.buyers.pct.toFixed(1)}%`} · ${c.buyers.windowLabel} מול אשתקד (${c.buyers.current} מול ${c.buyers.previous})`
        : "— (חסר!)"
    }`);
    console.log(`  נתון שלישי   : ${c.extra ? `${c.extra.label} ${c.extra.value} (${c.extra.year})` : "— (חסר!)"}`);

    const missing = [
      c.changePct == null && "מגמת מחיר",
      c.trend.length < 2 && "גרף",
      c.buyers?.pct == null && "מגמת קונים",
      !c.extra && "נתון שלישי",
    ].filter(Boolean);
    if (missing.length) {
      bad += 1;
      console.log(`  ⚠ חסר: ${missing.join(", ")}`);
    }
    console.log();
  }

  if (bad) {
    console.error(`FAIL: ${bad} of ${cities.length} cards would render with a missing figure`);
    return 1;
  }
  console.log("every card has all three figures and a drawable line");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("threw:", e);
    process.exit(1);
  });
