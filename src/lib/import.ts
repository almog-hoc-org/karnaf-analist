/**
 * Excel import script — run once with:
 *   npx ts-node src/lib/import.ts
 *
 * Also handles CBS data import from scraped JSON files.
 */

import * as XLSX from "xlsx";
import * as path from "path";
import * as fs from "fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: "file:./data/realestate.db" } },
});

// ── helpers ────────────────────────────────────────────────────────────────

function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? parseInt(v.replace(/,/g, ""), 10) : Number(v);
  return isNaN(n) ? null : n;
}

function toFloatOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v.replace(/,/g, "")) : Number(v);
  return isNaN(n) ? null : n;
}

// ── calculated fields ──────────────────────────────────────────────────────

function calcCityFields(raw: {
  population_2021: number | null;
  population_2026: number | null;
  people_per_apartment: number | null;
  construction_4y_gross: number | null;
  net_coefficient: number | null;
  price_per_sqm_2023: number | null;
  price_per_sqm_2026: number | null;
}) {
  const {
    population_2021,
    population_2026,
    people_per_apartment,
    construction_4y_gross,
    net_coefficient,
    price_per_sqm_2023,
    price_per_sqm_2026,
  } = raw;

  const total_apartments =
    population_2026 && people_per_apartment
      ? population_2026 / people_per_apartment
      : null;

  const construction_net =
    net_coefficient && construction_4y_gross
      ? net_coefficient * construction_4y_gross
      : null;

  const population_growth_abs =
    population_2026 !== null && population_2021 !== null
      ? population_2026 - population_2021
      : null;

  const population_growth_pct =
    population_growth_abs !== null && population_2021
      ? population_growth_abs / population_2021
      : null;

  const apartments_required =
    population_growth_abs !== null && people_per_apartment
      ? population_growth_abs / people_per_apartment
      : null;

  const apartment_growth =
    construction_net !== null && total_apartments
      ? construction_net / total_apartments
      : null;

  const golden_multiplier =
    construction_net !== null && apartments_required
      ? construction_net / apartments_required
      : null;

  const golden_pct =
    golden_multiplier !== null ? (golden_multiplier - 1) * 100 : null;

  const price_change_pct =
    price_per_sqm_2026 !== null && price_per_sqm_2023
      ? (price_per_sqm_2026 - price_per_sqm_2023) / price_per_sqm_2023
      : null;

  return {
    total_apartments,
    construction_net,
    population_growth_abs,
    population_growth_pct,
    apartments_required,
    apartment_growth,
    golden_multiplier,
    golden_pct,
    price_change_pct,
  };
}

function calcSalesFields(raw: {
  new_sales_2023: number | null;
  new_sales_2024: number | null;
  new_sales_2025: number | null;
  unsold_inventory_2025: number | null;
}) {
  const { new_sales_2023, new_sales_2024, new_sales_2025, unsold_inventory_2025 } = raw;

  const avg_sales_3y =
    new_sales_2023 !== null && new_sales_2024 !== null && new_sales_2025 !== null
      ? (new_sales_2023 + new_sales_2024 + new_sales_2025) / 3
      : null;

  const years_to_clear_2025 =
    unsold_inventory_2025 !== null && new_sales_2025
      ? unsold_inventory_2025 / new_sales_2025
      : null;

  const years_to_clear_avg =
    unsold_inventory_2025 !== null && avg_sales_3y
      ? unsold_inventory_2025 / avg_sales_3y
      : null;

  return { avg_sales_3y, years_to_clear_2025, years_to_clear_avg };
}

// ── main import from Excel ─────────────────────────────────────────────────

