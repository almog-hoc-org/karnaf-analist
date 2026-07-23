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

import { prisma } from "./db";

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

export async function computeCityGap(
  cityName: string,
  opts: GapOptions = {}
): Promise<GapAnalysis | null> {
  const windowStart = opts.windowStart ?? DEFAULT_WINDOW_START;
  const windowEnd = opts.windowEnd ?? DEFAULT_WINDOW_END;

  // Pull all the inputs in parallel
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
 * Compute gaps for every city in a single batch — used by rankings/coverage pages.
 */
export async function computeAllCityGaps(opts: GapOptions = {}): Promise<GapAnalysis[]> {
  const cities = await prisma.city.findMany({ select: { city_name: true } });
  const out: GapAnalysis[] = [];
  for (const c of cities) {
    const g = await computeCityGap(c.city_name, opts);
    if (g) out.push(g);
  }
  return out;
}

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
