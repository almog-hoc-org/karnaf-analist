import { normalizeCitySearch } from "./citySearch";

/**
 * The hood/street search index: what gets stored, and the two pure rules
 * that decide what deserves to be in it.
 *
 * WHY AN INDEX AND NOT A LIVE QUERY. The search boxes suggest on every
 * keystroke. Streets live in nadlan_transactions — 1.45M rows — and "which
 * neighbourhood does רחוב תקוע belong to" is a GROUP BY over them. Answering
 * that per keystroke is how a typeahead takes down its own site. The index is
 * built once per pipeline run into a few thousand pre-normalised rows, and
 * the API does a prefix lookup.
 *
 * ONE NORMALISER, THE CITY-SEARCH ONE. The repo has two (normalizeCitySearch
 * and normHoodKey) and they disagree about final letters. The index must
 * normalise exactly like the QUERY will, and the query passes through the
 * same search boxes that already normalise city names — so the city-search
 * normaliser wins. The hood page's own resolver still uses normHoodKey; the
 * index stores the canonical spelling, so what it emits always lands.
 */

export interface SearchIndexRow {
  kind: "hood" | "street";
  city: string;
  /** display name — the hood itself, or the street */
  name: string;
  /** normalised lookup key, normalizeCitySearch(name) */
  norm: string;
  /** target neighbourhood, Tax Authority spelling — the page URL key */
  hood: string;
  /** deals behind the row, for ranking */
  n: number;
}

/**
 * "הרצל 14" → "הרצל". Street values written before the collectors were fixed
 * sometimes carry the house number glued on; indexed raw, every house number
 * becomes its own "street". Only a TRAILING number is stripped — "דרך 90"
 * negotiating the same rule as lib/nadlanAddress.splitAddress: a bare number
 * after a name is a house, a name that IS partly numeric survives.
 */
export function cleanStreetName(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  const m = s.match(/^(.*?)[\s]+\d{1,4}[א-ת]?$/);
  return m && m[1].trim() ? m[1].trim() : s;
}

/**
 * Which neighbourhood a street belongs to — or null, and null is an answer.
 *
 * The never-guess rule, in numbers: the modal hood must hold at least
 * `minShare` of the street's classified deals (default 70%) and at least
 * `minN` deals in absolute terms. אבן גבירול, which genuinely straddles
 * neighbourhoods, fails the share test and stays OUT of the index — a wrong
 * confident answer is worse than no suggestion.
 */
export function pickModalHood(
  counts: Map<string, number>,
  opts: { minShare?: number; minN?: number } = {}
): { hood: string; n: number } | null {
  const minShare = opts.minShare ?? 0.7;
  const minN = opts.minN ?? 5;
  let total = 0, best: string | null = null, bestN = 0;
  for (const [hood, n] of counts) {
    total += n;
    if (n > bestN) { best = hood; bestN = n; }
  }
  if (!best || total === 0) return null;
  if (bestN < minN) return null;
  if (bestN / total < minShare) return null;
  return { hood: best, n: total };
}

/** The lookup key both the builder and the API must share. */
export function searchNorm(s: string): string {
  return normalizeCitySearch(s);
}

/**
 * What a user typed as a street → what the transactions DB can match. Two
 * habits break a naive LIKE: a leading "רחוב"/"שד׳" the source data never
 * stores, and a house number glued to the street name ("הרצל 14"). Both are
 * stripped from the QUERY side only — the DB value is matched by containment,
 * so a stored "שדרות רוטשילד" is still found by the stripped "רוטשילד".
 * "דרך" is NOT stripped: it is integral to names like "דרך השלום".
 */
export function normalizeStreetQuery(raw: string): string {
  const cleaned = raw.replace(/["'`]/g, "").replace(/\s+/g, " ").trim()
    .replace(/^(?:רחוב|רח'|רח׳|שדרות|שד'|שד׳)\s+/, "");
  return cleanStreetName(cleaned);
}
