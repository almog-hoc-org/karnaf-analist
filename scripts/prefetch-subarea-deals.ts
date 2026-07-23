#!/usr/bin/env tsx
/**
 * One-shot pre-fetch of the (sub-area × room-count × year) deals matrix
 * for the ~20 cities in `lib/city-subareas.ts`.
 *
 * Usage:
 *   npx tsx scripts/prefetch-subarea-deals.ts               # all mapped cities, skip fresh
 *   npx tsx scripts/prefetch-subarea-deals.ts --force       # all mapped cities, re-fetch even if fresh
 *   npx tsx scripts/prefetch-subarea-deals.ts "תל אביב-יפו" "ירושלים"   # only these two
 *
 * Cache freshness is 30 days; older than that → re-fetch.
 *
 * NOTE: this script makes ~30 govmap API calls per city (≈12 seconds/city
 * after the 400ms delay). Expect ~3 minutes per city wall-clock. With 20
 * cities that's ~60 minutes total. Run it once, then schedule monthly.
 */
import { aggregateSubareaDeals, saveMatrix, cacheAgeDays } from "../lib/subarea-deals-service";
import { listMappedCities } from "../lib/city-subareas";
import { prisma } from "../lib/db";

const FRESHNESS_DAYS = 30;

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const all = argv.includes("--all");
  const cityNamesArg = argv.filter((a) => !a.startsWith("--"));
  // --all → every city in the DB (168). Otherwise: named cities, or the mapped 20.
  const cities = all
    ? (await prisma.city.findMany({ select: { city_name: true }, orderBy: { city_name: "asc" } })).map((c) => c.city_name)
    : cityNamesArg.length > 0
    ? cityNamesArg
    : listMappedCities();

  console.log(`\n=== prefetch-subarea-deals ===`);
  console.log(`Cities to process: ${cities.length}${force ? " (--force)" : ""}`);
  console.log(`Cache freshness threshold: ${FRESHNESS_DAYS} days\n`);

  let populated = 0;
  let skippedFresh = 0;
  let empty = 0;
  let errored = 0;

  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    const tag = `[${i + 1}/${cities.length}] ${city}`;

    const age = cacheAgeDays(city);
    if (!force && age !== null && age < FRESHNESS_DAYS) {
      console.log(`${tag}: skip (cache age ${age.toFixed(1)} days < ${FRESHNESS_DAYS})`);
      skippedFresh++;
      continue;
    }

    const t0 = Date.now();
    try {
      const matrix = await aggregateSubareaDeals(city);
      const filePath = saveMatrix(matrix);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      // Count populated cells (cells with >=1 deal) for sanity
      let cellsPopulated = 0;
      let cellsTotal = 0;
      for (const yearMatrix of Object.values(matrix.byYear)) {
        for (const row of yearMatrix.rows) {
          for (const cell of Object.values(row.byRoom)) {
            cellsTotal++;
            if (cell.dealCount > 0) cellsPopulated++;
          }
        }
      }

      if (matrix.totalDealsKept === 0) {
        console.log(`${tag}: EMPTY (no deals) ${elapsed}s → ${filePath}`);
        empty++;
      } else {
        console.log(
          `${tag}: ${matrix.totalDealsKept}/${matrix.totalRawDealsFetched} deals, ${cellsPopulated}/${cellsTotal} cells filled, ${elapsed}s`
        );
        populated++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${tag}: ERROR — ${msg}`);
      errored++;
    }
  }

  console.log(
    `\n--- Done. populated=${populated}, skippedFresh=${skippedFresh}, empty=${empty}, errored=${errored} ---\n`
  );
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
