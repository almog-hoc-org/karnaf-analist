#!/usr/bin/env tsx
/**
 * Collect INDIVIDUAL real-estate transactions from רשות המסים (via the govmap API) into
 * nadlan_transactions with source='govmap'. Unlike nadlan's anonymous 1,000-deal cap, this
 * endpoint returns every deal across a date range — so we get the BROAD multi-year data
 * (2015→now) for the year-over-year graphs, for ALL cities. No build year here (govmap has
 * none), so these rows power the "all" + room graphs; the second-hand/new split stays on the
 * nadlan build-year rows (source='nadlan').
 *
 * Usage:
 *   npx tsx scripts/collect-govmap-transactions.ts                 # all DB cities, skip fresh
 *   npx tsx scripts/collect-govmap-transactions.ts "לוד" "ירושלים"
 *   npx tsx scripts/collect-govmap-transactions.ts --force ...
 */
import { prisma } from "../lib/db";

const GOVMAP_BASE = "https://www.govmap.gov.il/api";
const REQUEST_DELAY_MS = 350;
const START_DATE = "2015-01";
const END_DATE = "2026-12";
const MID_DATE = "2020-06";
const SWEEP_RADIUS = 2500;
const RING_OFFSETS_M = [0, 2000, 4000, 6000];
const MAX_POLYGONS = 45;
const FRESH_DAYS = 20;
const MIN_SQM = 2_000, MAX_SQM = 200_000, MIN_AREA = 20, MAX_AREA = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RawDeal {
  dealId?: number; dealDate: string; dealAmount: number; assetRoomNum: number | null;
  assetArea: number | null; neighborhood: string | null; settlementNameHeb?: string | null;
  settlementId?: number; dealNatureDescription?: string | null;
  streetNameHeb?: string | null; houseNum?: string | number | null; floorNo?: number | null;
}

function normalizeCity(name: string | null | undefined): string {
  if (!name) return "";
  return name.replace(/["'`]/g, "").replace(/[-–]/g, " ").replace(/יי/g, "י").replace(/וו/g, "ו").replace(/\s+/g, " ").trim();
}
function isResidentialApartment(nature: string | null | undefined): boolean {
  if (!nature) return false;
  if (/קבוצת רכישה|קרקע|מסחרי|משרד|חנות|חניה|מחסן|תעשיה|ללא תיכנון|מלון|דיור מוגן/.test(nature)) return false;
  return ["דירה", "דירת גן", "דירת גג", "פנטהאוז", "קוטג'", "בית בודד", "דו משפחתי", "מיני פנטהאוז"].some((p) => nature.includes(p));
}
function roomBucket(rn: number | null): string {
  if (rn == null || isNaN(rn)) return "other";
  if (rn >= 2.5 && rn < 3.5) return "3";
  if (rn >= 3.5 && rn < 4.5) return "4";
  if (rn >= 4.5) return "5";
  return "other";
}

async function gf(url: string, options?: RequestInit): Promise<Response> {
  // retry on throttle/transient errors (govmap returns HTML/5xx under load)
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { ...options, headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "RealEstateDashboard/1.0", ...(options?.headers || {}) } });
      if (!res.ok) throw new Error(`Govmap ${res.status}`);
      return res;
    } catch (e) { lastErr = e; await sleep(800 * (attempt + 1)); }
  }
  throw lastErr;
}
/** ALL settlement candidate centre points (there can be several "יבנה"s; the right one is
 *  whichever yields matching polygons — so we sweep from all of them). */
async function searchCityPoints(cityName: string): Promise<{ x: number; y: number }[]> {
  const res = await gf(`${GOVMAP_BASE}/search-service/autocomplete`, { method: "POST", body: JSON.stringify({ searchText: cityName, language: "he", isAccurate: false, maxResults: 10 }) });
  const data = await res.json();
  const pts: { x: number; y: number }[] = [];
  const cands = (data.results ?? []).filter((r: { type: string }) => r.type === "settlement");
  for (const r of (cands.length ? cands : (data.results ?? []).slice(0, 2))) {
    const m = r?.shape?.match(/POINT\(([^ ]+) ([^ ]+)\)/);
    if (m) pts.push({ x: Math.round(parseFloat(m[1])), y: Math.round(parseFloat(m[2])) });
  }
  return pts;
}

