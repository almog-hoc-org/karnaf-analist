/**
 * Import all updated data from agent research.
 * Run: npx tsx lib/import-updates.ts
 */
import { prisma } from "./db";
import * as fs from "fs";
import * as path from "path";

const dataDir = path.resolve("./data");

function readJson(filename: string): unknown {
  const p = path.join(dataDir, filename);
  if (!fs.existsSync(p)) { console.log(`  ⚠️ ${filename} not found, skipping`); return null; }
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

async function importCityConstructionStarts() {
  console.log("\n📦 Importing city construction starts...");
  const data = readJson("city_construction_update.json") as Array<{
    city_name: string; year: number; quarter: number | null;
    construction_starts: number | null; construction_completions: number | null;
  }> | null;
  if (!data) return;

  let count = 0;
  for (const row of data) {
    // Check if city exists
    const city = await prisma.city.findUnique({ where: { city_name: row.city_name } });
    if (!city) continue;

    if (row.construction_starts !== null) {
      try {
        await prisma.construction_starts.upsert({
          where: { city_name_year: { city_name: row.city_name, year: row.year } },
          update: { starts: row.construction_starts },
          create: { city_name: row.city_name, year: row.year, starts: row.construction_starts, source: "cbs_annual_2025_update" },
        });
        count++;
      } catch { /* skip duplicates or errors */ }
    }

    // Also import completions into cbs_press_data if available
    if (row.construction_completions !== null) {
      try {
        await prisma.cbsPressData.upsert({
          where: { city_name_year_quarter: { city_name: row.city_name, year: row.year, quarter: row.quarter ?? 0 } },
          update: { construction_completions: row.construction_completions },
          create: {
            city_name: row.city_name, year: row.year, quarter: row.quarter ?? 0,
            construction_completions: row.construction_completions,
            construction_starts: row.construction_starts,
            source_url: "cbs_update_2025",
          },
        });
      } catch { /* skip */ }
    }
  }
  console.log(`  ✅ ${count} construction starts records imported`);
}

async function importNationalConstruction() {
  console.log("\n📦 Importing national construction updates...");
  const data = readJson("national_construction_update.json") as Array<{
    year: number; permits: number | null; starts: number | null; completions: number | null;
  }> | null;
  if (!data) return;

  let count = 0;
  for (const row of data) {
    const existing = await prisma.national_construction.findUnique({ where: { year: row.year } });

    // Only update fields that are currently NULL or if we have better data
    const updates: Record<string, unknown> = {};
    if (row.permits !== null && (!existing || existing.permits === null)) {
      updates.permits = row.permits;
    }
    if (row.starts !== null && (!existing || existing.starts === null)) {
      updates.starts = row.starts;
    }
    if (row.completions !== null && (!existing || existing.completions === null)) {
      updates.completions = row.completions;
    }

    if (Object.keys(updates).length > 0) {
      if (existing) {
        await prisma.national_construction.update({ where: { year: row.year }, data: updates });
      } else {
        await prisma.national_construction.create({
          data: { year: row.year, permits: row.permits, starts: row.starts, completions: row.completions, source: "cbs_update_2025" },
        });
      }
      count++;
    }
  }
  console.log(`  ✅ ${count} national construction records updated`);
}

async function importPriceUpdates() {
  console.log("\n📦 Importing price per sqm updates...");
  const raw = readJson("price_data_update.json") as { price_per_sqm_updates?: { cities_to_update?: Record<string, { price_per_sqm_2023: number; price_per_sqm_2026: number }> } } | null;
  if (!raw?.price_per_sqm_updates?.cities_to_update) { console.log("  ⚠️ No price updates found"); return; }

  const updates = raw.price_per_sqm_updates.cities_to_update;
  let count = 0;

  for (const [cityName, data] of Object.entries(updates)) {
    const city = await prisma.city.findUnique({ where: { city_name: cityName } });
    if (!city) continue;

    // Only update if currently NULL
    const cityUpdates: Record<string, unknown> = {};
    if (city.price_per_sqm_2023 === null && data.price_per_sqm_2023) {
      cityUpdates.price_per_sqm_2023 = data.price_per_sqm_2023;
    }
    if (city.price_per_sqm_2026 === null && data.price_per_sqm_2026) {
      cityUpdates.price_per_sqm_2026 = data.price_per_sqm_2026;
    }

    // Recalculate price_change_pct
    const p2023 = (cityUpdates.price_per_sqm_2023 as number) ?? city.price_per_sqm_2023;
    const p2026 = (cityUpdates.price_per_sqm_2026 as number) ?? city.price_per_sqm_2026;
    if (p2023 && p2026 && p2023 > 0) {
      cityUpdates.price_change_pct = ((p2026 - p2023) / p2023) * 100;
    }

    if (Object.keys(cityUpdates).length > 0) {
      await prisma.city.update({
        where: { city_name: cityName },
        data: { ...cityUpdates, last_updated: new Date() },
      });
      count++;
    }
  }
  console.log(`  ✅ ${count} cities with price data updated`);
}

async function main() {
  console.log("🚀 Importing all updated data...");

  await importCityConstructionStarts();
  await importNationalConstruction();
  await importPriceUpdates();

  // Final stats
  const withPrice = await prisma.city.count({ where: { price_per_sqm_2026: { not: null } } });
  const startsCount = await prisma.construction_starts.count();
  const pressCount = await prisma.cbsPressData.count();
  const total = await prisma.city.count();

  console.log(`\n📊 Final stats:`);
  console.log(`  Cities with price_per_sqm: ${withPrice}/${total}`);
  console.log(`  Construction starts records: ${startsCount}`);
  console.log(`  CBS press data records: ${pressCount}`);

  await prisma.$disconnect();
  console.log("\n🏁 Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
