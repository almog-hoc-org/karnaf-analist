/**
 * Supply/Demand Gap Analysis
 * ==========================
 *
 * Demand   = (population growth over window)  ÷  (avg persons per household)
 * Supply   = sum of new dwellings over the SAME window
 *             ── chosen via fallback ladder: completions → starts → permits
 * Gap      = supply − demand
 *             (positive → oversupply, negative → undersupply)
 *
 * Why a ladder:
 *   - Completions are the most faithful supply signal (real dwellings delivered)
 *   - Starts are the next best (in-pipeline, ~2-3y away from delivery)
 *   - Permits are the weakest (some never break ground)
 *
 * We expose `supplySource` so the UI can show which rung of the ladder fed the gap.
 *
 * This module is read-only — it queries Prisma directly and never mutates state.
 */

import { cache } from "react";
import { prisma } from "./db";
import { cachedMarket } from "./cache";

export type SupplySource = "completions" | "starts" | "permits" | "none";

export interface GapWindowYear {
  year: number;
  pop?: number | null;
  popGrowth: number | null;      // pop[year] - pop[year-1]
  demand: number | null;         // popGrowth / persons_per_household
  permits: number | null;
  starts: number | null;         // construction_starts + cbs_press_data starts (max of the two — they're rival sources for the same year)
  completions: number | null;
  // The chosen supply for this year per the ladder (the value that goes into gap):
  chosenSupply: number | null;
  chosenSource: SupplySource;
  gap: number | null;
}

export interface GapAnalysis {
  cityName: string;
  windowStart: number;
  windowEnd: number;                  // inclusive
  personsPerHousehold: number;
  personsPerHouseholdSource: "yad2" | "census2022" | "national_default";
  rows: GapWindowYear[];
  totals: {
    popGrowth: number | null;
    demand: number | null;
    permits: number | null;
    starts: number | null;
    completions: number | null;
    chosenSupply: number | null;
    chosenSource: SupplySource;          // dominant source across the window
    gap: number | null;
    gapPctOfDemand: number | null;       // gap / demand × 100
  };
  coverage: {
    yearsInWindow: number;
    yearsWithPermits: number;
    yearsWithStarts: number;
    yearsWithCompletions: number;
  };
}

const NATIONAL_DEFAULT_PERSONS_PER_HH = 3.27; // CBS national avg (2024)
const DEFAULT_WINDOW_START = 2020;
const DEFAULT_WINDOW_END = 2024;   // permits go through 2024, starts/completions through 2025

export interface GapOptions {
  windowStart?: number;
  windowEnd?: number;
}

function pickPersonsPerHousehold(
  yad2HhSize: number | null | undefined,
  censusHhSize: number | null | undefined
): { value: number; source: GapAnalysis["personsPerHouseholdSource"] } {
  // Research-Excel fallback (legacy_ppa / city.people_per_apartment) removed per
  // user directive — only journalistic (yad2) + CBS census + national default.
  if (yad2HhSize && yad2HhSize > 0) return { value: yad2HhSize, source: "yad2" };
  if (censusHhSize && censusHhSize > 0) return { value: censusHhSize, source: "census2022" };
  return { value: NATIONAL_DEFAULT_PERSONS_PER_HH, source: "national_default" };
}

/**
 * Apply the fallback ladder for a single year.
 * Returns the chosen value and which source provided it.
 */
function chooseSupply(
  permits: number | null,
  starts: number | null,
  completions: number | null
): { value: number | null; source: SupplySource } {
  if (completions !== null && completions > 0) return { value: completions, source: "completions" };
  if (starts !== null && starts > 0)           return { value: starts, source: "starts" };
  if (permits !== null && permits > 0)         return { value: permits, source: "permits" };
  return { value: null, source: "none" };
}

/**
 * Aggregate the dominant supply source over the window.
 * Priority: completions if it covered the most years, else starts, else permits.
 */
function dominantSource(rows: GapWindowYear[]): SupplySource {
  const counts: Record<SupplySource, number> = { completions: 0, starts: 0, permits: 0, none: 0 };
  for (const r of rows) counts[r.chosenSource]++;
  // Prefer completions > starts > permits when tied
  const order: SupplySource[] = ["completions", "starts", "permits", "none"];
  let best: SupplySource = "none";
  let bestCount = -1;
  for (const s of order) {
    if (counts[s] > bestCount) {
      best = s;
      bestCount = counts[s];
    }
  }
  return best;
}

