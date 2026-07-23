#!/usr/bin/env tsx
/**
 * Seed nadlan_transactions from the already-collected data/nadlan_deals/*.json files
 * (~500 recent deals per city, WITH build year) — no new nadlan requests. This gives the
 * pipeline real data to build/verify against while nadlan rate-limits cool down; the live
 * collector (collect-nadlan-transactions.ts) tops up depth later.
 */
import fs from "fs";
import path from "path";
import { prisma } from "../lib/db";

const SECONDHAND_MIN_AGE = 3;
const DIR = path.resolve(process.cwd(), "data", "nadlan_deals");

function roomBucket(rn: number | undefined): string {
  if (rn == null) return "other";
  if (rn >= 2.5 && rn < 3.5) return "3";
  if (rn >= 3.5 && rn < 4.5) return "4";
  if (rn >= 4.5) return "5";
  return "other";
}

interface RawDeal { dealDate?: string; dealAmount?: number; roomNum?: number; assetArea?: number; yearBuilt?: number; priceSM?: number; neighborhoodName?: string; }

async function main() {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json"));
  console.log(`seeding from ${files.length} cached files…`);
  let cities = 0, total = 0;
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as { city: string; cbs_code?: string; deals?: RawDeal[] };
    const city = j.city;
    const deals = (j.deals ?? []).filter((d) => d.dealDate && d.dealAmount && Number(String(d.dealDate).slice(0, 4)) > 1990);
    if (!city || deals.length === 0) { console.log(`  ${f}: skip (empty)`); continue; }

    await prisma.$executeRawUnsafe("DELETE FROM nadlan_transactions WHERE city_name = ?", city);
    const COLS = "city_name,cbs_code,deal_date,deal_year,rooms,room_bucket,area,price,price_sqm,year_built,is_secondhand";
    const CHUNK = 80;
    let inserted = 0;
    for (let i = 0; i < deals.length; i += CHUNK) {
      const slice = deals.slice(i, i + CHUNK);
      const vs: string[] = [];
      const params: unknown[] = [];
      for (const d of slice) {
        const dy = Number(String(d.dealDate).slice(0, 4));
        const yb = Number(d.yearBuilt) || null;
        const isSH = yb && yb > 0 && dy - yb >= SECONDHAND_MIN_AGE ? 1 : 0;
        vs.push("(?,?,?,?,?,?,?,?,?,?,?)");
        params.push(city, j.cbs_code ?? null, String(d.dealDate).slice(0, 10), dy, d.roomNum ?? null, roomBucket(d.roomNum), d.assetArea ?? null, d.dealAmount ?? null, d.priceSM ?? null, yb, isSH);
      }
      await prisma.$executeRawUnsafe(`INSERT INTO nadlan_transactions (${COLS}) VALUES ${vs.join(",")}`, ...params);
      inserted += slice.length;
    }
    cities++; total += inserted;
    if (cities % 20 === 0) console.log(`  …${cities} cities, ${total} rows`);
  }
  console.log(`\nDone: ${cities} cities, ${total} transactions seeded.`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
