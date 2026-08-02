import { getRuleNum } from "./systemRules";

/**
 * THE reference year. One definition, for the whole site.
 *
 * WHAT THIS REPLACES
 * There were three, and they were drifting apart:
 *   - lib/investorMetrics.ts   `export const REF_YEAR = 2025`      (hardcoded)
 *   - lib/cityChangeMetrics.ts `export const SH_REF_YEAR = 2025`   (hardcoded)
 *   - the `ref_year` rule in the admin dashboard, which had exactly ONE reader
 *     (lib/cityTransactionPrices.ts) and even that read it at module load.
 *
 * The rule is the only one an operator can actually change, so bumping it moved
 * the price figures and left the investor and second-hand figures a year behind.
 * On the same /cities page that puts a price column labelled one year next to
 * appreciation columns computed against another — a one-year return measured
 * from the wrong base. Nothing throws; the numbers are just quietly inconsistent.
 *
 * And if nobody bumps it, all three simply go stale together, which is the
 * failure the operator is least likely to notice.
 *
 * Now every consumer calls refYear(), the dashboard rule drives all of them, and
 * they cannot disagree.
 *
 * WHY A FUNCTION AND NOT A CONST: a module-level const would capture the value
 * once per process, so a rule change would reach the pipeline scripts (fresh
 * processes) but never the long-running server. Called inside a function this
 * hits the 5-second rule cache, so the cost is negligible.
 */
export function refYear(): number {
  return getRuleNum("ref_year");
}

/**
 * The reference year and the one before it — the standard "compare to last
 * year" pair, and the fallback order for cities whose collection lags.
 */
export function refYearPair(): [number, number] {
  const y = refYear();
  return [y, y - 1];
}
