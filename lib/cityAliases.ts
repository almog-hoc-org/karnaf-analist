/**
 * Canonical city naming — aliases and spelling normalization, in ONE place.
 *
 * WHY THIS EXISTS
 * The QA deep-dive (2026-08-12) found "מכבים רעות" living as a full separate
 * city beside "מודיעין-מכבים-רעות" — its own transactions, its own deals
 * cache, its own (empty) city page — even though the CBS has not recognized
 * it as a separate settlement since the 2003 merger (city_cbs_codes.json has
 * no entry for it). Nothing in the codebase could say "these are the same
 * place": the only normalization was a character-level `normalizeCity`,
 * copy-pasted into five files, applied only when matching API responses.
 *
 * Layers:
 *   1. CITY_ALIASES  — explicit renames. Applied to RAW rows at the start of
 *      the merge stage, so aggregation/groupings see one name; and at city-page
 *      lookup, so an old link redirects instead of 404ing on an empty page.
 *   2. normalizeCity — the spelling-variant folder (hyphens, quotes, double
 *      yod/vav, whitespace), now exported from here as the single copy.
 *
 * Adding an alias: add the pair below — the pipeline picks it up on the next
 * run and the city page redirects immediately. Nothing else to touch.
 */

/** alias → canonical. Keys must never appear as canonical names. */
export const CITY_ALIASES: Record<string, string> = {
  // merged into מודיעין in 2003; CBS lists only the combined settlement
  "מכבים רעות": "מודיעין-מכבים-רעות",
  "מכבים-רעות": "מודיעין-מכבים-רעות",
};

/** Resolve an alias to its canonical name (identity for everything else). */
export function canonicalCityName(name: string): string {
  return CITY_ALIASES[name.trim()] ?? name;
}

/** Alias rows that may still exist in the cities table — excluded from every
 *  listing/search so the same place never appears twice. */
export const ALIAS_NAMES = Object.keys(CITY_ALIASES);

/**
 * Normalise a city name so spelling/spacing variants compare equal
 * (e.g. "תל אביב-יפו" / "תל אביב -יפו" / "תל אביב יפו", הרצלייה ↔ הרצליה,
 * קריית ↔ קרית). Character-level only — for equality tests, not for display.
 */
export function normalizeCity(name: string | null | undefined): string {
  return (name ?? "")
    .replace(/["'`]/g, "")
    .replace(/[-–]/g, " ") // hyphens → space
    .replace(/יי/g, "י") // double yod: הרצלייה ↔ הרצליה, קריית ↔ קרית
    .replace(/וו/g, "ו") // double vav: פתח תקווה ↔ פתח תקוה
    .replace(/\s+/g, " ")
    .trim();
}

/** Alias-aware equality: same canonical entity regardless of spelling. */
export function sameCity(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeCity(canonicalCityName(a)) === normalizeCity(canonicalCityName(b));
}
