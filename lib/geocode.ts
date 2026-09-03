/**
 * Pure rules of the geocoding campaign: what a stored geocode is, which of
 * two answers for the same address wins, and how a source's own accuracy
 * label folds into ours. No database, no network — everything here is
 * pinned in tests/pure.test.ts.
 */

/** How exact a stored coordinate is. */
export type GeocodeLevel = "house" | "street" | "none";
/** Who said so. */
export type GeocodeSource = "mapi" | "govmap" | "fixture";

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
 * Sources in order of trust. The national address file is the surveyed
 * register itself; govmap's search is a lookup over (mostly) the same data
 * with occasional street-centre answers; the fixture is synthetic.
 */
export const SOURCE_RANK: Record<GeocodeSource, number> = { mapi: 3, govmap: 2, fixture: 1 };
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

/** Parse govmap's WKT point. `POINT(179650.12 665812.9)` → {x, y}; else null. */
export function parseWktPoint(shape: string | null | undefined): { x: number; y: number } | null {
  const m = shape?.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
  if (!m) return null;
  const x = parseFloat(m[1]), y = parseFloat(m[2]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
