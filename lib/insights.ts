/**
 * Analytical insights engine.
 * Returns Hebrew sentence arrays — only for fields that actually exist.
 * No N/A, no broken lines, no fabricated data.
 */

import { prisma } from "./db";
import { computeCityGap, describeSupplySource } from "./gap-analysis";
import { cachedReference } from "./cache";
import { nationalPersonsPerDwelling, dwellingsFor, dwellingRank } from "./dwellings";

export interface CityInsights {
  priceChange: string | null;
  supplyBalance: string | null;
  inventoryClearance: string | null;
  peoplePerApartment: string | null;
  buildingPermitsTrend: string | null;
  populationTrend: string | null;
}

async function getNationalAveragesUncached() {
  const cities = await prisma.city.findMany({
    select: {
      price_change_pct: true,
      people_per_apartment: true,
      golden_multiplier: true,
    },
  });

  const validPriceChange = cities
    .map((c) => c.price_change_pct)
    .filter((v): v is number => v !== null);
  const validPpa = cities
    .map((c) => c.people_per_apartment)
    .filter((v): v is number => v !== null);

  return {
    avg_price_change_pct:
      validPriceChange.length > 0
        ? validPriceChange.reduce((a, b) => a + b, 0) / validPriceChange.length
        : null,
    avg_people_per_apartment:
      validPpa.length > 0
        ? validPpa.reduce((a, b) => a + b, 0) / validPpa.length
        : null,
  };
}

/**
 * Scans the whole cities table to produce two numbers. It is called from
 * getCityInsights, i.e. once per city-page render — a full-table scan on a page
 * that renders per visitor. The result is identical for every city, so it is
 * cached rather than recomputed ~170 different ways.
 */
export const getNationalAverages = cachedReference(getNationalAveragesUncached, ["national-averages"]);

// (the pct() formatter left with the legacy Excel price insight — live
// numbers format inline where they are built)

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

