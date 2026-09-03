/**
 * The client-safe half of lib/dealPins.ts: the point shapes and the pure
 * rules the map's pin layer needs in the BROWSER. Kept apart from the loader
 * because that file imports the database, and a client component importing
 * it — even for one pure function — drags better-sqlite3 into the browser
 * bundle, where it fails on `fs`. (Measured: the whole city page 500'd.)
 * Everything here is pinned in tests/pure.test.ts.
 */
import { addressKey, addressKeyString, normHouse } from "./addressKey";
import type { LonLat, Point } from "./geo";

export interface DealPoint {
  /** nadlan_transactions.id — what a click on the pin points at */
  id: number;
  x: number;
  y: number;
  priceSqm: number | null;
  /** YYYYMM, for the tooltip and the year filter */
  ym: number;
  rooms: number | null;
  area: number | null;
  price: number | null;
  floor: string | null;
  /** index into HoodDealPoints.streets — the name is sent once per street */
  streetIdx: number;
  houseNum: string | null;
  level: "house" | "street";
}

export interface HoodDealPoints {
  points: DealPoint[];
  /** dictionary for DealPoint.streetIdx */
  streets: string[];
  /** deals in the window, located or not */
  total: number;
  /** deals that got a point (house or street level) */
  located: number;
  houseLevel: number;
  streetLevel: number;
  /** the neighbourhood's median ₪/m² over the window — the pins' zero */
  medianSqm: number | null;
  /** the window actually served */
  years: [number, number] | null;
  /** true when `points` is the newest deal_map_max_points of `located` */
  capped: boolean;
  /** the rules' verdict (deal_map_min_geocoded_ratio, deal_map_min_points) —
   *  decided here so the client never needs the rules */
  worthShowing: boolean;
}

/* ───────────────────────── pure parts (tested) ───────────────────────── */

export interface DealRow {
  id: number;
  deal_date: string;
  deal_year: number;
  price_sqm: number | null;
  rooms: number | null;
  area: number | null;
  price: number | null;
  floor: string | null;
  street: string | null;
  house_num: string | null;
}

export interface GeoRow {
  street_norm: string;
  house_norm: string;
  lon: number;
  lat: number;
  level: "house" | "street";
}

/** The five bins around the median: <0.8, 0.8–0.95, 0.95–1.05, 1.05–1.2, >1.2. */
export function pinBin(priceSqm: number | null, median: number | null): 0 | 1 | 2 | 3 | 4 {
  if (priceSqm == null || !(priceSqm > 0) || median == null || !(median > 0)) return 2;
  const r = priceSqm / median;
  if (r < 0.8) return 0;
  if (r < 0.95) return 1;
  if (r <= 1.05) return 2;
  if (r <= 1.2) return 3;
  return 4;
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Join deals to their geocodes and project them. `geocodes` is keyed by
 * addressKeyString within one city. Returns the points plus the counts the
 * caption needs; the un-located remainder is `deals.length - located`.
 */
export function joinDealsToGeocodes(
  cityName: string,
  deals: DealRow[],
  geocodes: Map<string, GeoRow>,
  projectPoint: (p: LonLat) => Point
): { points: DealPoint[]; streets: string[]; located: number; houseLevel: number; streetLevel: number } {
  const streets: string[] = [];
  const streetIdx = new Map<string, number>();
  const points: DealPoint[] = [];
  let houseLevel = 0, streetLevel = 0;

  for (const d of deals) {
    const key = addressKey(cityName, d.street, d.house_num);
    if (!key) continue;
    const house = normHouse(d.house_num);
    let hit: GeoRow | undefined;
    for (const h of [house.primary, ...house.alts]) {
      if (!h) continue;
      hit = geocodes.get(addressKeyString({ streetNorm: key.streetNorm, houseNorm: h }));
      if (hit && hit.level === "house") break;
    }
    if (!hit || hit.level !== "house") {
      const s = geocodes.get(addressKeyString({ streetNorm: key.streetNorm, houseNorm: "" }));
      if (s) hit = s;
    }
    if (!hit) continue;

    const streetName = d.street!.trim();
    let si = streetIdx.get(streetName);
    if (si == null) { si = streets.length; streets.push(streetName); streetIdx.set(streetName, si); }
    const [x, y] = projectPoint([hit.lon, hit.lat]);
    const level: DealPoint["level"] = hit.level === "house" ? "house" : "street";
    if (level === "house") houseLevel++; else streetLevel++;
    points.push({
      id: d.id, x, y,
      priceSqm: d.price_sqm,
      ym: ymOf(d.deal_date, d.deal_year),
      rooms: d.rooms, area: d.area, price: d.price, floor: d.floor,
      streetIdx: si, houseNum: d.house_num, level,
    });
  }
  return { points, streets, located: points.length, houseLevel, streetLevel };
}

/** "2025-03-14" → 202503; a date the parser cannot read falls back to the year. */
export function ymOf(dealDate: string, dealYear: number): number {
  const m = dealDate.match(/^(\d{4})-(\d{2})/);
  if (m) return Number(m[1]) * 100 + Number(m[2]);
  return dealYear * 100 + 1;
}

/** Newest first, at most `max`. */
export function capPoints(points: DealPoint[], max: number): { points: DealPoint[]; capped: boolean } {
  if (points.length <= max) return { points, capped: false };
  const sorted = [...points].sort((a, b) => b.ym - a.ym || b.id - a.id);
  return { points: sorted.slice(0, max), capped: true };
}

/**
 * The year window to show when the caller named none: the neighbourhood's
 * latest year and `years - 1` before it. Derived from the rows, so a
 * neighbourhood whose feed stopped in 2024 shows 2022–2024, not an empty 2026.
 */
export function defaultWindow(dealYears: number[], years: number): [number, number] | null {
  if (!dealYears.length) return null;
  const to = Math.max(...dealYears);
  return [to - Math.max(1, years) + 1, to];
}

/** Whether the layer is worth drawing at all — the rules' gate, pure. */
export function pinsWorthShowing(p: Pick<HoodDealPoints, "total" | "located">, minRatio: number, minPoints: number): boolean {
  if (p.located < minPoints) return false;
  if (p.total > 0 && p.located / p.total < minRatio) return false;
  return true;
}

/** A requested [from, to] cut down to the years that actually have deals. */
export function clampWindow(req: [number, number], dealYears: number[]): [number, number] | null {
  if (!dealYears.length) return null;
  const lo = Math.max(req[0], Math.min(...dealYears));
  const hi = Math.min(req[1], Math.max(...dealYears));
  return lo <= hi ? [lo, hi] : null;
}
