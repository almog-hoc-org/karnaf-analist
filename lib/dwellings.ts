import fs from "fs";
import path from "path";
import { normalizeCity, canonicalCityName } from "./cityAliases";

/**
 * CBS dwelling stock and persons-per-dwelling, 2025.
 *
 * WHAT THIS NUMBER IS — and what it is NOT
 * `ratio` is population ÷ dwellings. It is NOT average household size. The
 * denominator counts every dwelling in the city, including empty ones,
 * investment flats and holiday apartments, so it measures how densely the
 * housing stock is occupied rather than how large families are. The two get
 * conflated constantly and they say opposite things about the same city: Tel
 * Aviv reads 2.11 here — the lowest in the country — not because families are
 * small but because it holds a great many one-person and non-primary homes.
 *
 * That distinction is why this does not overwrite avg_household_size_2022,
 * which is a genuine household-size figure from the census and feeds the
 * supply/demand model. Both live side by side; each is used for what it
 * measures.
 *
 * COVERAGE: only settlements of 50,000+ residents — 40 of them. Everything
 * else has no entry here and falls back to whatever the city row already
 * carried. A partial source is not a licence to blank the rest.
 *
 * TRANSCRIPTION CHECK (run at author time, see the file's own numbers): every
 * per-city ratio reconciles with population ÷ dwellings, and the dwelling
 * column sums to the published 1,978,760 exactly. The population column sums
 * two higher than the published total — two people in six million, which is
 * rounding inside the CBS table and is left alone rather than quietly forced
 * to match.
 */

export interface DwellingRow {
  city: string;
  dwellings: number;
  population: number;
  /** persons per dwelling — population ÷ dwellings, as published */
  ratio: number;
}

export interface DwellingsFile {
  source: {
    publisher: string;
    title: string;
    dwellingsYear: number;
    populationAsOf: string;
    populationLabel: string;
    note: string;
  };
  national: {
    citiesOver50k: { dwellings: number; population: number; ratio: number };
    wholeCountry: { dwellings: number; population: number; ratio: number };
  };
  cities: DwellingRow[];
}

const FILE = path.join(process.cwd(), "data", "cbs-dwellings-2025.json");

let cache: DwellingsFile | null = null;

export function dwellingsFile(): DwellingsFile | null {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, "utf8")) as DwellingsFile;
    return cache;
  } catch {
    return null; // shipped-with-the-repo file; absence degrades, never throws
  }
}

/**
 * city → row, keyed on the NORMALISED name.
 *
 * The published table spells some cities differently from our database
 * ("הרצלייה" vs "הרצליה", "תל אביב -יפו" with a stray space). Matching on the
 * raw string would silently drop those cities and nothing would say so, which
 * is the exact failure mode lib/cityAliases exists to prevent.
 */
let byCity: Map<string, DwellingRow> | null = null;
function index(): Map<string, DwellingRow> {
  if (byCity) return byCity;
  byCity = new Map();
  for (const r of dwellingsFile()?.cities ?? []) {
    byCity.set(normalizeCity(canonicalCityName(r.city)), r);
  }
  return byCity;
}

export function dwellingsFor(cityName: string | null | undefined): DwellingRow | null {
  if (!cityName) return null;
  return index().get(normalizeCity(canonicalCityName(cityName))) ?? null;
}

/**
 * The national persons-per-dwelling figure, as PUBLISHED (3.27).
 *
 * Deliberately not the mean of the per-city ratios. That average treats
 * Beitar Illit and Tel Aviv as equal weights and lands near 3.3-3.5 depending
 * on which cities happen to have data — a number that describes our table
 * rather than the country. The published figure is total population ÷ total
 * dwellings, which is the thing a reader assumes they are being told.
 */
export function nationalPersonsPerDwelling(): number | null {
  return dwellingsFile()?.national.wholeCountry.ratio ?? null;
}

/** The same figure restricted to cities of 50k+ — the fairer peer group (3.01). */
export function bigCityPersonsPerDwelling(): number | null {
  return dwellingsFile()?.national.citiesOver50k.ratio ?? null;
}

/** One-line provenance for any UI that shows these numbers. */
export function dwellingsProvenance(): string {
  const s = dwellingsFile()?.source;
  if (!s) return "";
  return `${s.publisher} · מספר דירות ${s.dwellingsYear} · אוכלוסייה ${s.populationLabel}`;
}

/**
 * Where a city sits among the 40 published cities, densest first.
 * Returns null for a city the table does not cover.
 */
export function dwellingRank(cityName: string): { rank: number; of: number } | null {
  const row = dwellingsFor(cityName);
  const all = dwellingsFile()?.cities;
  if (!row || !all) return null;
  const sorted = [...all].sort((a, b) => b.ratio - a.ratio);
  const i = sorted.findIndex((r) => r.city === row.city);
  return i < 0 ? null : { rank: i + 1, of: sorted.length };
}