async function importFromExcel() {
  const excelPath = path.resolve("./data/טבלת_המחקר_החדשה_והסופית.xlsx");

  if (!fs.existsSync(excelPath)) {
    console.error(`❌ Excel file not found at: ${excelPath}`);
    console.error("Place the file at: data/טבלת_המחקר_החדשה_והסופית.xlsx");
    return { cities: 0, sales: 0 };
  }

  const workbook = XLSX.readFile(excelPath);

  // ── Sheet 1: המחקר הסופי ─────────────────────────────────────────────────
  const sheet1Name = workbook.SheetNames.find((n) =>
    n.includes("המחקר הסופי") || n.includes("מחקר")
  ) ?? workbook.SheetNames[0];

  const sheet1 = workbook.Sheets[sheet1Name];
  const rows1: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet1, {
    defval: null,
  });

  let importedCities = 0;

  for (const row of rows1) {
    const city_name = String(row["עיר"] ?? row["שם עיר"] ?? "").trim();
    if (!city_name) continue;

    const raw = {
      population_2021: toIntOrNull(row["אוכלוסייה ב-2021"] ?? row["אוכלוסייה 2021"]),
      population_2026: toIntOrNull(row["אוכלוסיה ב-2026"] ?? row["אוכלוסייה ב-2026"] ?? row["אוכלוסייה 2026"]),
      people_per_apartment: toFloatOrNull(row["נפשות לדירה"]),
      construction_4y_gross: toIntOrNull(row['סה"כ בנייה 4 שנים (ברוטו)'] ?? row["סה\"כ בנייה 4 שנים"]),
      net_coefficient: toFloatOrNull(row["מקדם נטו"]),
      price_per_sqm_2023: toIntOrNull(row["מחיר ממוצע למטר 2023"]),
      price_per_sqm_2026: toIntOrNull(row["מחיר ממוצע למטר 2026"]),
    };

    const calc = calcCityFields(raw);

    await prisma.city.upsert({
      where: { city_name },
      update: { ...raw, ...calc, last_updated: new Date() },
      create: { city_name, ...raw, ...calc },
    });

    importedCities++;
  }

  // ── Sheet 2: חיזוי שנות היצע ─────────────────────────────────────────────
  const sheet2Name = workbook.SheetNames.find((n) =>
    n.includes("חיזוי") || n.includes("היצע")
  ) ?? workbook.SheetNames[1];

  let importedSales = 0;

  if (sheet2Name && workbook.Sheets[sheet2Name]) {
    const sheet2 = workbook.Sheets[sheet2Name];
    const rows2: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet2, {
      defval: null,
    });

    for (const row of rows2) {
      const city_name = String(row["עיר"] ?? row["שם עיר"] ?? "").trim();
      if (!city_name) continue;

      // Ensure city exists
      const cityExists = await prisma.city.findUnique({ where: { city_name } });
      if (!cityExists) {
        await prisma.city.create({ data: { city_name } });
      }

      const raw = {
        new_sales_2023: toIntOrNull(row["דירות חדשות שנמכרו ב2023"] ?? row["מכירות 2023"]),
        new_sales_2024: toIntOrNull(row["דירות חדשות שנמכרו ב2024"] ?? row["מכירות 2024"]),
        new_sales_2025: toIntOrNull(row["דירות חדשות שנמכרו ב2025"] ?? row["מכירות 2025"]),
        unsold_inventory_2025: toIntOrNull(row["דירות שלא נמכרו ב2025"] ?? row["מלאי 2025"]),
      };

      const calc = calcSalesFields(raw);

      await prisma.citySales.upsert({
        where: { city_name },
        update: { ...raw, ...calc, last_updated: new Date() },
        create: { city_name, ...raw, ...calc },
      });

      importedSales++;
    }
  }

  return { cities: importedCities, sales: importedSales };
}

// ── import CBS building permits from scraped JSON ─────────────────────────

export async function importCbsPermits(dataPath: string = "./data/cbs_permits.json") {
  if (!fs.existsSync(dataPath)) {
    console.log(`No CBS permits file found at ${dataPath}, skipping.`);
    return 0;
  }

  const data: Array<{ city_name: string; year: number; permits: number }> =
    JSON.parse(fs.readFileSync(dataPath, "utf-8"));

  let count = 0;
  for (const item of data) {
    const cityExists = await prisma.city.findUnique({
      where: { city_name: item.city_name },
    });
    if (!cityExists) {
      await prisma.city.create({ data: { city_name: item.city_name } });
    }

    await prisma.buildingPermit.upsert({
      where: { city_name_year: { city_name: item.city_name, year: item.year } },
      update: { permits: item.permits, last_updated: new Date() },
      create: {
        city_name: item.city_name,
        year: item.year,
        permits: item.permits,
        source: "CBS_YISHUV",
      },
    });
    count++;
  }

  return count;
}

// ── import CBS press release data from scraped JSON ───────────────────────

export async function importCbsPressData(dataPath: string = "./data/cbs_press.json") {
  if (!fs.existsSync(dataPath)) {
    console.log(`No CBS press file found at ${dataPath}, skipping.`);
    return 0;
  }

  const data: Array<{
    city_name: string;
    year: number;
    quarter?: number;
    construction_starts?: number;
    construction_completions?: number;
    source_url?: string;
    publication_title?: string;
  }> = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

  let count = 0;
  for (const item of data) {
    const cityExists = await prisma.city.findUnique({
      where: { city_name: item.city_name },
    });
    if (!cityExists) {
      await prisma.city.create({ data: { city_name: item.city_name } });
    }

    await prisma.cbsPressData.upsert({
      where: {
        city_name_year_quarter: {
          city_name: item.city_name,
          year: item.year,
          quarter: item.quarter ?? 0,
        },
      },
      update: {
        construction_starts: item.construction_starts ?? null,
        construction_completions: item.construction_completions ?? null,
        source_url: item.source_url ?? null,
        publication_title: item.publication_title ?? null,
        last_updated: new Date(),
      },
      create: {
        city_name: item.city_name,
        year: item.year,
        quarter: item.quarter ?? 0,
        construction_starts: item.construction_starts ?? null,
        construction_completions: item.construction_completions ?? null,
        source_url: item.source_url ?? null,
        publication_title: item.publication_title ?? null,
      },
    });
    count++;
  }

  return count;
}

// ── stub: live data sync ──────────────────────────────────────────────────

export async function syncFromExternalSource(sourceUrl: string) {
  // TODO: fetch from external source, update DB and Excel
}

// ── entry point ────────────────────────────────────────────────────────────

async function main() {
  console.log("🏗  Starting import...");

  const { cities, sales } = await importFromExcel();
  console.log(`✅ Imported ${cities} cities, ${sales} with sales data`);

  const permits = await importCbsPermits();
  if (permits > 0) console.log(`✅ Imported ${permits} CBS building permit records`);

  const press = await importCbsPressData();
  if (press > 0) console.log(`✅ Imported ${press} CBS press release records`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