/**
 * REQUEST-SCOPED DEDUPE. The city page called this once directly and once more
 * inside getCityInsights, with the same window — 12 queries where 6 would do,
 * on the site's busiest page. React's cache() collapses identical calls within
 * a single render pass.
 *
 * The key must be PRIMITIVES: cache() compares arguments by identity, and two
 * `{ windowStart: 2020, windowEnd: 2024 }` literals are different objects, so
 * passing the options object straight through would dedupe nothing. Hence the
 * inner function takes two numbers and the public wrapper unpacks.
 */
const computeCityGapCached = cache(
  async (cityName: string, windowStart: number, windowEnd: number): Promise<GapAnalysis | null> =>
    computeCityGapUncached(cityName, windowStart, windowEnd)
);

export async function computeCityGap(
  cityName: string,
  opts: GapOptions = {}
): Promise<GapAnalysis | null> {
  return computeCityGapCached(
    cityName,
    opts.windowStart ?? DEFAULT_WINDOW_START,
    opts.windowEnd ?? DEFAULT_WINDOW_END
  );
}

/**
 * The six per-city inputs the gap math needs. When a caller has already loaded
 * them for every city (see loadGapInputsForAllCities), it passes them in and
 * the function issues no queries at all — same arithmetic, same result.
 */
interface GapInputs {
  city: { avgHouseholdSize2022: number | null; people_per_apartment: number | null; population_growth_abs: number | null; apartments_required: number | null } | null;
  yad2: { avg_household_size: number | null } | null;
  popRows: Array<{ year: number; population: number | null }>;
  permits: Array<{ year: number; permits: number | null }>;
  startsRows: Array<{ year: number; starts: number | null }>;
  pressRows: Array<{ year: number; construction_starts: number | null; construction_completions: number | null }>;
}

