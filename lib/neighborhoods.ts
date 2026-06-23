/**
 * Neighborhood data loader for the city page.
 *
 * Source: the existing per-city deal cache at /data/deals_cache/{city}.json,
 * which was populated via the govmap.gov.il (Israel Tax Authority) API.
 *
 * The cache stores top-3 neighborhoods per city; for each one we have streets
 * with per-size-bucket price samples across 3 time periods (current / -3y / -5y).
 *
 * Here we aggregate that into a "neighborhood snapshot" suitable for a quick
 * UX-focused glance: name, deal volume, current price/sqm, trend vs prior years.
 */
import fs from "fs";
import path from "path";
import type { CityDealsData } from "./govNadlanService";

const CACHE_DIR = path.resolve(process.cwd(), "data", "deals_cache");

function safeFileName(cityName: string): string {
  return cityName.replace(/[/\\?%*:|"<>]/g, "_") + ".json";
}

export interface NeighborhoodSnapshot {
  name: string;
  totalDeals: number;
  dealsPerYearAvg: number;
  /** Representative street (the one with the most deals). */
  topStreet: string | null;
  /** Avg current price per sqm across all sampled streets in this neighborhood. */
  currentPricePerSqm: number | null;
  /** % change from 3 years ago. */
  change3y: number | null;
  /** % change from 5 years ago. */
  change5y: number | null;
  /** Number of streets we sampled. */
  sampledStreets: number;
  /** Total deals counted across all streets we sampled. */
  sampleDeals: number;
}

/**
 * Extract a price per sqm from a sample object.
 * Handles both "aggregated" (≥2 deals) and "single" (1 deal) cases.
 */
function samplePrice(sample: unknown): number | null {
  if (!sample || typeof sample !== "object") return null;
  const s = sample as { type?: string; pricePerSqm?: number; avgPricePerSqm?: number };
  if (s.type === "aggregated" && typeof s.avgPricePerSqm === "number") return s.avgPricePerSqm;
  if (s.type === "single" && typeof s.pricePerSqm === "number") return s.pricePerSqm;
  return null;
}

/**
 * For a single street, compute its avg price for a period using the 80 sqm
 * bucket if present, else fall back to whatever bucket has data.
 */
function streetPriceForPeriod(
  street: { sizeBuckets?: Array<{ targetArea: number; periods?: Array<{ period: string; sample: unknown }> }> },
  period: "current" | "minus3" | "minus5"
): number | null {
  const buckets = street.sizeBuckets ?? [];
  if (buckets.length === 0) return null;
  // Prefer 80sqm — it's the most representative apartment size in Israel
  const preferred = buckets.find((b) => b.targetArea === 80) ?? buckets[0];
  const periodEntry = preferred.periods?.find((p) => p.period === period);
  return periodEntry ? samplePrice(periodEntry.sample) : null;
}

/**
 * Aggregate the neighborhood data into snapshot format.
 */
function buildSnapshot(neigh: Record<string, unknown>): NeighborhoodSnapshot {
  const streets = (neigh.streets as Array<Record<string, unknown>>) ?? [];
  // Compute weighted avg price per period across all sampled streets
  const periodSums = { current: 0, minus3: 0, minus5: 0 };
  const periodCounts = { current: 0, minus3: 0, minus5: 0 };
  for (const street of streets) {
    for (const period of ["current", "minus3", "minus5"] as const) {
      const price = streetPriceForPeriod(street as Parameters<typeof streetPriceForPeriod>[0], period);
      if (price && price > 0) {
        periodSums[period] += price;
        periodCounts[period] += 1;
      }
    }
  }
  const avg = (key: keyof typeof periodSums) =>
    periodCounts[key] > 0 ? periodSums[key] / periodCounts[key] : null;
  const current = avg("current");
  const minus3 = avg("minus3");
  const minus5 = avg("minus5");
  const pctChange = (from: number | null, to: number | null) =>
    from && to && from > 0 ? ((to - from) / from) * 100 : null;

  // Top street = the one with the highest totalDeals
  const top = streets.length > 0
    ? streets.reduce((a, b) =>
        ((a.totalDeals as number) ?? 0) > ((b.totalDeals as number) ?? 0) ? a : b
      )
    : null;

  const sampleDeals = streets.reduce((s, st) => s + ((st.totalDeals as number) ?? 0), 0);

  return {
    name: (neigh.neighborhood as string) ?? "(ללא שם)",
    totalDeals: (neigh.totalDeals as number) ?? 0,
    dealsPerYearAvg: (neigh.dealsPerYearAvg as number) ?? 0,
    topStreet: top ? ((top.streetName as string) ?? null) : null,
    currentPricePerSqm: current,
    change3y: pctChange(minus3, current),
    change5y: pctChange(minus5, current),
    sampledStreets: streets.length,
    sampleDeals,
  };
}

export function loadCityNeighborhoods(cityName: string): NeighborhoodSnapshot[] {
  const file = path.join(CACHE_DIR, safeFileName(cityName));
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8")) as CityDealsData;
    const neighborhoods = (data as unknown as { neighborhoods?: Record<string, unknown>[] }).neighborhoods ?? [];
    return neighborhoods.map(buildSnapshot);
  } catch {
    return [];
  }
}
