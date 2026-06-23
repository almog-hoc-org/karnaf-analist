/**
 * Direct JSON import — reads cities_raw.json and sales_raw.json from ./data/
 * Run with: npx ts-node src/lib/import-json.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import * as fs from "fs";
import * as path from "path";

const dbPath = path.resolve("./data/realestate.db");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adapter = new PrismaBetterSqlite3({ url: dbPath } as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any);

function n(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const f = typeof v === "string" ? parseFloat(v.replace(/,/g, "")) : Number(v);
  return isNaN(f) ? null : f;
}

function calc(raw: {
  population_2021: number | null;
  population_2026: number | null;
  people_per_apartment: number | null;
  construction_4y_gross: number | null;
  net_coefficient: number | null;
  price_per_sqm_2023: number | null;
  price_per_sqm_2026: number | null;
}) {
  const { population_2021, population_2026, people_per_apartment,
    construction_4y_gross, net_coefficient, price_per_sqm_2023, price_per_sqm_2026 } = raw;

  const total_apartments = population_2026 && people_per_apartment ? population_2026 / people_per_apartment : null;
  const construction_net = net_coefficient && construction_4y_gross ? net_coefficient * construction_4y_gross : null;
  const population_growth_abs = population_2026 !== null && population_2021 !== null ? population_2026 - population_2021 : null;
  // Store as actual percentage (8.2 means 8.2%)
  const population_growth_pct = population_growth_abs !== null && population_2021 ? (population_growth_abs / population_2021) * 100 : null;
  const apartments_required = population_growth_abs !== null && people_per_apartment ? population_growth_abs / people_per_apartment : null;
  const apartment_growth = construction_net !== null && total_apartments ? construction_net / total_apartments : null;
  const golden_multiplier = construction_net !== null && apartments_required ? construction_net / apartments_required : null;
  const golden_pct = golden_multiplier !== null ? (golden_multiplier - 1) * 100 : null;
  // Store as actual percentage (14.1 means 14.1%)
  const price_change_pct = price_per_sqm_2026 !== null && price_per_sqm_2023 ? ((price_per_sqm_2026 - price_per_sqm_2023) / price_per_sqm_2023) * 100 : null;

  return { total_apartments, construction_net, population_growth_abs, population_growth_pct,
    apartments_required, apartment_growth, golden_multiplier, golden_pct, price_change_pct };
}

function calcSales(raw: {
  new_sales_2023: number | null; new_sales_2024: number | null;
  new_sales_2025: number | null; unsold_inventory_2025: number | null;
}) {
  const { new_sales_2023, new_sales_2024, new_sales_2025, unsold_inventory_2025 } = raw;
  const avg_sales_3y = new_sales_2023 !== null && new_sales_2024 !== null && new_sales_2025 !== null
    ? (new_sales_2023 + new_sales_2024 + new_sales_2025) / 3 : null;
  const years_to_clear_2025 = unsold_inventory_2025 !== null && new_sales_2025 ? unsold_inventory_2025 / new_sales_2025 : null;
  const years_to_clear_avg = unsold_inventory_2025 !== null && avg_sales_3y ? unsold_inventory_2025 / avg_sales_3y : null;
  return { avg_sales_3y, years_to_clear_2025, years_to_clear_avg };
}

async function main() {
  console.log("📥 Importing from JSON files...");

  const cities = JSON.parse(fs.readFileSync(path.resolve("./data/cities_raw.json"), "utf-8"));
  const sales  = JSON.parse(fs.readFileSync(path.resolve("./data/sales_raw.json"),  "utf-8"));

  let cityCount = 0;
  for (const row of cities) {
    const raw = {
      population_2021:       n(row.population_2021),
      population_2026:       n(row.population_2026),
      people_per_apartment:  n(row.people_per_apartment),
      construction_4y_gross: n(row.construction_4y_gross),
      net_coefficient:       n(row.net_coefficient),
      price_per_sqm_2023:    n(row.price_per_sqm_2023),
      price_per_sqm_2026:    n(row.price_per_sqm_2026),
    };
    const computed = calc(raw);
    await prisma.city.upsert({
      where:  { city_name: row.city_name },
      update: { ...raw, ...computed, last_updated: new Date() },
      create: { city_name: row.city_name, ...raw, ...computed },
    });
    cityCount++;
  }
  console.log(`✅ ${cityCount} cities imported`);

  let salesCount = 0;
  for (const row of sales) {
    const exists = await prisma.city.findUnique({ where: { city_name: row.city_name } });
    if (!exists) await prisma.city.create({ data: { city_name: row.city_name } });

    const raw = {
      new_sales_2023:        n(row.new_sales_2023),
      new_sales_2024:        n(row.new_sales_2024),
      new_sales_2025:        n(row.new_sales_2025),
      unsold_inventory_2025: n(row.unsold_inventory_2025),
    };
    const computed = calcSales(raw);
    await prisma.citySales.upsert({
      where:  { city_name: row.city_name },
      update: { ...raw, ...computed, last_updated: new Date() },
      create: { city_name: row.city_name, ...raw, ...computed },
    });
    salesCount++;
  }
  console.log(`✅ ${salesCount} cities with sales data imported`);

  await prisma.$disconnect();
  console.log("🏁 Done.");
}

main().catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