async function computeCityGapUncached(
  cityName: string,
  windowStart: number,
  windowEnd: number,
  preloaded?: GapInputs
): Promise<GapAnalysis | null> {

  // Pull all the inputs in parallel — unless the caller already has them.
  const { city, yad2, popRows, permits, startsRows, pressRows } = preloaded ?? await (async () => {
    const [city, yad2, popRows, permits, startsRows, pressRows] = await Promise.all([
      prisma.city.findUnique({
        where: { city_name: cityName },
        select: {
          avgHouseholdSize2022: true,
          people_per_apartment: true,
          population_growth_abs: true,
          apartments_required: true,
        },
      }),
      prisma.yad2_market_data.findUnique({
        where: { city_name: cityName },
        select: { avg_household_size: true },
      }),
      prisma.population_by_year.findMany({
        where: { city_name: cityName, year: { gte: windowStart - 1, lte: windowEnd } },
        orderBy: { year: "asc" },
      }),
      prisma.buildingPermit.findMany({
        where: { city_name: cityName, year: { gte: windowStart, lte: windowEnd } },
      }),
      prisma.construction_starts.findMany({
        where: { city_name: cityName, year: { gte: windowStart, lte: windowEnd } },
      }),
      prisma.cbsPressData.findMany({
        where: { city_name: cityName, year: { gte: windowStart, lte: windowEnd } },
      }),
    ]);
    return { city, yad2, popRows, permits, startsRows, pressRows } as GapInputs;
  })();

  if (!city) return null;

  const ppa = pickPersonsPerHousehold(yad2?.avg_household_size, city.avgHouseholdSize2022);

  // Build lookup maps for each supply source
  const permitsBy = new Map<number, number>();
  for (const p of permits) if (p.permits !== null) permitsBy.set(p.year, p.permits);

  // Starts: union of construction_starts table + cbs_press_data quarterly aggregated
  const startsByYear = new Map<number, number>();
  for (const s of startsRows) if (s.starts !== null) startsByYear.set(s.year, s.starts);

  // CBS press data is quarterly; sum to annual
  const pressStartsByYear = new Map<number, number>();
  const completionsByYear = new Map<number, number>();
  for (const r of pressRows) {
    if (r.construction_starts !== null && r.construction_starts !== undefined) {
      pressStartsByYear.set(r.year, (pressStartsByYear.get(r.year) ?? 0) + r.construction_starts);
    }
    if (r.construction_completions !== null && r.construction_completions !== undefined) {
      completionsByYear.set(r.year, (completionsByYear.get(r.year) ?? 0) + r.construction_completions);
    }
  }
  // Merge starts sources — take whichever is larger (typically the press one is more complete)
  for (const [yr, v] of pressStartsByYear) {
    const cur = startsByYear.get(yr);
    if (cur === undefined || v > cur) startsByYear.set(yr, v);
  }

  // Population growth by year — derived from population_by_year
  const popMap = new Map<number, number>();
  for (const p of popRows) if (p.population !== null) popMap.set(p.year, p.population);

  // Build per-year rows
  const rows: GapWindowYear[] = [];
  let totalPopGrowth: number | null = null;
  let totalPermits = 0;
  let totalStarts = 0;
  let totalCompletions = 0;
  let totalChosenSupply = 0;
  let totalDemand = 0;
  let anyDemandKnown = false;
  let yearsWithPermits = 0;
  let yearsWithStarts = 0;
  let yearsWithCompletions = 0;

  for (let yr = windowStart; yr <= windowEnd; yr++) {
    const pop = popMap.get(yr) ?? null;
    const popPrev = popMap.get(yr - 1) ?? null;
    const popGrowth = pop !== null && popPrev !== null ? pop - popPrev : null;
    const demand = popGrowth !== null ? Math.round(popGrowth / ppa.value) : null;

    const yrPermits = permitsBy.get(yr) ?? null;
    const yrStarts = startsByYear.get(yr) ?? null;
    const yrComp = completionsByYear.get(yr) ?? null;

    const chosen = chooseSupply(yrPermits, yrStarts, yrComp);
    const gap = demand !== null && chosen.value !== null ? chosen.value - demand : null;

    if (yrPermits !== null) { totalPermits += yrPermits; yearsWithPermits++; }
    if (yrStarts !== null) { totalStarts += yrStarts; yearsWithStarts++; }
    if (yrComp !== null) { totalCompletions += yrComp; yearsWithCompletions++; }
    if (chosen.value !== null) totalChosenSupply += chosen.value;
    if (demand !== null) { totalDemand += demand; anyDemandKnown = true; }
    if (popGrowth !== null) totalPopGrowth = (totalPopGrowth ?? 0) + popGrowth;

    rows.push({
      year: yr,
      pop,
      popGrowth,
      demand,
      permits: yrPermits,
      starts: yrStarts,
      completions: yrComp,
      chosenSupply: chosen.value,
      chosenSource: chosen.source,
      gap,
    });
  }

  // Fallback: if no population_by_year coverage in the window, use the legacy
  // population_growth_abs from the cities row — assume it represents the same window.
  let demandTotalFinal: number | null = anyDemandKnown ? totalDemand : null;
  let popGrowthFinal: number | null = totalPopGrowth;
  if (!anyDemandKnown && city.population_growth_abs !== null) {
    popGrowthFinal = city.population_growth_abs;
    demandTotalFinal = Math.round(city.population_growth_abs / ppa.value);
  }

  const dom = dominantSource(rows);

  // Compute final chosen supply over the window. If per-year ladder produced
  // nothing, fall back to summing whichever annual series we have at the
  // window level (matching the same ladder).
  let chosenSupplyFinal: number | null = totalChosenSupply > 0 ? totalChosenSupply : null;
  let chosenSourceFinal: SupplySource = dom;
  if (chosenSupplyFinal === null) {
    if (totalCompletions > 0) { chosenSupplyFinal = totalCompletions; chosenSourceFinal = "completions"; }
    else if (totalStarts > 0) { chosenSupplyFinal = totalStarts; chosenSourceFinal = "starts"; }
    else if (totalPermits > 0) { chosenSupplyFinal = totalPermits; chosenSourceFinal = "permits"; }
  }

  const gapFinal = demandTotalFinal !== null && chosenSupplyFinal !== null ? chosenSupplyFinal - demandTotalFinal : null;
  const gapPctFinal = gapFinal !== null && demandTotalFinal !== null && demandTotalFinal !== 0
    ? (gapFinal / Math.abs(demandTotalFinal)) * 100
    : null;

  return {
    cityName,
    windowStart,
    windowEnd,
    personsPerHousehold: ppa.value,
    personsPerHouseholdSource: ppa.source,
    rows,
    totals: {
      popGrowth: popGrowthFinal,
      demand: demandTotalFinal,
      permits: totalPermits > 0 ? totalPermits : null,
      starts: totalStarts > 0 ? totalStarts : null,
      completions: totalCompletions > 0 ? totalCompletions : null,
      chosenSupply: chosenSupplyFinal,
      chosenSource: chosenSourceFinal,
      gap: gapFinal,
      gapPctOfDemand: gapPctFinal,
    },
    coverage: {
      yearsInWindow: windowEnd - windowStart + 1,
      yearsWithPermits,
      yearsWithStarts,
      yearsWithCompletions,
    },
  };
}

/**
 * Every input the gap math needs, for every city, in SIX queries.
 *
 * This replaces ~170 × 6 = ~1,020 serial round-trips. better-sqlite3 is
 * synchronous, so those could never overlap — they were 1,020 blocking calls
 * on the one connection that also serves page renders, paid on the first
 * request after every deploy and every cache invalidation.
 */
