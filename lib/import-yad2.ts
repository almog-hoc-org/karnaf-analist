/**
 * Import scraped Yadata data from data/yad2_scrape.json into yad2_market_data table.
 * Updates existing rows (by city_name) and inserts new ones. Refreshes scraped_at.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import fs from "fs";
import path from "path";

const adapter = new PrismaBetterSqlite3({
  url: path.resolve("./data/realestate.db"),
});
const prisma = new PrismaClient({ adapter });

interface ScrapedRow {
  city_name: string;
  cbs_code: string;
  new_properties: number | null;
  new_properties_yoy: number | null;
  secondhand_properties: number | null;
  secondhand_yoy: number | null;
  avg_days_on_market: number | null;
  days_yoy: number | null;
  buyers_count: number | null;
  buyers_yoy: number | null;
  market_type: string | null;
  households: number | null;
  avg_household_size: number | null;
  market_gauge?: number | null;
  compromise_index?: number | null;
}

async function main() {
  const filePath = path.resolve("data", "yad2_scrape.json");
  if (!fs.existsSync(filePath)) {
    console.error("yad2_scrape.json not found");
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const rows: ScrapedRow[] = payload.cities ?? [];

  console.log(`📦 Importing ${rows.length} Yadata rows...`);

  let updated = 0;
  let created = 0;
  for (const r of rows) {
    const data = {
      cbs_code: r.cbs_code,
      new_properties: r.new_properties,
      secondhand_properties: r.secondhand_properties,
      avg_days_on_market: r.avg_days_on_market,
      buyers_count: r.buyers_count,
      new_properties_yoy: r.new_properties_yoy,
      secondhand_yoy: r.secondhand_yoy,
      days_yoy: r.days_yoy,
      buyers_yoy: r.buyers_yoy,
      market_type: r.market_type,
      households: r.households,
      avg_household_size: r.avg_household_size,
      market_gauge: r.market_gauge ?? null,
      compromise_index: r.compromise_index ?? null,
      scraped_at: new Date(),
    };

    const existing = await prisma.yad2_market_data.findUnique({
      where: { city_name: r.city_name },
    });

    if (existing) {
      await prisma.yad2_market_data.update({
        where: { city_name: r.city_name },
        data,
      });
      updated++;
    } else {
      await prisma.yad2_market_data.create({
        data: { city_name: r.city_name, ...data },
      });
      created++;
    }
  }

  console.log(`✅ Done. Updated: ${updated}, Created: ${created}`);
  if (payload.skipped) {
    console.log(`⏭  Skipped (no data): ${payload.skipped.length}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
