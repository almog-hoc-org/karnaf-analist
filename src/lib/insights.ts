/**
 * Analytical insights engine.
 * Returns Hebrew sentence arrays — only for fields that actually exist.
 * No N/A, no broken lines, no fabricated data.
 */

import { prisma } from "./db";

export interface CityInsights {
  priceChange: string | null;
  supplyBalance: string | null;
  inventoryClearance: string | null;
  peoplePerApartment: string | null;
  buildingPermitsTrend: string | null;
}

export async function getNationalAverages() {
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

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

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
    };
  }

  const nationals = await getNationalAverages();

  // ── Price change insight ──────────────────────────────────────────────────
  let priceChange: string | null = null;
  if (city.price_change_pct !== null) {
    const cityPct = pct(city.price_change_pct);
    if (nationals.avg_price_change_pct !== null) {
      const natPct = pct(nationals.avg_price_change_pct);
      priceChange = `המחיר למ"ר עלה ב-${cityPct} בין 2023 ל-2026, לעומת ממוצע ארצי של ${natPct}`;
    } else {
      priceChange = `המחיר למ"ר עלה ב-${cityPct} בין 2023 ל-2026`;
    }
  }

  // ── Supply balance (golden multiplier) ───────────────────────────────────
  let supplyBalance: string | null = null;
  if (city.golden_multiplier !== null && city.golden_pct !== null) {
    const mult = round2(city.golden_multiplier);
    const pctVal = city.golden_pct.toFixed(1);
    const direction = city.golden_pct > 0 ? "עודף היצע" : "גרעון היצע";
    supplyBalance = `ההיצע מכסה ${pctVal}% מהביקוש (מכפיל הזהב = ${mult}) — ${direction}`;
  }

  // ── Inventory clearance ──────────────────────────────────────────────────
  let inventoryClearance: string | null = null;
  if (city.sales?.years_to_clear_avg !== null && city.sales?.years_to_clear_avg !== undefined) {
    const years = round2(city.sales.years_to_clear_avg);
    inventoryClearance = `במלאי הנוכחי ובקצב מכירה ממוצע, ייקח ${years} שנים למכור את כל הדירות`;
  }

  // ── People per apartment ─────────────────────────────────────────────────
  let peoplePerApartment: string | null = null;
  if (city.people_per_apartment !== null) {
    const ppa = round2(city.people_per_apartment);
    if (nationals.avg_people_per_apartment !== null) {
      const natPpa = round2(nationals.avg_people_per_apartment);
      const comparison =
        city.people_per_apartment > nationals.avg_people_per_apartment
          ? "מעל"
          : "מתחת";
      peoplePerApartment = `נפשות לדירה: ${ppa} — ${comparison} לממוצע הארצי ${natPpa}`;
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

  return {
    priceChange,
    supplyBalance,
    inventoryClearance,
    peoplePerApartment,
    buildingPermitsTrend,
  };
}
