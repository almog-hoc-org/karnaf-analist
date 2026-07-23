/**
 * Pure types + constants for the sub-area deal matrix.
 *
 * Split out of `subarea-deals-service.ts` so client components can import
 * them without dragging in `fs` / `path` / Node-only code (which break
 * Next.js client bundling).
 */

// Annual granularity 2016–2026 so recent peak-and-decline is visible (the
// coarse 4-year snapshots hid it). Every (sub-area × room × year) cell reports
// its own sample count so thin years are honest.
export const TARGET_YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026] as const;
export type TargetYear = (typeof TARGET_YEARS)[number];

export type RoomBucket = "2" | "3" | "4" | "5+";

export interface MatrixCell {
  /** Average ₪/sqm across the (n) deals that landed in this cell. */
  avgPricePerSqm: number | null;
  /** Median ₪/sqm — more robust to a single outlier. */
  medianPricePerSqm: number | null;
  /** Average total deal price (₪) — for comparing to the official median price. */
  avgPrice?: number | null;
  /** Median total deal price (₪). */
  medianPrice?: number | null;
  /** Number of deals that contributed (after outlier filter). */
  dealCount: number;
}

export interface SubareaRow {
  subareaSlug: string;
  subareaLabel: string;
  /** Keyed by room-count bucket: "2" / "3" / "4" / "5+". */
  byRoom: Record<RoomBucket, MatrixCell>;
}

export interface CityYearMatrix {
  year: TargetYear;
  rows: SubareaRow[];
  /** Whole-city aggregate per room-count, ignoring sub-area. */
  cityTotalByRoom: Record<RoomBucket, MatrixCell>;
}

/** City-wide, per-year aggregate across ALL rooms/sub-areas — used by the
 *  "our average vs official median" competitor chart. Carries both total-price
 *  and ₪/m² so it can be compared to the government median (total ₪) apples to
 *  apples, and to our own ₪/m² matrix. */
export interface CityAnnualPoint {
  year: number;
  avgPrice: number | null;            // average total deal price (₪)
  medianPrice: number | null;         // median total deal price (₪)
  avgPricePerSqm: number | null;
  medianPricePerSqm: number | null;
  dealCount: number;                  // n for this year
}

export interface CitySubareaMatrix {
  cityName: string;
  lastUpdated: string;
  totalRawDealsFetched: number;
  totalDealsKept: number;
  byYear: Record<string, CityYearMatrix>;
  /** Per-year city-wide series (2016..2026). Present on freshly-built caches. */
  cityAnnual?: CityAnnualPoint[];
}