async function loadGapInputsForAllCities(
  windowStart: number,
  windowEnd: number
): Promise<Map<string, GapInputs>> {
  const [cities, yad2Rows, popRows, permitRows, startRows, pressRows] = await Promise.all([
    prisma.city.findMany({
      select: {
        city_name: true,
        avgHouseholdSize2022: true,
        people_per_apartment: true,
        population_growth_abs: true,
        apartments_required: true,
      },
    }),
    prisma.yad2_market_data.findMany({ select: { city_name: true, avg_household_size: true } }),
    prisma.population_by_year.findMany({
      where: { year: { gte: windowStart - 1, lte: windowEnd } },
      orderBy: { year: "asc" },
    }),
    prisma.buildingPermit.findMany({ where: { year: { gte: windowStart, lte: windowEnd } } }),
    prisma.construction_starts.findMany({ where: { year: { gte: windowStart, lte: windowEnd } } }),
    prisma.cbsPressData.findMany({ where: { year: { gte: windowStart, lte: windowEnd } } }),
  ]);

  const out = new Map<string, GapInputs>();
  for (const c of cities) {
    out.set(c.city_name, {
      city: {
        avgHouseholdSize2022: c.avgHouseholdSize2022,
        people_per_apartment: c.people_per_apartment,
        population_growth_abs: c.population_growth_abs,
        apartments_required: c.apartments_required,
      },
      yad2: null, popRows: [], permits: [], startsRows: [], pressRows: [],
    });
  }
  // Bucket each row list onto its city. Rows for cities absent from `cities`
  // are dropped, exactly as the per-city version did (it returned null there).
  for (const r of yad2Rows) { const g = out.get(r.city_name); if (g) g.yad2 = { avg_household_size: r.avg_household_size }; }
  for (const r of popRows) { const g = out.get(r.city_name); if (g) g.popRows.push(r); }
  for (const r of permitRows) { const g = out.get(r.city_name); if (g) g.permits.push(r); }
  for (const r of startRows) { const g = out.get(r.city_name); if (g) g.startsRows.push(r); }
  for (const r of pressRows) { const g = out.get(r.city_name); if (g) g.pressRows.push(r); }
  return out;
}

async function computeAllCityGapsUncached(opts: GapOptions = {}): Promise<GapAnalysis[]> {
  const windowStart = opts.windowStart ?? DEFAULT_WINDOW_START;
  const windowEnd = opts.windowEnd ?? DEFAULT_WINDOW_END;
  const inputs = await loadGapInputsForAllCities(windowStart, windowEnd);

  const out: GapAnalysis[] = [];
  for (const [cityName, preloaded] of inputs) {
    const g = await computeCityGapUncached(cityName, windowStart, windowEnd, preloaded);
    if (g) out.push(g);
  }
  return out;
}

/**
 * Gaps for every city. Used by /stats/supply-coverage and the rankings pages.
 *
 * Two layers, and both are needed:
 *
 *   1. SIX queries instead of ~1,020. It used to loop the cities and call the
 *      per-city function, which issued 6 queries each — awaited one at a time,
 *      on a synchronous driver, on the same connection that renders pages.
 *      Concurrency would not have helped (nothing to overlap); fetching the
 *      whole window once and bucketing in memory does.
 *   2. The cache below, because the answer is identical for every visitor and
 *      changes only when the pipeline runs.
 *
 * The arithmetic is untouched — computeCityGapUncached does the same work on
 * the same inputs, it just receives them instead of fetching them.
 */
export const computeAllCityGaps = cachedMarket(computeAllCityGapsUncached, ["all-city-gaps"]);

export function describeSupplySource(s: SupplySource): { he: string; cls: string; long: string } {
  if (s === "completions") return {
    he: "גמר בנייה",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
    long: "ההיצע חושב מסיומי בנייה (מקור איכותי ביותר)",
  };
  if (s === "starts") return {
    he: "התחלות בנייה",
    cls: "bg-amber-50 text-amber-700 border-amber-200",
    long: "ההיצע חושב מהתחלות בנייה (גמר חסר → נופלים להתחלות)",
  };
  if (s === "permits") return {
    he: "היתרי בנייה",
    cls: "bg-rose-50 text-rose-700 border-rose-200",
    long: "ההיצע חושב מהיתרי בנייה (גמר והתחלות חסרים → נופלים להיתרים)",
  };
  return { he: "אין נתונים", cls: "bg-slate-50 text-slate-500 border-slate-200", long: "אין נתוני היצע זמינים" };
}
