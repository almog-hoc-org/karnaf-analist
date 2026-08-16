#!/usr/bin/env tsx
/**
 * Which loader throws for a given city — and for how many cities does one throw?
 *
 * Written for a live report: "מגדל העמק" returned Next's server-exception
 * screen (digest 1896103521) while other cities rendered. A digest is a hash,
 * not a message: it tells the operator nothing and it is deliberately opaque
 * in the browser. Reproducing per city, loader by loader, is the only way to
 * turn it into a name.
 *
 * Runs every data path the city page runs, in the same order, and reports the
 * first failure per city. --all sweeps every city so a single report becomes a
 * census: one broken city is a bug, forty is a class of bug.
 *
 * Run: npx tsx scripts/diagnose-city-render.ts "מגדל העמק"
 *      npx tsx scripts/diagnose-city-render.ts --all
 */
import { prisma } from "../lib/db";
import { getCityInsights } from "../lib/insights";
import { computeCityGap } from "../lib/gap-analysis";
import { loadCityPriceChanges } from "../lib/price-changes";
import { loadCityTransactionPrices } from "../lib/cityTransactionPrices";
import { loadCityGraphSeries, loadCityDeals, loadDealCountCube, loadCityCleaningCounts } from "../lib/nadlanTransactionSeries";
import { loadCityPopulationEstimates } from "../lib/population-sources";
import { cityClassificationRate } from "../lib/classificationRate";
import { cityUrbanRenewalProjects } from "../lib/urbanRenewal";
import { getCityScatteredData } from "../lib/scatteredFacts";

type Step = { name: string; run: (city: string) => Promise<unknown> };

const STEPS: Step[] = [
  { name: "city.findUnique", run: (c) => prisma.city.findUnique({ where: { city_name: c } }) },
  { name: "citySales", run: (c) => prisma.citySales.findUnique({ where: { city_name: c } }) },
  { name: "buildingPermits", run: (c) => prisma.buildingPermit.findMany({ where: { city_name: c }, orderBy: { year: "asc" } }) },
  { name: "yad2", run: (c) => prisma.yad2_market_data.findUnique({ where: { city_name: c } }) },
  { name: "populationByYear", run: (c) => prisma.population_by_year.findMany({ where: { city_name: c }, orderBy: { year: "asc" } }) },
  { name: "priceTrends", run: (c) => prisma.nadlan_price_trends.findMany({ where: { city_name: c } }) },
  { name: "constructionStarts", run: (c) => prisma.construction_starts.findMany({ where: { city_name: c } }) },
  { name: "cbsPressData", run: (c) => prisma.cbsPressData.findMany({ where: { city_name: c } }) },
  { name: "getCityInsights", run: (c) => getCityInsights(c) },
  { name: "computeCityGap", run: (c) => computeCityGap(c, { windowStart: 2020, windowEnd: 2024 }) },
  { name: "loadCityPriceChanges", run: (c) => loadCityPriceChanges(c) },
  { name: "loadCityTransactionPrices", run: () => loadCityTransactionPrices() },
  { name: "loadCityGraphSeries", run: (c) => loadCityGraphSeries(c) },
  { name: "loadCityDeals", run: (c) => loadCityDeals(c) },
  { name: "loadDealCountCube", run: (c) => loadDealCountCube(c) },
  { name: "loadCityCleaningCounts", run: (c) => loadCityCleaningCounts(c) },
  { name: "loadCityPopulationEstimates", run: (c) => loadCityPopulationEstimates(c) },
  { name: "cityClassificationRate", run: (c) => cityClassificationRate(c) },
  { name: "cityUrbanRenewalProjects", run: (c) => cityUrbanRenewalProjects(c) },
  { name: "getCityScatteredData", run: async (c) => getCityScatteredData(c) },
];

async function diagnose(city: string, verbose: boolean): Promise<string | null> {
  for (const step of STEPS) {
    try {
      await step.run(city);
      if (verbose) console.log(`  ✓ ${step.name}`);
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      if (verbose) {
        console.log(`  ✗ ${step.name}`);
        console.log(`     ${msg}`);
        if (e instanceof Error && e.stack) console.log(e.stack.split("\n").slice(1, 5).join("\n"));
      }
      return `${step.name} — ${msg.slice(0, 160)}`;
    }
  }
  return null;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: diagnose-city-render.ts "<city>" | --all');
    process.exit(2);
  }

  if (arg !== "--all") {
    console.log(`בדיקת עמוד עיר: ${arg}\n`);
    const fail = await diagnose(arg, true);
    console.log(fail ? `\n✗ נכשל: ${fail}` : `\n✓ כל שלבי הטעינה עברו — התקלה אינה בשכבת הנתונים`);
    return;
  }

  const cities = (await prisma.city.findMany({ select: { city_name: true }, orderBy: { city_name: "asc" } }))
    .map((c) => c.city_name);
  console.log(`סורק ${cities.length} ערים…\n`);
  const failures: Array<{ city: string; why: string }> = [];
  for (const c of cities) {
    const fail = await diagnose(c, false);
    if (fail) failures.push({ city: c, why: fail });
  }

  if (!failures.length) {
    console.log("✓ אף עיר לא נכשלה בשכבת הנתונים");
    return;
  }
  console.log(`✗ ${failures.length} ערים נכשלות:\n`);
  // group by cause — one message repeated 40 times is one bug, not 40
  const byCause = new Map<string, string[]>();
  for (const f of failures) {
    const key = f.why.split(" — ")[0] + " — " + f.why.split(" — ")[1]?.slice(0, 80);
    const a = byCause.get(key) ?? [];
    a.push(f.city);
    byCause.set(key, a);
  }
  for (const [cause, list] of [...byCause.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  [${list.length}] ${cause}`);
    console.log(`      ${list.slice(0, 12).join(", ")}${list.length > 12 ? " …" : ""}`);
  }
  process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
