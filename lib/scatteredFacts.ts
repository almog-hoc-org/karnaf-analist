/**
 * Loader for scattered per-city facts collected from CBS press releases,
 * Ministry of Finance Chief Economist reports, and similar sources.
 *
 * Source file: data/scattered_city_facts.json
 *
 * Each fact is a self-contained statement about a specific city, with source URL
 * and publication date. Time series are separate — used to render mini-tables.
 */
import fs from "fs";
import path from "path";

export interface CityFact {
  city: string;
  category: "price_index" | "construction" | "population" | "other";
  fact: string;
  source_url: string;
  source_name: string;
  published: string; // ISO date
  confidence: "high" | "medium";
}

export interface CityTimeSeries {
  city: string;
  metric: string;
  unit: string;
  source_url: string;
  source_name: string;
  data: Array<{ period: string; value: number }>;
}

export interface ScatteredCityData {
  facts: CityFact[];
  timeSeries: CityTimeSeries[];
}

const FILE_PATH = path.resolve(process.cwd(), "data", "scattered_city_facts.json");

let cached: { facts: CityFact[]; timeSeries: CityTimeSeries[] } | null = null;

function loadAll(): { facts: CityFact[]; timeSeries: CityTimeSeries[] } {
  if (cached) return cached;
  try {
    if (!fs.existsSync(FILE_PATH)) {
      cached = { facts: [], timeSeries: [] };
      return cached;
    }
    const raw = fs.readFileSync(FILE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    cached = {
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
      timeSeries: Array.isArray(parsed.time_series) ? parsed.time_series : [],
    };
    return cached;
  } catch {
    cached = { facts: [], timeSeries: [] };
    return cached;
  }
}

export function getCityScatteredData(cityName: string): ScatteredCityData {
  const all = loadAll();
  return {
    facts: all.facts.filter((f) => f.city === cityName),
    timeSeries: all.timeSeries.filter((t) => t.city === cityName),
  };
}
