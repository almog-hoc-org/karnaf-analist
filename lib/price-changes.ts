/**
 * Centralised 3y / 5y price-change calculation (official medians).
 *
 * Source: nadlan_price_trends (quarterly median deal prices per city).
 * Method: average all quarters of a year to get an annual median price, then
 * compare `end − window` against `end`.
 *
 * THE END YEAR IS CAPPED AT refYear() — the same site-wide reference year the
 * second-hand insight metrics use (lib/refYear.ts). Before this cap the end
 * year was simply "latest year available", which in any running calendar year
 * means a PARTIAL year: an annual average built from one or two quarters,
 * compared against full years, presented as a multi-year trend. The homepage
 * insights already refused to do that (they end at ref_year); the city page
 * did not, so the two surfaces disagreed about the same city. One anchor now
 * drives both.
 *
 * Window starts are derived from the end year (end−3 / end−5), not hardcoded
 * calendar years — the previous constants (2022/2020) were correct exactly
 * until the first ref_year bump and silently wrong after it.
 *
 * Used by:
 *   - /cities — full table with both columns sortable
 *   - /city/[slug] — both numbers shown in the price section
 *   - homepage rankings — top movers in 3y AND 5y
 *   - /rankings/highest-gain — toggleable between windows
 */
import { prisma } from "./db";
import { cachedMap, TAGS, TTL } from "./cache";
import { refYear } from "./refYear";

export interface PriceChangeWindow {
  /** % change from `fromY` to `toY`. */
  pct: number;
  /** Median price at the start year. */
  fromAvg: number;
  /** Median price at the end year. */
  toAvg: number;
  /** First year >= window start that actually has data for this city. */
  fromY: number;
  /** End year: latest data year that does not exceed the site reference year. */
  toY: number;
  /** Quarters behind each endpoint — the evidence. 1-quarter years are weak. */
  fromQuarters: number;
  toQuarters: number;
  /** True when either endpoint rests on a single quarter, OR the window slid
   *  more than 2 years past its nominal start. Display with a caveat. */
  thin: boolean;
}

export interface CityPriceChanges {
  city_name: string;
  /** 3-year window ending at the reference year. */
  change3y: PriceChangeWindow | null;
  /** 5-year window ending at the reference year. */
  change5y: PriceChangeWindow | null;
}

/**
 * Compute % change over a `win`-year window ending at the latest year ≤ endCap.
 */
function computeChange(
  yrs: Map<number, { sum: number; n: number }>,
  win: number,
  endCap: number
): PriceChangeWindow | null {
  const years = [...yrs.keys()].filter((y) => y <= endCap).sort((a, b) => a - b);
  const end = years[years.length - 1];
  if (end === undefined) return null;
  // Slide is bounded: a "3-year change" that actually compares end-0.5y is
  // not a 3-year change. Up to 2 years of forward slide is disclosed via
  // fromY; beyond that the window is refused rather than mislabeled.
  const start = years.find((y) => y >= end - win);
  if (start === undefined || start >= end) return null;
  if (start > end - win + 2) return null;
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
    fromQuarters: a.n,
    toQuarters: b.n,
    // No deal counts exist in nadlan_price_trends (official medians), so the
    // evidence unit is QUARTERS: an annual "median" built from one quarter is
    // a weak endpoint and the UI must say so.
    thin: a.n < 2 || b.n < 2 || start > end - win,
  };
}

function accumulate(
  into: Map<number, { sum: number; n: number }>,
  year: number,
  price: number
) {
  const cur = into.get(year) ?? { sum: 0, n: 0 };
  cur.sum += price;
  cur.n += 1;
  into.set(year, cur);
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
    accumulate(yrs, r.year, r.median_price);
  }
  return out;
}

/**
 * Compute 3y + 5y price-change for every city in nadlan_price_trends.
 * Returns a Map keyed by city_name for O(1) lookup.
 */
async function loadAllCityPriceChangesUncached(): Promise<Map<string, CityPriceChanges>> {
  const averages = await loadCityAnnualAverages();
  const endCap = refYear();
  const out = new Map<string, CityPriceChanges>();
  for (const [city_name, yrs] of averages) {
    out.set(city_name, {
      city_name,
      change3y: computeChange(yrs, 3, endCap),
      change5y: computeChange(yrs, 5, endCap),
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
    accumulate(yrs, r.year, r.median_price);
  }
  const endCap = refYear();
  return {
    city_name: cityName,
    change3y: computeChange(yrs, 3, endCap),
    change5y: computeChange(yrs, 5, endCap),
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

/* Cached: the all-cities variant re-reads nadlan_price_trends whole. The
 * per-city loadCityPriceChanges stays uncached on purpose — it is one narrow
 * indexed query and caching 168 separate entries would cost more than it saves. */
/* guardEmpty: an empty map here means the price-change columns render "—" for
 * every city, and without the guard that degenerate result is what the cache
 * keeps for the next six hours. Its three siblings in lib/cityTransactionPrices
 * already carry the flag; this loader was the one that did not. */
export const loadAllCityPriceChanges = cachedMap(loadAllCityPriceChangesUncached, ["all-city-price-changes"], TAGS.market, TTL.market, true);