export async function getCityInsights(cityName: string): Promise<CityInsights> {
  const city = await prisma.city.findUnique({
    where: { city_name: cityName },
    include: {
      sales: true,
      building_permits: { orderBy: { year: "asc" } },
    },
  });

  if (!city) {
    return {
      priceChange: null,
      supplyBalance: null,
      inventoryClearance: null,
      peoplePerApartment: null,
      buildingPermitsTrend: null,
      populationTrend: null,
    };
  }

  const nationals = await getNationalAverages();

  // ── Price change insight ──────────────────────────────────────────────────
  // LIVE numbers from the shared price-change engine — not the legacy Excel
  // column (price_change_pct) whose hardcoded "בין 2023 ל-2026" label drifted
  // from whatever window the number actually described. Thin windows (single
  // quarter endpoints, slid start) produce no insight rather than a shaky one.
  let priceChange: string | null = null;
  try {
    const { loadCityPriceChanges } = await import("./price-changes");
    const pc = await loadCityPriceChanges(cityName);
    const w = pc?.change3y ?? pc?.change5y ?? null;
    if (w && !w.thin) {
      const dir = w.pct >= 0 ? "עלה" : "ירד";
      priceChange = `המחיר החציוני לדירה ${dir} ב-${Math.abs(w.pct).toFixed(1)}% בין ${w.fromY} ל-${w.toY} (נדל"ן גוב)`;
    }
  } catch { /* price trends absent — no insight beats a wrong one */ }

  // ── Supply balance (new ladder: completions → starts → permits) ──────────
  // Replaces the legacy golden_multiplier which used construction_4y_gross
  // from the old Excel (a mixed measure) and only existed for ~36 cities.
  let supplyBalance: string | null = null;
  try {
    const gap = await computeCityGap(cityName, { windowStart: 2020, windowEnd: 2024 });
    if (gap && gap.totals.demand !== null && gap.totals.chosenSupply !== null && gap.totals.demand !== 0) {
      const srcHe = describeSupplySource(gap.totals.chosenSource).he;
      const demandAbs = Math.abs(gap.totals.demand);
      const coveragePct = (gap.totals.chosenSupply / demandAbs) * 100;
      const direction = gap.totals.gap! > 0 ? "עודף היצע" : "גרעון היצע";
      supplyBalance = `${srcHe} כיסו ${coveragePct.toFixed(0)}% מהביקוש בחלון ${gap.windowStart}-${gap.windowEnd} — ${direction} של ${Math.abs(gap.totals.gap!).toLocaleString("he-IL")} דירות`;
    } else if (city.golden_multiplier !== null && city.golden_pct !== null) {
      // legacy fallback (only ~36 cities had this from the old Excel)
      const mult = round2(city.golden_multiplier);
      const pctVal = city.golden_pct.toFixed(1);
      const direction = city.golden_pct > 0 ? "עודף היצע" : "גרעון היצע";
      supplyBalance = `ההיצע מכסה ${pctVal}% מהביקוש (מכפיל הזהב = ${mult}) — ${direction}`;
    }
  } catch {
    // Defensive: don't break the page if the gap module fails for any reason
    supplyBalance = null;
  }

  // ── Inventory clearance ──────────────────────────────────────────────────
  let inventoryClearance: string | null = null;
  if (city.sales?.years_to_clear_avg !== null && city.sales?.years_to_clear_avg !== undefined) {
    const years = round2(city.sales.years_to_clear_avg);
    inventoryClearance = `במלאי הנוכחי ובקצב מכירה ממוצע, ייקח ${years} שנים למכור את כל הדירות`;
  }

  // ── Persons per dwelling ─────────────────────────────────────────────────
  //
  // The national benchmark is the PUBLISHED ratio (total population ÷ total
  // dwellings), not the mean of the per-city ratios this file used to compute.
  // That average weighs Beitar Illit and Tel Aviv equally and therefore
  // described our own table rather than the country — and it moved whenever a
  // city gained or lost a value, which is not something a national average is
  // allowed to do.
  let peoplePerApartment: string | null = null;
  const dw = dwellingsFor(cityName);
  const ppaValue = dw?.ratio ?? city.people_per_apartment;
  if (ppaValue != null) {
    const ppa = round2(ppaValue);
    const natPpa = nationalPersonsPerDwelling() ?? nationals.avg_people_per_apartment;
    if (natPpa != null) {
      const comparison = ppaValue > natPpa ? "מעל" : "מתחת";
      const rank = dwellingRank(cityName);
      peoplePerApartment =
        `נפשות לדירה: ${ppa} — ${comparison} לממוצע הארצי ${round2(natPpa)}` +
        (rank ? ` (מקום ${rank.rank} מתוך ${rank.of} הערים הגדולות)` : "");
    } else {
      peoplePerApartment = `נפשות לדירה: ${ppa}`;
    }
  }

  // ── Building permits trend (CBS data) ────────────────────────────────────
  let buildingPermitsTrend: string | null = null;
  if (city.building_permits && city.building_permits.length >= 2) {
    const permits = city.building_permits;
    const first = permits[0];
    const last = permits[permits.length - 1];
    if (first.permits !== null && last.permits !== null && first.year !== last.year) {
      const change = last.permits - first.permits;
      const direction = change >= 0 ? "עלייה" : "ירידה";
      buildingPermitsTrend = `היתרי בנייה: ${direction} מ-${first.permits.toLocaleString("he-IL")} (${first.year}) ל-${last.permits.toLocaleString("he-IL")} (${last.year})`;
    }
  }

  // ── Population trend (using population_2024 as latest actual) ────────────
  let populationTrend: string | null = null;
  const pop2024 = city.population_2024;
  const pop2022 = city.population_2022;
  if (pop2024 !== null && pop2022 !== null && pop2022 > 0) {
    const growthPct = ((pop2024 - pop2022) / pop2022) * 100;
    const direction = growthPct >= 0 ? "עלייה" : "ירידה";
    populationTrend = `אוכלוסייה: ${direction} של ${Math.abs(growthPct).toFixed(1)}% בין 2022 ל-2024 (${pop2022.toLocaleString("he-IL")} → ${pop2024.toLocaleString("he-IL")})`;
  }

  return {
    priceChange,
    supplyBalance,
    inventoryClearance,
    peoplePerApartment,
    buildingPermitsTrend,
    populationTrend,
  };
}
