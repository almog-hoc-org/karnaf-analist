/**
 * Headless Yadata scraper.
 *
 * Uses puppeteer-core driving the system Chrome (no Chromium download).
 * For every city in the DB with a known CBS code, navigates to
 *   https://yadata.yad2.co.il/market/sale?city={cbs_code}
 * and extracts:
 *   - new_properties, secondhand_properties, avg_days_on_market, buyers_count
 *   - YoY % per metric (separate column "new_properties_yoy" etc.)
 *   - market_type (sellers / buyers / balanced)
 *   - households, avg_household_size
 *
 * Output: data/yad2_scrape.json — same shape as the existing file so the
 * existing `lib/import-yad2.ts` importer can consume it unchanged.
 *
 * Run manually:   npx tsx scripts/scrape_yadata.ts
 * Limit (test):   npx tsx scripts/scrape_yadata.ts --limit 5
 */
import puppeteerCore from "puppeteer-core";
import { addExtra } from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { parseYadataPage } from "../lib/yad2-page-parser";
import fs from "fs";
import path from "path";

// Wrap puppeteer-core with the stealth plugin to evade Cloudflare bot checks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const puppeteer = addExtra(puppeteerCore as unknown as any);
puppeteer.use(StealthPlugin());

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUTPUT = path.resolve("./data/yad2_scrape.json");

const adapter = new PrismaBetterSqlite3({ url: path.resolve("./data/realestate.db") });
const prisma = new PrismaClient({ adapter });

// Cities list with CBS code. We load directly from the existing cbs_codes file
// since the cities table doesn't reliably store the code itself.
import cityCbsRaw from "../data/city_cbs_codes.json";

interface CityCbs {
  city_name: string;
  cbs_code: string;
}

// The JSON is a flat dict {city_name → cbs_code}, normalize to array
const cityCbsMap: Record<string, number | string> = cityCbsRaw as unknown as Record<string, number | string>;
const cityCbs: CityCbs[] = Object.entries(cityCbsMap).map(([city_name, cbs_code]) => ({
  city_name,
  cbs_code: String(cbs_code),
}));

interface ScrapedCity {
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
  market_type: "sellers" | "buyers" | "balanced" | null;
  households: number | null;
  avg_household_size: number | null;
  market_gauge: number | null;
  compromise_index: number | null;
}

const POLL_JS = `
(async () => {
  // Wait up to 20 seconds for the KPI section to appear (Yadata SPA is slow)
  for (let i = 0; i < 40; i++) {
    const t = document.body.innerText;
    if (t.includes('נכסים חדשים שמוצעים')) break;
    if (t.includes('אין לנו כרגע נתונים')) break;
    if (t.includes('מספר משקי בית')) break;
    await new Promise(r => setTimeout(r, 500));
  }
  return document.body.innerText;
})()
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scrapeOne(page: any, city: CityCbs): Promise<ScrapedCity | { skipped: true; reason: string }> {
  const url = `https://yadata.yad2.co.il/market/sale?city=${city.cbs_code}`;
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
    const text = await page.evaluate(POLL_JS) as string;

    if (process.env.YADATA_DEBUG) {
      const debugFile = path.resolve(`./data/yadata_debug_${city.cbs_code}.txt`);
      fs.writeFileSync(debugFile, text);
      console.log(`     [debug] page text → ${debugFile}`);
    }

    if (text.includes("Verifying your browser") || text.includes("Incident ID")) {
      return { skipped: true, reason: "cloudflare_challenge" };
    }
    if (text.includes("אין לנו כרגע נתונים")) {
      return { skipped: true, reason: "no_data_in_yadata" };
    }

    const kpis = parseYadataPage(text);

    return {
      city_name: city.city_name,
      cbs_code: city.cbs_code,
      ...kpis,
    };
  } catch (err) {
    return { skipped: true, reason: `error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] ?? "0", 10) : 0;

  // Build the city list — only cities we have AND that exist in our DB
  const dbCities = await prisma.city.findMany({ select: { city_name: true } });
  const dbNames = new Set(dbCities.map((c) => c.city_name));
  const all = cityCbs.filter((c) => dbNames.has(c.city_name));
  const toScrape = limit > 0 ? all.slice(0, limit) : all;

  console.log(`🚀 Yadata scraper — ${toScrape.length} cities${limit ? ` (limited to ${limit})` : ""}`);
  console.log(`   Chrome: ${CHROME}`);
  console.log(`   Output: ${OUTPUT}`);
  console.log("");

  // Two modes:
  //   --connect    → attach to a real Chrome running with --remote-debugging-port=9222.
  //                  Bypasses Cloudflare bot detection completely (it's a real session).
  //   default      → headless launch with stealth (may fail on CF challenge).
  const connectMode = args.includes("--connect");
  let browser: puppeteerCore.Browser;
  if (connectMode) {
    console.log("   Mode: connecting to existing Chrome at http://127.0.0.1:9222");
    browser = await puppeteerCore.connect({
      browserURL: "http://127.0.0.1:9222",
      defaultViewport: null,
    });
  } else {
    console.log("   Mode: headless launch with stealth plugin");
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    }) as unknown as puppeteerCore.Browser;
  }

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
  );
  await page.setViewport({ width: 1280, height: 800 });

  const scraped: ScrapedCity[] = [];
  const skipped: Array<{ city_name: string; reason: string }> = [];

  let i = 0;
  for (const city of toScrape) {
    i++;
    const prefix = `[${String(i).padStart(3)}/${toScrape.length}]`;
    const result = await scrapeOne(page, city);
    if ("skipped" in result) {
      skipped.push({ city_name: city.city_name, reason: result.reason });
      console.log(`${prefix} ⊘ ${city.city_name.padEnd(20)} → ${result.reason}`);
    } else {
      scraped.push(result);
      console.log(`${prefix} ✓ ${city.city_name.padEnd(20)} → new=${result.new_properties} sh=${result.secondhand_properties} days=${result.avg_days_on_market} buyers=${result.buyers_count} type=${result.market_type}`);
    }
    // Polite delay
    await new Promise((r) => setTimeout(r, 800));
  }

  await browser.close();

  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    fetchedAt: today,
    endpoint: "https://yadata.yad2.co.il/market/sale?city={cbs_code}",
    cities: scraped,
    skipped,
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2));
  console.log("");
  console.log(`✅ Done. Saved ${scraped.length} cities + ${skipped.length} skipped to ${OUTPUT}`);
  console.log(`   Next: npx tsx lib/import-yad2.ts to load into the DB`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
