/**
 * Aggregates raw nadlan/govmap deals into a (subarea × room-count × year)
 * matrix per city. Different aggregation than the existing
 * `govNadlanService.getCityDealsData` because:
 *
 *  1. We KEEP deal-level granularity until the final bucket — the existing
 *     cache discards `assetRoomNum` after streets are aggregated.
 *  2. We sample 4 FIXED target years (2016, 2020, 2023, 2026) instead of
 *     current/-3y/-5y.
 *  3. We bucket by sub-area (north / south / etc. — see `lib/city-subareas.ts`)
 *     not by neighborhood.
 *
 * We re-use the low-level polygon-fetching helpers from `govNadlanService.ts`
 * (`searchCityCoordinates`, `getDealsByRadius`, `getNeighborhoodDeals`) by
 * importing the file as a whole and pulling those out — the file doesn't
 * export them publicly so we re-implement the orchestration here.
 */
import fs from "fs";
import path from "path";
import { classifySubarea, getSubareas } from "./city-subareas";
import { TARGET_YEARS } from "./subarea-deals-types";
import type {
  TargetYear,
  RoomBucket,
  MatrixCell,
  SubareaRow,
  CityYearMatrix,
  CitySubareaMatrix,
} from "./subarea-deals-types";

// Re-export so existing callers that imported these from this file keep working.
export { TARGET_YEARS };
export type { TargetYear, RoomBucket, MatrixCell, SubareaRow, CityYearMatrix, CitySubareaMatrix };

const YEAR_WINDOW = 0; // annual buckets now (2016..2026 each its own year)

// Reasonable apartment-size bounds (sqm). Outside these → drop the deal.
const MIN_AREA = 20;
const MAX_AREA = 500;
// Reasonable price/sqm bounds (₪). Outside these → drop the deal.
const MIN_PRICE_PER_SQM = 2_000;
const MAX_PRICE_PER_SQM = 200_000;

// Govmap politeness
const REQUEST_DELAY_MS = 400;
const MAX_FETCHES = 30; // higher than govNadlanService (12) — we need a wider window

// ── Local-only types ─────────────────────────────────────────────

interface RawDeal {
  dealDate: string;
  dealAmount: number;
  assetRoomNum: number | null;
  assetArea: number | null;
  neighborhood: string | null;
  /** Settlement (city) the deal physically sits in — govmap returns this. Used
   *  to drop neighbouring-city deals that bleed in via radius polygons. */
  settlementNameHeb?: string | null;
  /** Asset nature ("דירה בבית קומות" / "קרקע למגורים" / "חנות" …). Used to keep
   *  only residential-apartment deals and drop land / commercial / parking. */
  dealNatureDescription?: string | null;
}

// Residential-apartment natures we KEEP (everything else — land, shops, offices,
// parking, storage, industrial, and "קבוצת רכישה" purchase-groups which are
// new-build by definition — is dropped). Substring match for robustness.
const RESIDENTIAL_NATURE_PATTERNS = [
  "דירה",      // דירה בבית קומות
  "דירת גן",
  "דירת גג",
  "פנטהאוז",
  "קוטג'",     // קוטג' חד/דו משפחתי / טורי
  "בית בודד",
  "דו משפחתי",
  "מיני פנטהאוז",
] as const;

function isResidentialApartment(nature: string | null | undefined): boolean {
  if (!nature) return false; // unknown nature → exclude (conservative)
  // Explicit excludes first (a "מסחרי + מגורים" should not count as clean residential)
  if (/קבוצת רכישה|קרקע|מסחרי|משרד|חנות|חניה|מחסן|תעשיה|ללא תיכנון|מלון|דיור מוגן/.test(nature)) {
    return false;
  }
  return RESIDENTIAL_NATURE_PATTERNS.some((p) => nature.includes(p));
}

/** Normalise a city name so spelling/spacing variants compare equal
 *  (e.g. "תל אביב-יפו" / "תל אביב -יפו" / "תל אביב יפו"). */