async function collectCity(cityName: string): Promise<{ n: number; years: string }> {
  const cityKey = normalizeCity(cityName);
  const centers = await searchCityPoints(cityName);
  if (centers.length === 0) return { n: 0, years: "" };
  await sleep(REQUEST_DELAY_MS);

  // sweep grid → city polygons. Sweep from EVERY candidate centre (handles duplicate/wrong
  // autocomplete hits) with wider rings (handles centres that land just outside the city).
  const sweep: { x: number; y: number }[] = [];
  for (const c of centers) {
    sweep.push({ x: c.x, y: c.y });
    for (const r of RING_OFFSETS_M) { if (r === 0) continue; for (let a = 0; a < 360; a += 45) { const rad = (a * Math.PI) / 180; sweep.push({ x: Math.round(c.x + r * Math.cos(rad)), y: Math.round(c.y + r * Math.sin(rad)) }); } }
  }
  const polys = new Map<string, number>();
  for (const pt of sweep) {
    try {
      const arr: { polygon_id: string; dealscount: string; settlementNameHeb: string }[] = await (await gf(`${GOVMAP_BASE}/real-estate/deals/${pt.x},${pt.y}/${SWEEP_RADIUS}`)).json();
      for (const p of arr ?? []) { if (parseInt(p.dealscount) > 0 && normalizeCity(p.settlementNameHeb) === cityKey && !polys.has(p.polygon_id)) polys.set(p.polygon_id, parseInt(p.dealscount)); }
    } catch { /* transient */ }
    await sleep(REQUEST_DELAY_MS);
  }
  const picked = [...polys.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_POLYGONS).map((e) => e[0]);
  if (picked.length === 0) return { n: 0, years: "" };

  // fetch deals per polygon (two windows for the 2000-per-call limit)
  const seen = new Set<string>();
  const deals: RawDeal[] = [];
  for (const pid of picked) {
    for (const [s, e] of [[START_DATE, MID_DATE], [MID_DATE, END_DATE]] as const) {
      try {
        const d: { data?: RawDeal[] } = await (await gf(`${GOVMAP_BASE}/real-estate/neighborhood-deals/${pid}?limit=2000&startDate=${s}&endDate=${e}`)).json();
        for (const deal of d.data ?? []) {
          if (normalizeCity(deal.settlementNameHeb) !== cityKey) continue;
          if (!isResidentialApartment(deal.dealNatureDescription)) continue;
          const key = String(deal.dealId ?? `${deal.dealDate}-${deal.dealAmount}-${deal.assetArea}`);
          if (seen.has(key)) continue;
          seen.add(key);
          deals.push(deal);
        }
      } catch { /* skip */ }
      await sleep(REQUEST_DELAY_MS);
    }
  }

  // build rows (sane-bounded)
  const rows = deals.map((d) => {
    const area = d.assetArea ?? 0;
    const price = d.dealAmount ?? 0;
    const sqm = area > 0 ? price / area : 0;
    const dy = Number(String(d.dealDate).slice(0, 4));
    return { d, area, price, sqm, dy };
  }).filter((r) => r.dy > 1990 && r.area >= MIN_AREA && r.area <= MAX_AREA && r.sqm >= MIN_SQM && r.sqm <= MAX_SQM);
  if (rows.length === 0) return { n: 0, years: "" };

  await prisma.$executeRawUnsafe("DELETE FROM nadlan_transactions WHERE city_name = ? AND source = 'govmap'", cityName);
  const COLS = "city_name,cbs_code,deal_date,deal_year,rooms,room_bucket,area,price,price_sqm,year_built,is_secondhand,neighborhood,street,house_num,floor,source";
  const CHUNK = 60;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const vs = slice.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
    const params: unknown[] = [];
    for (const r of slice) params.push(cityName, r.d.settlementId ? String(r.d.settlementId) : null, String(r.d.dealDate).slice(0, 10), r.dy, r.d.assetRoomNum ?? null, roomBucket(r.d.assetRoomNum), r.area, r.price, Math.round(r.sqm), null, 0, r.d.neighborhood ?? null, r.d.streetNameHeb ?? null, r.d.houseNum != null ? String(r.d.houseNum) : null, r.d.floorNo ?? null, "govmap");
    await prisma.$executeRawUnsafe(`INSERT INTO nadlan_transactions (${COLS}) VALUES ${vs}`, ...params);
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
