/**
 * Pre-fetch script — warms the deals cache for all cities.
 * Run via: npx tsx lib/prefetch-deals.ts
 *
 * Saves per-city JSON files under data/deals_cache/ so the live UI loads
 * instantly without hitting govmap.gov.il.
 *
 * Re-running the script refreshes every cache file. To force-refresh a
 * single city, pass it as an arg: `npx tsx lib/prefetch-deals.ts באר שבע`
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";
import { getCityDealsData } from "./govNadlanService";
import { setCachedDeals, getCachedDeals, cacheAge } from "./dealsCache";

const adapter = new PrismaBetterSqlite3({
  url: path.resolve("./data/realestate.db"),
});
const prisma = new PrismaClient({ adapter });

const SKIP_IF_FRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const cityArgs = args.filter((a) => !a.startsWith("--"));
  const force = flags.has("--force");

  let cities: { city_name: string }[];
  if (cityArgs.length > 0) {
    cities = cityArgs.map((c) => ({ city_name: c }));
  } else {
    cities = await prisma.city.findMany({
      select: { city_name: true },
      orderBy: { city_name: "asc" },
    });
  }

  console.log(`📦 Pre-fetching deals for ${cities.length} cities...\n`);

  let ok = 0;
  let skipped = 0;
  let empty = 0;
  let failed = 0;
  const errors: { city: string; error: string }[] = [];

  for (let i = 0; i < cities.length; i++) {
    const cityName = cities[i].city_name;
    const prefix = `[${i + 1}/${cities.length}] ${cityName}`;

    // Skip if cache is fresh (unless --force)
    if (!force) {
      const age = cacheAge(cityName);
      if (age !== null && age < SKIP_IF_FRESH_MS) {
        const cached = getCachedDeals(cityName);
        const nhCount = cached?.neighborhoods?.length || 0;
        console.log(
          `${prefix} ⏭  skip (cache ${(age / (60 * 60 * 1000)).toFixed(1)}h old, ${nhCount} nh)`
        );
        skipped++;
        continue;
      }
    }

    try {
      const startedAt = Date.now();
      const data = await getCityDealsData(cityName);
      setCachedDeals(cityName, data);
      const took = ((Date.now() - startedAt) / 1000).toFixed(1);

      if (data.neighborhoods.length === 0) {
        console.log(
          `${prefix} ⚠️  empty (${data.totalDealsAnalyzed} deals, ${took}s)`
        );
        empty++;
      } else {
        const streetCount = data.neighborhoods.reduce(
          (s, n) => s + n.streets.length,
          0
        );
        console.log(
          `${prefix} ✅ ${data.neighborhoods.length} nh, ${streetCount} streets, ${data.totalDealsAnalyzed} deals (${took}s)`
        );
        ok++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`${prefix} ❌ ${msg}`);
      errors.push({ city: cityName, error: msg });
      failed++;
    }
  }

  console.log(`\n📊 Done — ok: ${ok}, empty: ${empty}, skipped: ${skipped}, failed: ${failed}`);
  if (errors.length > 0) {
    console.log("\nErrors:");
    for (const e of errors) console.log(`  ${e.city}: ${e.error}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