function normalizeCity(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .replace(/["'`]/g, "")
    .replace(/[-–]/g, " ")   // hyphens → space
    // Collapse ktiv-male/haser variants so spelling differences compare equal:
    //   הרצלייה ↔ הרצליה  (double yod)
    //   פתח תקווה ↔ פתח תקוה  (double vav)
    .replace(/יי/g, "י")
    .replace(/וו/g, "ו")
    .replace(/\s+/g, " ")     // collapse whitespace
    .trim();
}

const EMPTY_CELL: MatrixCell = { avgPricePerSqm: null, medianPricePerSqm: null, dealCount: 0 };

const ROOM_BUCKETS: RoomBucket[] = ["2", "3", "4", "5+"];

function bucketForRooms(rooms: number | null): RoomBucket | null {
  if (rooms === null || isNaN(rooms)) return null;
  if (rooms < 1.5) return null; // 1-room studios — drop (rare + skew avg/sqm)
  if (rooms < 2.5) return "2";
  if (rooms < 3.5) return "3";
  if (rooms < 4.5) return "4";
  if (rooms < 5.5) return "5+";
  return "5+"; // 6+ rooms → still "5+"
}

function bucketForYear(year: number): TargetYear | null {
  for (const target of TARGET_YEARS) {
    if (Math.abs(year - target) <= YEAR_WINDOW) return target;
  }
  return null;
}

// ── Govmap helpers (light copies — keep this file self-contained) ─

const GOVMAP_BASE = "https://www.govmap.gov.il/api";

async function govmapFetch(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "RealEstateDashboard/1.0",
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Govmap API error: ${res.status} ${res.statusText}`);
  return res;
}

async function searchCityCoordinates(cityName: string): Promise<{ x: number; y: number } | null> {
  const res = await govmapFetch(`${GOVMAP_BASE}/search-service/autocomplete`, {
    method: "POST",
    body: JSON.stringify({ searchText: cityName, language: "he", isAccurate: false, maxResults: 5 }),
  });
  const data = await res.json();
  const settlement = data.results?.find((r: { type: string }) => r.type === "settlement");
  const result = settlement || data.results?.[0];
  if (!result?.shape) return null;
  const match = result.shape.match(/POINT\(([^ ]+) ([^ ]+)\)/);
  if (!match) return null;
  return { x: Math.round(parseFloat(match[1])), y: Math.round(parseFloat(match[2])) };
}

async function getDealsByRadius(x: number, y: number, radius: number) {
  const res = await govmapFetch(`${GOVMAP_BASE}/real-estate/deals/${x},${y}/${radius}`);
  return res.json() as Promise<
    Array<{ polygon_id: string; streetNameHeb: string; houseNum: number; dealscount: string; settlementNameHeb: string }>
  >;
}

async function getNeighborhoodDeals(polygonId: string, startDate: string, endDate: string, limit = 2000) {
  const url = `${GOVMAP_BASE}/real-estate/neighborhood-deals/${polygonId}?limit=${limit}&startDate=${startDate}&endDate=${endDate}`;
  const res = await govmapFetch(url);
  return res.json() as Promise<{ totalCount: string; data: RawDeal[] }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Aggregation ──────────────────────────────────────────────────

function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Build a cell (₪/sqm + total price + n) from a set of deals. */
function buildCell(deals: { pricePerSqm: number; dealAmount: number }[]): MatrixCell {
  if (deals.length === 0) return { ...EMPTY_CELL };
  const pps = deals.map((d) => d.pricePerSqm);
  const tot = deals.map((d) => d.dealAmount);
  return {
    avgPricePerSqm: pps.reduce((s, v) => s + v, 0) / pps.length,
    medianPricePerSqm: computeMedian(pps),
    avgPrice: tot.reduce((s, v) => s + v, 0) / tot.length,
    medianPrice: computeMedian(tot),
    dealCount: deals.length,
  };
}

function stddev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Take ALL deals for a city, drop invalid/outlier ones, and bucket into the
 * (year × sub-area × rooms) matrix.
 */
export function buildMatrix(cityName: string, deals: RawDeal[]): CitySubareaMatrix {
  let subareas = getSubareas(cityName); // list of sub-areas (incl "אחר" or single whole-city)

  // First pass — filter to valid deals only, attach derived fields
  type Annotated = RawDeal & { year: number; targetYear: TargetYear; bucket: RoomBucket; subareaSlug: string; pricePerSqm: number };
  const cityKey = normalizeCity(cityName);
  const annotated: Annotated[] = [];
  for (const d of deals) {
    if (!d.dealDate || !d.dealAmount || !d.assetArea) continue;
    // Exact-city gate — drop neighbouring-city deals that bleed in via radius
    // polygons (e.g. גבעתיים/רמת גן deals appearing under תל אביב). When the
    // field is absent we keep the deal (older caches lack it).
    if (d.settlementNameHeb && normalizeCity(d.settlementNameHeb) !== cityKey) continue;
    // Residential-apartment gate — keep only living apartments, drop land /
    // commercial / parking / new-build purchase-groups.
    if (!isResidentialApartment(d.dealNatureDescription)) continue;
    if (d.assetArea < MIN_AREA || d.assetArea > MAX_AREA) continue;
    const pps = d.dealAmount / d.assetArea;
    if (pps < MIN_PRICE_PER_SQM || pps > MAX_PRICE_PER_SQM) continue;
    const year = new Date(d.dealDate).getFullYear();
    if (isNaN(year)) continue;
    const targetYear = bucketForYear(year);
    if (!targetYear) continue;
    const bucket = bucketForRooms(d.assetRoomNum);
    if (!bucket) continue;
    const subareaSlug = classifySubarea(cityName, d.neighborhood) ?? "whole";
    annotated.push({ ...d, year, targetYear, bucket, subareaSlug, pricePerSqm: pps });
  }

  // Outlier filter — drop deals outside ±2σ of the city-wide price/sqm distribution
  if (annotated.length >= 10) {
    const all = annotated.map((d) => d.pricePerSqm);
    const mean = all.reduce((s, v) => s + v, 0) / all.length;
    const sd = stddev(all, mean);
    const lo = mean - 2 * sd;
    const hi = mean + 2 * sd;
    for (let i = annotated.length - 1; i >= 0; i--) {
      if (annotated[i].pricePerSqm < lo || annotated[i].pricePerSqm > hi) annotated.splice(i, 1);
    }
  }

  // Sub-area strategy: hand-curated map if it classifies well, otherwise fall
  // back to DATA-DRIVEN top neighbourhoods from the actual govmap names. This
  // fixes cities whose curated patterns don't match govmap's spellings (many
  // were ~100% "אחר"). We always show real areas + a small "אחר" remainder.
  const isWhole = subareas.length === 1 && subareas[0].slug === "whole";
  if (!isWhole && annotated.length > 0) {
    const otherN = annotated.filter((d) => d.subareaSlug === "other").length;
    // Fall back to data-driven when hand-curation is poor: either too much lands
    // in "אחר", OR some mapped sub-areas are starved (0 deals) — e.g. greedy
    // single-letter patterns lumping everything into one area.
    const mappedSlugs = subareas.filter((a) => a.slug !== "other" && a.slug !== "whole").map((a) => a.slug);
    const populated = new Set(annotated.map((d) => d.subareaSlug));
    const populatedMapped = mappedSlugs.filter((s) => populated.has(s)).length;
    if (otherN / annotated.length > 0.25 || populatedMapped < mappedSlugs.length) {
      const counts = new Map<string, number>();
      for (const d of annotated) {
        const name = (d.neighborhood || "").trim() || "ללא שם שכונה";
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      const nameToSlug = new Map<string, string>();
      subareas = top.map(([name], i) => {
        const slug = `nb${i}`;
        nameToSlug.set(name, slug);
        return { slug, label: name, patterns: [] };
      });
      subareas.push({ slug: "other", label: "אחר / לא ממופה", patterns: [] });
      for (const d of annotated) {
        const name = (d.neighborhood || "").trim() || "ללא שם שכונה";
        d.subareaSlug = nameToSlug.get(name) ?? "other";
      }
    }
  }

  // Build the matrix
  const byYear: Record<string, CityYearMatrix> = {};
  for (const targetYear of TARGET_YEARS) {
    const yearDeals = annotated.filter((d) => d.targetYear === targetYear);
    const rows: SubareaRow[] = subareas.map((area) => {
      const areaDeals = yearDeals.filter((d) => d.subareaSlug === area.slug || (area.slug === "whole" && cityName));
      const byRoom: Record<RoomBucket, MatrixCell> = {
        "2": { ...EMPTY_CELL }, "3": { ...EMPTY_CELL }, "4": { ...EMPTY_CELL }, "5+": { ...EMPTY_CELL },
      };
      for (const bucket of ROOM_BUCKETS) {
        const bucketDeals = areaDeals.filter((d) => d.bucket === bucket);
        if (bucketDeals.length === 0) continue;
        byRoom[bucket] = buildCell(bucketDeals);
      }
      return { subareaSlug: area.slug, subareaLabel: area.label, byRoom };
    });

    const cityTotalByRoom: Record<RoomBucket, MatrixCell> = {
      "2": { ...EMPTY_CELL }, "3": { ...EMPTY_CELL }, "4": { ...EMPTY_CELL }, "5+": { ...EMPTY_CELL },
    };
    for (const bucket of ROOM_BUCKETS) {
      const bucketDeals = yearDeals.filter((d) => d.bucket === bucket);
      if (bucketDeals.length === 0) continue;
      cityTotalByRoom[bucket] = buildCell(bucketDeals);
    }

    byYear[String(targetYear)] = { year: targetYear, rows, cityTotalByRoom };
  }

  // City-wide annual series (all rooms/sub-areas together) for the compare chart
  const cityAnnual = TARGET_YEARS.map((yr) => {
    const yd = annotated.filter((d) => d.targetYear === yr);
    if (yd.length === 0) {
      return { year: yr, avgPrice: null, medianPrice: null, avgPricePerSqm: null, medianPricePerSqm: null, dealCount: 0 };
    }
    const totals = yd.map((d) => d.dealAmount);
    const ppsqm = yd.map((d) => d.pricePerSqm);
    return {
      year: yr,
      avgPrice: totals.reduce((s, v) => s + v, 0) / totals.length,
      medianPrice: computeMedian(totals),
      avgPricePerSqm: ppsqm.reduce((s, v) => s + v, 0) / ppsqm.length,
      medianPricePerSqm: computeMedian(ppsqm),
      dealCount: yd.length,
    };
  });

  return {
    cityName,
    lastUpdated: new Date().toISOString(),
    totalRawDealsFetched: deals.length,
    totalDealsKept: annotated.length,
    byYear,
    cityAnnual,
  };
}

// ── Fetch + aggregate ───────────────────────────────────────────

/**
 * Top-level: fetch raw deals for a city across the full year span needed
 * (2015 → current+1), then aggregate into the (year × sub-area × room) matrix
 * and write to disk.
 *
 * Returns the matrix.
 */
export async function aggregateSubareaDeals(cityName: string): Promise<CitySubareaMatrix> {
  // Year span we need to fetch:
  const earliest = TARGET_YEARS[0] - YEAR_WINDOW;  // 2015
  const latest = TARGET_YEARS[TARGET_YEARS.length - 1] + YEAR_WINDOW; // 2027
  const startDate = `${earliest}-01`;
  const endDate = `${latest}-12`;

  const cityKey = normalizeCity(cityName);

  // Step 1: find city center
  const coords = await searchCityCoordinates(cityName);
  if (!coords) return buildMatrix(cityName, []);
  await sleep(REQUEST_DELAY_MS);

  // Step 2: collect polygons that ACTUALLY belong to this city.
  //
  // govmap's deals-by-radius endpoint caps at 100 polygons. At a large radius
  // that cap fills with NEIGHBOURING-city polygons (e.g. around רמת גן center
  // the 100 nearest include סביון/יהוד/גבעתיים and zero רמת גן), so the city
  // would come back empty after filtering. At a SMALL radius the cap is filled
  // almost entirely by the target city's own polygons. So we sweep a small grid
  // of points (centre + a ring at ~2 km + ~4 km) with a tight radius and keep
  // only polygons whose settlement matches — this covers both compact cities
  // (centre dominates) and large ones (the ring reaches the edges).
  const SWEEP_RADIUS = 2500;
  const RING_OFFSETS_M = [0, 2000, 4000];
  const sweepPoints: Array<{ x: number; y: number }> = [{ x: coords.x, y: coords.y }];
  for (const r of RING_OFFSETS_M) {
    if (r === 0) continue;
    for (let a = 0; a < 360; a += 45) {
      const rad = (a * Math.PI) / 180;
      sweepPoints.push({ x: Math.round(coords.x + r * Math.cos(rad)), y: Math.round(coords.y + r * Math.sin(rad)) });
    }
  }

  const cityPolys = new Map<string, { polygon_id: string; dealscount: number }>();
  for (const pt of sweepPoints) {
    try {
      const polys = await getDealsByRadius(pt.x, pt.y, SWEEP_RADIUS);
      for (const p of polys ?? []) {
        if (parseInt(p.dealscount) <= 0) continue;
        if (normalizeCity(p.settlementNameHeb) !== cityKey) continue; // drop neighbour-city polygons
        if (!cityPolys.has(p.polygon_id)) {
          cityPolys.set(p.polygon_id, { polygon_id: p.polygon_id, dealscount: parseInt(p.dealscount) });
        }
      }
    } catch {
      // transient govmap error on one sweep point — keep going
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const sortedPolygons = [...cityPolys.values()].sort((a, b) => b.dealscount - a.dealscount);
  if (sortedPolygons.length === 0) return buildMatrix(cityName, []);

  // Take the top polygons by deal volume (city footprint is already covered by
  // the sweep; the cap just bounds API calls).
  const pickOrder = sortedPolygons.slice(0, 40);

  // Step 3: fetch deals — TWO windows per polygon (earliest..2020, 2020..latest)
  // since the API returns at most 2000 per call.
  const allDeals: RawDeal[] = [];
  const seenKeys = new Set<string>();
  let fetchCount = 0;
  const midDate = `2020-06`;

  for (const polygon of pickOrder) {
    if (fetchCount >= MAX_FETCHES) break;
    try {
      // older half
      const older = await getNeighborhoodDeals(polygon.polygon_id, startDate, midDate, 2000);
      for (const deal of older.data ?? []) {
        const key = `${deal.dealDate}-${deal.dealAmount}-${deal.assetArea}-${deal.neighborhood ?? ""}`;
        if (!seenKeys.has(key)) { seenKeys.add(key); allDeals.push(deal); }
      }
      await sleep(REQUEST_DELAY_MS);

      // newer half
      const newer = await getNeighborhoodDeals(polygon.polygon_id, midDate, endDate, 2000);
      for (const deal of newer.data ?? []) {
        const key = `${deal.dealDate}-${deal.dealAmount}-${deal.assetArea}-${deal.neighborhood ?? ""}`;
        if (!seenKeys.has(key)) { seenKeys.add(key); allDeals.push(deal); }
      }
      fetchCount++;
      await sleep(REQUEST_DELAY_MS);
    } catch {
      // skip failed polygon, continue
    }
  }

  return buildMatrix(cityName, allDeals);
}

// ── Cache I/O ───────────────────────────────────────────────────

const CACHE_DIR = path.resolve(process.cwd(), "data", "subarea_deals");

function safeFilename(cityName: string): string {
  return cityName.replace(/[/\\?%*:|"<>]/g, "_") + ".json";
}

export function saveMatrix(matrix: CitySubareaMatrix): string {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const filePath = path.join(CACHE_DIR, safeFilename(matrix.cityName));
  fs.writeFileSync(filePath, JSON.stringify(matrix, null, 2));
  return filePath;
}

export function loadCachedMatrix(cityName: string): CitySubareaMatrix | null {
  try {
    const filePath = path.join(CACHE_DIR, safeFilename(cityName));
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as CitySubareaMatrix;
  } catch {
    return null;
  }
}

export function cacheAgeDays(cityName: string): number | null {
  const filePath = path.join(CACHE_DIR, safeFilename(cityName));
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
}
