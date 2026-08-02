/**
 * The single place the site's methodology numbers are documented FROM CODE.
 * SECONDHAND_MIN_AGE is imported from the real aggregation lib; the collector
 * sanity bounds are mirrored here (scripts/collect-*.ts hold the same values —
 * change BOTH together).
 */
export { SECONDHAND_MIN_AGE } from "./nadlanDealsAggregate";

/** Sanity bounds applied at collection time (mirrors scripts/collect-*.ts). */
export const SANITY = {
  MIN_AREA: 20,      // m² — below this it's a storeroom/parking, not a home
  MAX_AREA: 500,     // m²
  MIN_SQM: 2_000,    // ₪/m² — below this it's land/error
  MAX_SQM: 200_000,  // ₪/m²
} as const;

/** A year-cell must have at least this many deals to be priced anywhere. */
export const MIN_N_PER_YEAR = 10;

/** Ranking normalization: a city needs 10+ deals of EVERY type to be ranked. */
export const RANKING_MIN_PER_SCOPE = 10;

export const RESIDENTIAL_TYPES = [
  "דירה", "דירת גן", "דירת גג", "פנטהאוז", "קוטג'", "בית בודד", "דו משפחתי", "מיני פנטהאוז",
] as const;
