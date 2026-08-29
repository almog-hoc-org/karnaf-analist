#!/usr/bin/env tsx
/**
 * Collect INDIVIDUAL real-estate transactions from רשות המסים (via the govmap API) into
 * nadlan_transactions with source='govmap'. Unlike nadlan's anonymous 1,000-deal cap, this
 * endpoint returns every deal across a date range — so we get the BROAD multi-year data
 * (2015→now) for the year-over-year graphs, for ALL cities. No build year here (govmap has
 * none), so these rows power the "all" + room graphs; the second-hand/new split stays on the
 * nadlan build-year rows (source='nadlan').
 *
 * The endpoint plumbing (autocomplete → polygon sweep → per-polygon deals, rate
 * limit, retries, geo-block detection) lives in lib/govmapDeals.ts — shared with
 * the address-backfill campaign so the two walk govmap identically.
 *
 * Usage:
 *   npx tsx scripts/collect-govmap-transactions.ts                 # all DB cities, skip fresh
 *   npx tsx scripts/collect-govmap-transactions.ts "לוד" "ירושלים"
 *   npx tsx scripts/collect-govmap-transactions.ts --force ...
 */
import { prisma } from "../lib/db";
import { DEAL_KEY_INDEX_SQL, insertIfAbsentSql } from "../lib/dealKey";
import { fetchCityDeals, govmapWindows } from "../lib/govmapDeals";
import { ensureSourceDealIdColumn } from "../lib/addressBackfillDb";

// 10-year scope only (user rule: never touch/collect beyond 10 years back)
/**
 * Collection window.
 *
 * The default is the full ten years — the one-time backfill. KARNAF_COLLECT_FROM
 * narrows it for the quarterly top-up, where re-scanning 2016 costs hours and
 * returns deals the database has held for years. Format "YYYY-MM".
 */
const START_DATE = process.env.KARNAF_COLLECT_FROM || "2016-01";
// three windows (was two): denser slicing so a busy polygon's 2000-per-call cap
// truncates far less history — more deals ⇒ more addresses to merge onto nadlan rows.
const WINDOWS = govmapWindows(START_DATE);
/**
 * Skip a city collected more recently than this.
 *
 * Configurable because the right value depends on how the collector is driven.
 * At 20 days a nightly run touches about a twentieth of the country and a full
 * rotation takes three weeks — right for a backfill, too coarse for the way this
 * was actually operated by hand, which was daily, because deals go missing and a
 * re-run picks them up. A shorter window re-checks each city more often at the
 * cost of more requests per night; scripts/collect.ts caps the night's total
 * time, so the two settings bound each other.
 */
const FRESH_DAYS = Number(process.env.KARNAF_GOVMAP_FRESH_DAYS ?? 20);
const MIN_SQM = 2_000, MAX_SQM = 200_000, MIN_AREA = 20, MAX_AREA = 500;

function roomBucket(rn: number | null): string {
  if (rn == null || isNaN(rn)) return "other";
  if (rn >= 2.5 && rn < 3.5) return "3";
  if (rn >= 3.5 && rn < 4.5) return "4";
  if (rn >= 4.5) return "5";
  return "other";
}

async function collectCity(cityName: string): Promise<{ n: number; years: string }> {
  const deals = await fetchCityDeals(cityName, WINDOWS);
  if (deals.length === 0) return { n: 0, years: "" };

  // build rows (sane-bounded)
  const rows = deals.map((d) => {
    const area = d.assetArea ?? 0;
    const price = d.dealAmount ?? 0;
    const sqm = area > 0 ? price / area : 0;
    const dy = Number(String(d.dealDate).slice(0, 4));
    return { d, area, price, sqm, dy };
  }).filter((r) => r.dy > 1990 && r.area >= MIN_AREA && r.area <= MAX_AREA && r.sqm >= MIN_SQM && r.sqm <= MAX_SQM);
  if (rows.length === 0) return { n: 0, years: "" };

  // ACCUMULATE rather than replace the city. With a narrowed collection window
  // (KARNAF_COLLECT_FROM, used by the quarterly top-up) a delete would wipe the
  // years OUTSIDE the window that this run never re-fetches — turning a
  // three-month top-up into the loss of a decade.
  await prisma.$executeRawUnsafe(DEAL_KEY_INDEX_SQL);
  // source_deal_id: govmap's own per-deal id, kept from now on (it used to be
  // received and thrown away) so a future address backfill can join exactly
  // instead of by the fuzzy natural key. NOT part of DEAL_KEY_COLS — identity
  // must keep matching the legacy rows that never stored it.
  const COLS = "city_name,cbs_code,deal_date,deal_year,rooms,room_bucket,area,price,price_sqm,year_built,is_secondhand,neighborhood,street,house_num,floor,source,source_deal_id";
  const CHUNK = 60;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const params: unknown[] = [];
    for (const r of slice) params.push(cityName, r.d.settlementId ? String(r.d.settlementId) : null, String(r.d.dealDate).slice(0, 10), r.dy, r.d.assetRoomNum ?? null, roomBucket(r.d.assetRoomNum), r.area, r.price, Math.round(r.sqm), null, 0, r.d.neighborhood ?? null, r.d.streetNameHeb ?? null, r.d.houseNum != null ? String(r.d.houseNum) : null, r.d.floorNo != null ? String(r.d.floorNo) : null, "govmap", r.d.dealId != null ? String(r.d.dealId) : null);
    await prisma.$executeRawUnsafe(insertIfAbsentSql(COLS, slice.length), ...params);
  }
  const yrs = [...new Set(rows.map((r) => r.dy))].sort();
  return { n: rows.length, years: `${yrs[0]}–${yrs[yrs.length - 1]} (${yrs.length}yr)` };
}

async function isFresh(city: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ c: number; latest: string | null }[]>(
    "SELECT COUNT(*) c, MAX(captured_at) latest FROM nadlan_transactions WHERE city_name = ? AND source='govmap'", city);
  const r = rows[0];
  if (!r || Number(r.c) === 0 || !r.latest) return false;
  return (Date.now() - new Date(r.latest).getTime()) / 86400000 < FRESH_DAYS;
}

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const names = argv.filter((a) => !a.startsWith("--"));
  const cities = names.length ? names : (await prisma.city.findMany({ select: { city_name: true }, orderBy: { population_2026: "desc" } })).map((c) => c.city_name);

  await ensureSourceDealIdColumn(prisma);
  console.log(`\n=== collect-govmap-transactions — ${cities.length} cities ===`);
  let ok = 0, skip = 0, empty = 0, err = 0;
  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    const tag = `[${i + 1}/${cities.length}] ${city}`;
    if (!force && (await isFresh(city))) { console.log(`${tag}: skip (fresh)`); skip++; continue; }
    try {
      const t0 = Date.now();
      const { n, years } = await collectCity(city);
      if (n === 0) { console.log(`${tag}: EMPTY`); empty++; }
      else { console.log(`${tag}: ${n} deals ${years} (${((Date.now() - t0) / 1000).toFixed(0)}s)`); ok++; }
    } catch (e) { console.error(`${tag}: ERROR — ${e instanceof Error ? e.message : e}`); err++; }
  }
  console.log(`\n--- Done. ok=${ok}, skipped=${skip}, empty=${empty}, errored=${err} ---`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
