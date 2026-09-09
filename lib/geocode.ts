/**
 * Pure rules of the geocoding campaign: what a stored geocode is, which of
 * two answers for the same address wins, and how a source's own accuracy
 * label folds into ours. No database, no network — everything here is
 * pinned in tests/pure.test.ts.
 */

/** How exact a stored coordinate is. */
export type GeocodeLevel = "house" | "street" | "none";
/** Who said so. */
export type GeocodeSource = "mapi" | "muni" | "govmap" | "osm" | "fixture";

export interface Geocode {
  lon: number | null;
  lat: number | null;
  itmX: number | null;
  itmY: number | null;
  level: GeocodeLevel;
  source: GeocodeSource;
  rawLabel?: string | null;
}

/**
 * Sources in order of trust. A surveyed register (the national file, or a
 * municipality's own address layer) is the ground truth; govmap's search is
 * a lookup over government data with occasional street-centre answers;
 * OpenStreetMap house numbers are community-mapped — usually right, never
 * audited; the fixture is synthetic.
 */
export const SOURCE_RANK: Record<GeocodeSource, number> = { mapi: 3, muni: 3, govmap: 2, osm: 1.5, fixture: 1 };
export const LEVEL_RANK: Record<GeocodeLevel, number> = { house: 3, street: 2, none: 1 };

/**
 * Which of two geocodes for the same address to keep.
 *
 * Exactness first: a house-level answer is never replaced by a street-level
 * one, whoever says it — a pin that moved from the building to the middle of
 * the street would read as a correction and be a regression. At equal
 * exactness the more trusted source wins; at equal source the newer answer
 * wins (a re-run is a re-run because the method improved).
 */
export function chooseGeocode(existing: Geocode | null | undefined, incoming: Geocode): Geocode {
  if (!existing) return incoming;
  const lv = LEVEL_RANK[incoming.level] - LEVEL_RANK[existing.level];
  if (lv !== 0) return lv > 0 ? incoming : existing;
  const sr = SOURCE_RANK[incoming.source] - SOURCE_RANK[existing.source];
  if (sr !== 0) return sr > 0 ? incoming : existing;
  return incoming;
}

/**
 * govmap's answer → our level. govmap names what it found in Hebrew, and the
 * strings below are the ones its address search actually emits. Anything we
 * do not recognise is "none": an unknown label with a coordinate attached
 * would otherwise become a confident pin in the wrong place.
 *
 * `hasPoint` is checked first — a label without a coordinate is no answer.
 */
export function levelFromGovmapResult(r: {
  label?: string | null;
  type?: string | null;
  hasPoint: boolean;
}): GeocodeLevel {
  if (!r.hasPoint) return "none";
  const text = `${r.label ?? ""} ${r.type ?? ""}`;
  if (/כתובת|בית|מספר|ADDRESS|HOUSE/i.test(text)) return "house";
  if (/רחוב|STREET/i.test(text)) return "street";
  return "none";
}

/**
 * Does this answer belong to the town we asked about?
 *
 * MEASURED 8.9.2026: govmap answered correctly for ריינה, עספיא, אכסאל,
 * כסרא-סמיע and ג'דיידה-מכר, and every answer was thrown away — the check
 * looked for our spelling inside govmap's ("א-רינה", "עיספייא", "איכסאל",
 * "כיסרא-סמיע", "ג'דידה-מכר"). Hebrew transliteration of Arabic names
 * varies exactly in the mater lectionis letters, so the comparison drops
 * them: quotes, hyphens, and every א/ו/י go, and what remains is the
 * consonant skeleton both spellings share.
 *
 * A skeleton shorter than three letters is not evidence of anything, so
 * such a town accepts any labelled answer — the query already named it.
 */
export function townSkeleton(name: string): string {
  return name
    .replace(/["'`׳״]/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/[אוי]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function answerMentionsTown(label: string | null | undefined, town: string): boolean {
  if (!label || !label.trim()) return true; // an unlabelled answer is not evidence against
  const skel = townSkeleton(town);
  // the whole name first, then its longest word — govmap drops a suffix
  // ("שגב שלום" for "שגב שלום (שוקייב א-סלאם)") more often than it renames
  const parts = [skel, ...skel.split(" ").sort((a, b) => b.length - a.length)];
  const hay = townSkeleton(label);
  for (const p of parts) {
    if (p.length < 3) continue;
    if (hay.includes(p)) return true;
  }
  // nothing long enough to test against: accept, the query already named the town
  return parts.every((p) => p.length < 3);
}

/** Parse govmap's WKT point. `POINT(179650.12 665812.9)` → {x, y}; else null. */
export function parseWktPoint(shape: string | null | undefined): { x: number; y: number } | null {
  const m = shape?.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
  if (!m) return null;
  const x = parseFloat(m[1]), y = parseFloat(m[2]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
