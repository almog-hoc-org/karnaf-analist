/**
 * Per-city classification rate — the evidence behind the new/second-hand split.
 *
 * Written by the aggregation (scripts/aggregate-nadlan-transactions.ts) in the
 * same transaction as the stats table. Before this existed, the per-city rate
 * lived only in a CLI report nobody's page could read, so every screen showed
 * the split at full confidence even in cities where 12% of deals carry a
 * class. Missing table (pre-first-run) degrades to null — callers must treat
 * null as "unknown", which gradeClassification maps to hidden.
 */
import { prisma } from "./db";
import { cachedMap } from "./cache";

export interface CityClassificationRate {
  nadlanN: number;
  classifiedN: number;
  rate: number;
}

async function loadClassificationRatesUncached(): Promise<Map<string, CityClassificationRate>> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ city_name: string; nadlan_n: bigint; classified_n: bigint; rate: number }>>(
      "SELECT city_name, nadlan_n, classified_n, rate FROM city_classification_rate"
    );
    return new Map(rows.map((r) => [r.city_name, {
      nadlanN: Number(r.nadlan_n),
      classifiedN: Number(r.classified_n),
      rate: Number(r.rate),
    }]));
  } catch {
    // table not created yet (aggregation hasn't run since this shipped)
    return new Map();
  }
}

export const loadClassificationRates = cachedMap(loadClassificationRatesUncached, ["city-classification-rates"]);

export async function cityClassificationRate(cityName: string): Promise<CityClassificationRate | null> {
  return (await loadClassificationRates()).get(cityName) ?? null;
}
