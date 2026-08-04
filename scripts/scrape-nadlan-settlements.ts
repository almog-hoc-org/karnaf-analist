#!/usr/bin/env tsx
/**
 * Scrape the "עסקאות אחרונות ביישוב" (recent settlement deals) from nadlan.gov.il
 * by DRIVING the debuggable Chrome on :9222 (grecaptcha token is minted by the
 * page, which passes the reCAPTCHA-Enterprise gate). The settlement deals view
 * returns ~500 recent deals per city, each with yearBuilt + roomNum + priceSM.
 *
 * The request payload is a reversed HS256-signed JWT (we can't hand-craft it),
 * so we let the app fire deal-data and capture the RESPONSE (base64+gzip).
 *
 * Usage:
 *   npx tsx scripts/scrape-nadlan-settlements.ts               # all cities with a CBS code
 *   npx tsx scripts/scrape-nadlan-settlements.ts "לוד" "תל אביב-יפו"
 *   npx tsx scripts/scrape-nadlan-settlements.ts --force ...
 *
 * Prereq: a Chrome with --remote-debugging-port=9222 open (scripts/bootstrap_nadlan_chrome.sh).
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import puppeteerCore from "puppeteer-core";
import { prisma } from "../lib/db";

const OUT_DIR = path.resolve(process.cwd(), "data", "nadlan_deals");
const FRESH_DAYS = 30;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decode(txt: string): unknown {
  const t = txt.trim();
  if (t.startsWith("{")) return JSON.parse(t);
  try {
    return JSON.parse(zlib.gunzipSync(Buffer.from(t, "base64")).toString("utf8"));
  } catch {
    return null;
  }
}

function safeName(city: string) {
  return city.replace(/[/\\?%*:|"<>]/g, "_") + ".json";
}

function isFresh(city: string): boolean {
  const f = path.join(OUT_DIR, safeName(city));
  if (!fs.existsSync(f)) return false;
  const ageDays = (Date.now() - fs.statSync(f).mtimeMs) / 86400000;
  return ageDays < FRESH_DAYS;
}

async function cityCodeMap(): Promise<Map<string, string>> {
  const rows: { city_name: string; cbs_code: string }[] = await prisma.$queryRawUnsafe(
    "SELECT city_name, cbs_code FROM yad2_market_data WHERE cbs_code IS NOT NULL"
  );
  return new Map(rows.map((r) => [r.city_name, String(r.cbs_code)]));
}

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const names = argv.filter((a) => !a.startsWith("--"));

  const codes = await cityCodeMap();
  const cities = (names.length > 0 ? names : [...codes.keys()]).filter((c) => codes.has(c));
  const missing = names.filter((c) => !codes.has(c));
  if (missing.length) console.log("⚠ no cbs_code for:", missing.join(", "));

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`\n=== scrape-nadlan-settlements — ${cities.length} cities ===`);
  const browser = await puppeteerCore.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });

  let ok = 0, skip = 0, empty = 0, err = 0;
  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    const code = codes.get(city)!;
    const tag = `[${i + 1}/${cities.length}] ${city} (${code})`;
    if (!force && isFresh(city)) { console.log(`${tag}: skip (fresh)`); skip++; continue; }

    const page = await browser.newPage();
    // A holder, not a `let`. The response handler below is a closure, and
    // TypeScript does not follow assignments made inside one — so a plain
    // variable stays `null` in the compiler's view for the rest of the
    // function, every read of it narrows to `never`, and the field accesses
    // that follow are not checked against the shape at all. Reading through a
    // property keeps the declared type, so `data.items` is type-checked again.
    type DealResponse = { data?: { items?: unknown[]; total_rows?: number } };
    const cap: { deal: DealResponse | null } = { deal: null };
    page.on("response", async (r) => {
      if (/\/deal-data/.test(r.url())) {
        try {
          const d = decode(await r.text()) as DealResponse | null;
          if (d?.data?.items?.length) cap.deal = d;
        } catch { /* ignore */ }
      }
    });
    try {
      await page.goto(`https://www.nadlan.gov.il/?view=settlement&id=${code}&page=deals`, {
        waitUntil: "networkidle2",
        timeout: 60000,
      }).catch(() => {});
      // wait for the app to mint the token + fire deal-data
      for (let w = 0; w < 6 && !cap.deal; w++) await sleep(2500);

      const items = (cap.deal?.data?.items ?? []) as Record<string, unknown>[];
      if (items.length === 0) { console.log(`${tag}: EMPTY (no deals captured)`); empty++; }
      else {
        const payload = {
          city, cbs_code: code, capturedAt: new Date().toISOString(),
          totalRows: cap.deal?.data?.total_rows ?? null,
          count: items.length,
          deals: items.map((d) => ({
            dealDate: d.dealDate, dealAmount: d.dealAmount, roomNum: d.roomNum,
            assetArea: d.assetArea, yearBuilt: d.yearBuilt, priceSM: d.priceSM,
            neighborhoodName: d.neighborhoodName, dealNature: d.dealNature,
          })),
        };
        fs.writeFileSync(path.join(OUT_DIR, safeName(city)), JSON.stringify(payload, null, 1));
        console.log(`${tag}: ${items.length} deals (of ${cap.deal?.data?.total_rows ?? "?"})`);
        ok++;
      }
    } catch (e) {
      console.error(`${tag}: ERROR — ${e instanceof Error ? e.message : e}`);
      err++;
    } finally {
      await page.close().catch(() => {});
    }
    // human pace
    await sleep(rnd(4000, 9000));
  }

  await browser.disconnect();
  console.log(`\n--- Done. ok=${ok}, skipped=${skip}, empty=${empty}, errored=${err} ---`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
