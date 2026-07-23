/**
 * Centralised 3y / 5y price-change calculation.
 *
 * Source: nadlan_price_trends (quarterly median deal prices per city, 2020-2025).
 * Method: average all quarters of a year to get an annual median price, then
 * compare the earliest year ≥ window-start against the latest year available.
 *
 * Used by:
 *   - /cities — full table with both columns sortable
 *   - /city/[slug] — both numbers shown in the price section
 *   - homepage rankings — top movers in 3y AND 5y
 *   - /rankings/highest-gain — toggleable between windows
 *
 * The 5y window aligns with the supply-demand gap analysis window (2020-onwards);
 * the 3y window is 2022-onwards.
 */
import { prisma } from "./db";

const WINDOW_3Y_START = 2022;
const WINDOW_5Y_START = 2020;

export interface PriceChangeWindow {
  /** % change from `fromY` to `toY`. */
  pct: number;
  /** Median price at the start year. */
  fromAvg: number;
  /** Median price at the end year. */
  toAvg: number;
  /** First year >= window start that actually has data for this city. */
  fromY: number;
  /** Latest year available in nadlan for this city. */
  toY: number;
}

export interface CityPriceChanges {
  city_name: string;
  /** 3-year window (2022 → latest). */
  change3y: PriceChangeWindow | null;
  /** 5-year window (2020 → latest). */
  change5y: PriceChangeWindow | null;
}

/**
 * Compute % change between two windows for a single city's annual averages.
 */
function computeChange(yrs: Map<number, { sum: number; n: number }>, fromYear: number): PriceChangeWindow | null {
  const years = [...yrs.keys()].sort((a, b) => a - b);
  const start = years.find((y) => y >= fromYear);
  const end = years[years.length - 1];
  if (start === undefined || end === undefined || start >= end) return null;
  const a = yrs.get(start)!;
  const b = yrs.get(end)!;
  const fromAvg = a.sum / a.n;
  const toAvg = b.sum / b.n;
  if (fromAvg <= 0) return null;
  return {
    pct: ((toAvg - fromAvg) / fromAvg) * 100,
    fromAvg,
    toAvg,
    fromY: start,
    toY: end,
  };
}

/**
 * Load all cities' annual median price averages from nadlan_price_trends.
 * Returns a Map keyed by city_name.
 */
async function loadCityAnnualAverages(): Promise<Map<string, Map<number, { sum: number; n: number }>>> {
  const rows = await prisma.nadlan_price_trends.findMany({
    where: { median_price: { not: null, gt: 0 } },
    orderBy: [{ city_name: "asc" }, { year: "asc" }, { quarter: "asc" }],
  });
  const out = new Map<string, Map<number, { sum: number; n: number }>>();
  for (const r of rows) {
    if (r.median_price === null) continue;
    let yrs = out.get(r.city_name);
    if (!yrs) { yrs = new Map(); out.set(r.city_name, yrs); }
    const cur = yrs.get(r.year) ?? { sum: 0, n: 0 };
    cur.sum += r.median_price;
    cur.n += 1;
    yrs.set(r.year, cur);
  }
  return out;
}

/**
 * Compute 3y + 5y price-change for every city in nadlan_price_trends.
 * Returns a Map keyed by city_name for O(1) lookup.
 */
export async function loadAllCityPriceChanges(): Promise<Map<string, CityPriceChanges>> {
  const averages = await loadCityAnnualAverages();
  const out = new Map<string, CityPriceChanges>();
  for (const [city_name, yrs] of averages) {
    out.set(city_name, {
      city_name,
      change3y: computeChange(yrs, WINDOW_3Y_START),
      change5y: computeChange(yrs, WINDOW_5Y_START),
    });
  }
  return out;
}

/**
 * Compute 3y + 5y for a single city — useful on the city page.
 */
export async function loadCityPriceChanges(cityName: string): Promise<CityPriceChanges | null> {
  const rows = await prisma.nadlan_price_trends.findMany({
    where: { city_name: cityName, median_price: { not: null, gt: 0 } },
    orderBy: [{ year: "asc" }, { quarter: "asc" }],
  });
  if (rows.length === 0) return null;
  const yrs = new Map<number, { sum: number; n: number }>();
  for (const r of rows) {
    if (r.median_price === null) continue;
    const cur = yrs.get(r.year) ?? { sum: 0, n: 0 };
    cur.sum += r.median_price;
    cur.n += 1;
    yrs.set(r.year, cur);
  }
  return {
    city_name: cityName,
    change3y: computeChange(yrs, WINDOW_3Y_START),
    change5y: computeChange(yrs, WINDOW_5Y_START),
  };
}

/**
 * Return the top-N cities by 3y or 5y price change (descending).
 * Cities without a price change for the chosen window are filtered out.
 */
export function topMoversByWindow(
  all: Map<string, CityPriceChanges>,
  window: "3y" | "5y",
  limit = 10
): Array<{ city_name: string; pct: number; fromY: number; toY: number }> {
  const items: Array<{ city_name: string; pct: number; fromY: number; toY: number }> = [];
  for (const [name, c] of all) {
    const w = window === "3y" ? c.change3y : c.change5y;
    if (w === null) continue;
    items.push({ city_name: name, pct: w.pct, fromY: w.fromY, toY: w.toY });
  }
  items.sort((a, b) => b.pct - a.pct);
  return items.slice(0, limit);
}
