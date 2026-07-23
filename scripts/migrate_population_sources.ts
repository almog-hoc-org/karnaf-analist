/**
 * Populate the new `population_estimates` table with rows from EVERY available
 * source. Unlike the legacy `population_by_year` (which keeps only one value per
 * city × year), this table lets us see disagreements between sources.
 *
 * Sources merged:
 *   1. population_by_year rows tagged with a non-derived source
 *      (cbs_original, cbs_registry_2025_update, cbs_permits_2024, census_2022,
 *       data.gov.il_registry_2019, data.gov.il_registry_2026, cbs_projection_2026)
 *   2. cbs_population_combined.json — combined master JSON with population_2021/2022/2024/2026
 *   3. cbs_population_update.json — incremental updates (newer values when present)
 *   4. cities table base values (population_2021/2022/2024/2026 with source tag "legacy_excel")
 *
 * Each row preserves city, year, source, and value. The (city, year, source)
 * triple is unique — running this twice is a no-op (upsert).
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import fs from "fs";
import path from "path";

const adapter = new PrismaBetterSqlite3({ url: path.resolve("./data/realestate.db") });
const prisma = new PrismaClient({ adapter });

// "Derived" sources are aggregations of other sources, not raw measurements —
// keep them out so they don't pollute the multi-source comparison.
const DERIVED_SOURCES = new Set(["extrapolated", "interpolated", "estimated"]);

interface ImportRow {
  city_name: string;
  year: number;
  source: string;
  population: number;
  source_url?: string;
}

const RAW_BATCH: ImportRow[] = [];

function add(row: ImportRow) {
  if (!row.city_name || !row.year || !row.source || !row.population) return;
  if (row.population <= 0) return;
  RAW_BATCH.push(row);
}

async function importFromPopulationByYear() {
  const rows = await prisma.population_by_year.findMany();
  let count = 0;
  for (const r of rows) {
    if (!r.source || !r.population) continue;
    if (DERIVED_SOURCES.has(r.source)) continue;
    add({
      city_name: r.city_name,
      year: r.year,
      source: r.source,
      population: r.population,
    });
    count++;
  }
  return count;
}

function importFromCombinedJson() {
  const file = path.resolve("./data/cbs_population_combined.json");
  if (!fs.existsSync(file)) return 0;
  const data: Array<{
    city_name: string;
    population_2021: number | null;
    population_2022: number | null;
    population_2024: number | null;
    population_2026: number | null;
  }> = JSON.parse(fs.readFileSync(file, "utf-8"));

  let count = 0;
  for (const r of data) {
    if (!r.city_name) continue;
    // The combined JSON was assembled from multiple snapshots — each year gets a tagged source
    if (r.population_2021) {
      add({ city_name: r.city_name, year: 2021, source: "cbs_combined_2021", population: r.population_2021 });
      count++;
    }
    if (r.population_2022) {
      add({ city_name: r.city_name, year: 2022, source: "cbs_combined_2022", population: r.population_2022 });
      count++;
    }
    if (r.population_2024) {
      add({ city_name: r.city_name, year: 2024, source: "cbs_combined_2024", population: r.population_2024 });
      count++;
    }
    if (r.population_2026) {
      add({ city_name: r.city_name, year: 2026, source: "cbs_combined_2026", population: r.population_2026 });
      count++;
    }
  }
  return count;
}

function importFromUpdateJson() {
  const file = path.resolve("./data/cbs_population_update.json");
  if (!fs.existsSync(file)) return 0;
  const data: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
  let count = 0;

  function isYearKey(k: string): boolean { return /^population_\d{4}$/.test(k); }
  function yearOf(k: string): number { return parseInt(k.slice(-4), 10); }

  if (Array.isArray(data)) {
    for (const r of data as Array<Record<string, unknown>>) {
      const name = r.city_name as string | undefined;
      if (!name) continue;
      for (const k of Object.keys(r)) {
        if (!isYearKey(k)) continue;
        const v = r[k];
        if (typeof v !== "number") continue;
        add({ city_name: name, year: yearOf(k), source: "cbs_update_apr2026", population: v });
        count++;
      }
    }
  }
  return count;
}

async function importFromCitiesTable() {
  const cities = await prisma.city.findMany({
    select: {
      city_name: true,
      population_2021: true,
      population_2022: true,
      population_2024: true,
      population_2026: true,
    },
  });
  let count = 0;
  for (const c of cities) {
    if (c.population_2021) { add({ city_name: c.city_name, year: 2021, source: "legacy_excel", population: c.population_2021 }); count++; }
    if (c.population_2022) { add({ city_name: c.city_name, year: 2022, source: "legacy_excel", population: c.population_2022 }); count++; }
    if (c.population_2024) { add({ city_name: c.city_name, year: 2024, source: "legacy_excel", population: c.population_2024 }); count++; }
    if (c.population_2026) { add({ city_name: c.city_name, year: 2026, source: "legacy_excel", population: c.population_2026 }); count++; }
  }
  return count;
}

async function flushBatch() {
  // Bulk upsert in chunks
  let inserted = 0;
  let updated = 0;
  for (const row of RAW_BATCH) {
    try {
      await prisma.population_estimates.upsert({
        where: {
          city_name_year_source: {
            city_name: row.city_name,
            year: row.year,
            source: row.source,
          },
        },
        create: row,
        update: { population: row.population, source_url: row.source_url ?? null },
      });
      inserted++;
    } catch {
      updated++;
    }
  }
  return { inserted, updated };
}

async function main() {
  console.log("═══ Migrating population sources into population_estimates ═══\n");
  const a = await importFromPopulationByYear();
  console.log(`  population_by_year (raw sources only): ${a} rows queued`);
  const b = importFromCombinedJson();
  console.log(`  cbs_population_combined.json:         ${b} rows queued`);
  const c = importFromUpdateJson();
  console.log(`  cbs_population_update.json:           ${c} rows queued`);
  const d = await importFromCitiesTable();
  console.log(`  cities table (legacy excel):          ${d} rows queued`);
  console.log(`\n  Total queued: ${RAW_BATCH.length}\n`);

  const result = await flushBatch();
  console.log(`✓ Upserted ${result.inserted + result.updated} rows into population_estimates`);

  // Summary
  const rows = await prisma.population_estimates.findMany();
  const bySource = new Map<string, number>();
  for (const r of rows) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  console.log(`\n═══ population_estimates — by source ═══`);
  for (const [src, n] of Array.from(bySource.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src.padEnd(35)} — ${n} rows`);
  }

  // Show multi-source years for TLV
  const tlv = await prisma.population_estimates.findMany({
    where: { city_name: "תל אביב-יפו" },
    orderBy: [{ year: "asc" }, { source: "asc" }],
  });
  console.log(`\n═══ TLV after migration ═══`);
  for (const r of tlv) console.log(`  ${r.year} (${r.source.padEnd(30)}): ${r.population.toLocaleString("he-IL")}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
