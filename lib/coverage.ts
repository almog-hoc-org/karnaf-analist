import type { CityGraphData } from "./nadlanTransactionSeries";

/**
 * How much of a city's decade we can actually show, and how loudly to say so.
 *
 * WHY THIS EXISTS
 * A coverage audit found 53 of 165 localities holding almost no transactions —
 * Kuseife with 1 deal across ten years against 21,849 residents, Bu'eine
 * Nujeidat with 1 against 10,630 — while the national median is 50.9 deals per
 * 1,000 people. Every one of them is an Arab locality.
 *
 * The cause is upstream and still open. Measured against the source: the
 * authority's index reports deals in those polygons, and its own detail
 * endpoint returns none for them — 27 polygons sampled across three such towns,
 * 27 empty, HTTP 200 and no error. The same request shape returns 1,500 deals
 * for Haifa. It is not our filters and not the request; it is something about
 * how those places are represented at the source.
 *
 * That investigation continues. This does not wait for it, because the
 * obligation does not depend on the answer: a page drawing a confident price
 * trend through 21 transactions is misleading whether the cause is a bug, a
 * privacy rule, or a gap in the national dataset. Saying so is owed to the
 * reader now.
 *
 * DERIVED, NEVER A LIST. Every judgement here comes from the series the page
 * already loaded. No city is named in code. When coverage improves the notice
 * weakens and then disappears on its own — and if it degrades, it returns
 * without anyone remembering to add it back.
 */

/** The decade every rule, chart and aggregation in this project assumes. */
export const COVERAGE_FROM = 2016;
export const COVERAGE_TO = 2025;
const SPAN = COVERAGE_TO - COVERAGE_FROM + 1;

export type CoverageLevel = "ok" | "partial" | "thin" | "sparse" | "none";

export interface Coverage {
  level: CoverageLevel;
  /** years in the decade with enough second-hand deals to plot a point */
  coveredYears: number;
  span: number;
  /** deals behind the headline series, however thin */
  totalDeals: number;
  firstYear: number | null;
  lastYear: number | null;
}

/**
 * @param minN the live min_deals_per_year rule — the same bar the charts use.
 *             Passed in rather than read here so this stays a pure function and
 *             can be unit-tested without a database.
 */
export function assessCoverage(data: CityGraphData, minN: number): Coverage {
  const sh = data.nadlan.secondhand?.all ?? [];
  const inWindow = (p: { year: number }) => p.year >= COVERAGE_FROM && p.year <= COVERAGE_TO;

  const coveredYears = sh.filter((p) => inWindow(p) && p.n >= minN).length;

  // Cities whose nadlan coverage is too thin use a govmap-only headline series,
  // so counting only the nadlan scope would report zero deals for a city that
  // visibly has a chart. Take whichever series carries the city's own headline.
  const allScope = (data.nadlan.all_govmap?.all?.length ? data.nadlan.all_govmap.all : data.nadlan.all?.all) ?? [];
  const pool = allScope.length ? allScope : sh;
  const points = pool.filter(inWindow);
  const totalDeals = points.reduce((s, p) => s + (p.n ?? 0), 0);
  const years = points.filter((p) => p.n > 0).map((p) => p.year).sort((a, b) => a - b);

  let level: CoverageLevel;
  if (totalDeals === 0) level = "none";
  else if (coveredYears === 0) level = "sparse";
  // One missing year is ordinary — the current year is partial by definition and
  // a single quiet year in a small town is not a data problem. Warning on that
  // would put a notice on most of the country and teach readers to ignore it.
  else if (coveredYears >= SPAN - 1) level = "ok";
  else if (coveredYears >= Math.ceil(SPAN / 2)) level = "partial";
  else level = "thin";

  return {
    level,
    coveredYears,
    span: SPAN,
    totalDeals,
    firstYear: years[0] ?? null,
    lastYear: years[years.length - 1] ?? null,
  };
}

/** Does this warrant interrupting the reader, or just a footnote? */
export function isProminent(c: Coverage): boolean {
  return c.level === "sparse" || c.level === "thin" || c.level === "none";
}
