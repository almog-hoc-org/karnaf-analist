/**
 * Multi-source population data loader.
 *
 * Returns per-(city, year) all known population estimates from every available
 * source, so the UI can show disagreement and let the consultant pick the best
 * one to defend to a client.
 */
import { prisma } from "./db";

export interface PopulationSource {
  source: string;
  /** Human-readable Hebrew name + description. */
  label: string;
  /** Sub-text shown under the label. */
  description: string;
  /** Display order — lower = higher priority. */
  rank: number;
  /** Tone for UI colouring. */
  tone: "blue" | "purple" | "emerald" | "amber" | "slate";
}

const SOURCE_META: Record<string, PopulationSource> = {
  census_2022: {
    source: "census_2022",
    label: "מפקד 2022",
    description: "ספירת אוכלוסין רשמית למ\"ס",
    rank: 1,
    tone: "blue",
  },
  cbs_registry_2025_update: {
    source: "cbs_registry_2025_update",
    label: "מרשם אוכלוסין למ\"ס (עדכון 2025)",
    description: "data.gov.il — קובץ יישובים מעודכן",
    rank: 2,
    tone: "blue",
  },
  cbs_permits_2024: {
    source: "cbs_permits_2024",
    label: "למ\"ס היתרי בנייה 2024",
    description: "אוכלוסייה בסיס בדוח היתרים",
    rank: 3,
    tone: "blue",
  },
  cbs_combined_2024: {
    source: "cbs_combined_2024",
    label: "קובץ למ\"ס משולב (2024)",
    description: "אגרגציה — שאיבה מ-data.gov.il + לוחות",
    rank: 4,
    tone: "blue",
  },
  cbs_combined_2026: {
    source: "cbs_combined_2026",
    label: "קובץ למ\"ס משולב (2026)",
    description: "תחזית/אגרגציה — שאיבה מ-data.gov.il",
    rank: 5,
    tone: "amber",
  },
  cbs_combined_2022: {
    source: "cbs_combined_2022",
    label: "קובץ למ\"ס משולב (2022)",
    description: "מקבצי שאיבה מקודמים",
    rank: 6,
    tone: "blue",
  },
  cbs_combined_2021: {
    source: "cbs_combined_2021",
    label: "קובץ למ\"ס משולב (2021)",
    description: "מקבצי שאיבה מקודמים",
    rank: 7,
    tone: "blue",
  },
  cbs_original: {
    source: "cbs_original",
    label: "למ\"ס קובץ מקור 2021",
    description: "פרסום למ\"ס יישובים 2021",
    rank: 8,
    tone: "blue",
  },
  cbs_projection_2026: {
    source: "cbs_projection_2026",
    label: "תחזית למ\"ס 2026",
    description: "תחזית דמוגרפית — לא נתון בפועל",
    rank: 9,
    tone: "amber",
  },
  "data.gov.il_registry_2019": {
    source: "data.gov.il_registry_2019",
    label: "מרשם אוכלוסין 2019 (data.gov.il)",
    description: "קובץ יישובים — נתוני בסיס היסטוריים",
    rank: 10,
    tone: "purple",
  },
  "data.gov.il_registry_2026": {
    source: "data.gov.il_registry_2026",
    label: "מרשם אוכלוסין 2026 (data.gov.il)",
    description: "קובץ יישובים — נתון/תחזית עדכניים",
    rank: 11,
    tone: "purple",
  },
  bituach_leumi: {
    source: "bituach_leumi",
    label: "ביטוח לאומי",
    description: "נתוני אוכלוסייה יישוביים — המוסד לביטוח לאומי",
    rank: 2,
    tone: "emerald",
  },
  cbs_update_apr2026: {
    source: "cbs_update_apr2026",
    label: "עדכון למ\"ס אפריל 2026",
    description: "פרסום למ\"ס המעודכן ביותר",
    rank: 1,
    tone: "emerald",
  },
};

/**
 * Sources EXCLUDED from population estimation per user directive: the internal
 * research Excel is no longer trusted for population — only CBS (למ"ס),
 * data.gov.il, and National Insurance (ביטוח לאומי) + journalistic sources.
 */
const EXCLUDED_POPULATION_SOURCES = new Set<string>(["legacy_excel"]);

export function getSourceMeta(source: string): PopulationSource {
  return SOURCE_META[source] ?? {
    source,
    label: source,
    description: "מקור לא מתויג",
    rank: 99,
    tone: "slate",
  };
}

export interface YearEstimate {
  source: string;
  population: number;
  meta: PopulationSource;
}

export interface PopulationByYearAndSource {
  year: number;
  estimates: YearEstimate[];
  /** All values are equal */
  uniform: boolean;
  /** Min/max if disagreement */
  min: number;
  max: number;
  /** Best single value to use (highest-ranked source). */
  bestPick: { value: number; source: string };
  /** Spread = (max - min) / min * 100. NaN if uniform. */
  spreadPct: number;
}

/**
 * Load all population estimates for one city, grouped by year.
 * Years sorted ascending. Within each year, estimates sorted by source rank.
 */
export async function loadCityPopulationEstimates(cityName: string): Promise<PopulationByYearAndSource[]> {
  const rows = await prisma.population_estimates.findMany({
    where: { city_name: cityName },
    orderBy: [{ year: "asc" }, { source: "asc" }],
  });

  const byYear = new Map<number, YearEstimate[]>();
  for (const r of rows) {
    if (EXCLUDED_POPULATION_SOURCES.has(r.source)) continue; // drop internal research Excel
    const arr = byYear.get(r.year) ?? [];
    arr.push({ source: r.source, population: r.population, meta: getSourceMeta(r.source) });
    byYear.set(r.year, arr);
  }

  const result: PopulationByYearAndSource[] = [];
  for (const [year, estimates] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    // Sort by source rank
    estimates.sort((a, b) => a.meta.rank - b.meta.rank);
    const values = estimates.map((e) => e.population);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const uniform = min === max;
    const spreadPct = uniform ? 0 : ((max - min) / min) * 100;
    const bestPick = { value: estimates[0].population, source: estimates[0].source };
    result.push({ year, estimates, uniform, min, max, bestPick, spreadPct });
  }
  return result;
}
