/**
 * The pure half of the national address file import (scripts/import-mapi-addresses.ts):
 * reading a CSV line, recognising the columns, deciding the coordinate
 * system, and turning one record into a geocode row. No network, no database
 * — pinned in tests/pure.test.ts, because a column matched wrongly puts every
 * pin in the country on the wrong street.
 *
 * The file is published by the Survey of Israel (מפ"י) on data.gov.il; its
 * headers drift between uploads (Hebrew, transliterated Latin, or both), so
 * fields are matched by PATTERN against the header names, never by position
 * or exact name — the same rule lib/collect-urban-renewal.ts learned.
 */
import { addressKey, type AddressKey } from "./addressKey";
import { itmToWgs84, looksLikeItm, looksLikeWgs84, wgs84ToItm } from "./itm";

export type Rec = Record<string, unknown>;

/** RFC-4180-ish: quoted fields, doubled quotes, commas inside quotes. */
export function parseCsvLine(line: string, sep = ","): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === sep) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** The separator a header line uses — comma, tab or semicolon. */
export function sniffSeparator(header: string): string {
  const counts: Array<[string, number]> = [",", "\t", ";"].map((s) => [s, header.split(s).length - 1]);
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts.sort((a, b) => b[1] - a[1])[0][0] : ",";
}

export interface ColumnMap {
  city: string;
  street: string;
  house: string;
  x: string;
  y: string;
  crs: "itm" | "wgs84";
}

function findKey(keys: string[], patterns: RegExp[], exclude?: RegExp): string | null {
  for (const p of patterns) {
    const hit = keys.find((k) => p.test(k) && !(exclude && exclude.test(k)));
    if (hit) return hit;
  }
  return null;
}

/**
 * Which columns are which. Coordinates come in one of two families and the
 * file says which by its names (X/Y, EAST/NORTH → ITM; LON/LAT → WGS84);
 * `detectCrs` then CONFIRMS it from the values, because a file named one way
 * and filled the other has happened.
 */
export function detectColumns(keys: string[]): ColumnMap | { error: string } {
  const city = findKey(keys, [/^(שם_?)?(ה)?(י|יי)שוב$/, /(שם\s*)?(י|יי)שוב/, /^SETL_?NAME/i, /settlement|city|yishuv/i], /סמל|code|id$/i);
  const street = findKey(keys, [/^(שם_?)?רחוב$/, /שם\s*רחוב|רחוב/, /^STR(EET)?_?NAME/i, /street|rechov/i], /סמל|code|id$/i);
  const house = findKey(keys, [/^מספר_?בית$/, /מס(פר)?\.?\s*בית|בית/, /^HOUSE_?(NUM|NO)/i, /house|bayit/i], /סמל|code|id$/i);
  const itmX = findKey(keys, [/^(ITM_?)?X$/i, /^E(AST(ING)?)?$/i, /^מזרח$/, /x_?itm|itm_?x|east/i]);
  const itmY = findKey(keys, [/^(ITM_?)?Y$/i, /^N(ORTH(ING)?)?$/i, /^צפון$/, /y_?itm|itm_?y|north/i]);
  const lon = findKey(keys, [/^lon(g|gitude)?$/i, /קו.?אורך|אורך/, /lon/i]);
  const lat = findKey(keys, [/^lat(itude)?$/i, /קו.?רוחב|רוחב/, /lat/i]);
  if (!city || !street) return { error: `לא זוהו עמודות יישוב/רחוב. עמודות: ${keys.join(" | ")}` };
  if (!house) return { error: `לא זוהתה עמודת מספר בית. עמודות: ${keys.join(" | ")}` };
  if (itmX && itmY) return { city, street, house, x: itmX, y: itmY, crs: "itm" };
  if (lon && lat) return { city, street, house, x: lon, y: lat, crs: "wgs84" };
  return { error: `לא זוהו עמודות קואורדינטות (X/Y או lon/lat). עמודות: ${keys.join(" | ")}` };
}

/**
 * Confirm the CRS from a sample of rows. Returns the CRS every sampled pair
 * agrees on, or an error naming the disagreement — a mixed file is refused
 * whole rather than half-imported.
 */
export function detectCrs(sample: Array<[number, number]>): "itm" | "wgs84" | { error: string } {
  let itm = 0, wgs = 0, neither = 0;
  for (const [a, b] of sample) {
    if (looksLikeItm(a, b)) itm++;
    else if (looksLikeWgs84(a, b)) wgs++;
    else neither++;
  }
  const total = itm + wgs + neither;
  if (!total) return { error: "אין שורות עם קואורדינטות לדגימה" };
  if (itm > 0 && wgs > 0) return { error: `הקובץ מעורב: ${itm} שורות נראות ITM ו-${wgs} נראות WGS84` };
  if (neither / total > 0.2) return { error: `${neither} מתוך ${total} שורות בדגימה אינן בתחום ישראל בשום מערכת` };
  return itm >= wgs ? "itm" : "wgs84";
}

export interface MapiGeocode {
  key: AddressKey;
  lon: number;
  lat: number;
  itmX: number;
  itmY: number;
}

/**
 * One record → one geocode, or null when it cannot be one (no street, no
 * number, coordinates outside Israel). `cityFold` maps the file's settlement
 * spelling onto ours; a settlement we do not hold returns null — there is
 * no page to draw it on.
 */
export function recordToGeocode(
  r: Rec,
  cols: ColumnMap,
  cityFold: (raw: string) => string | null
): MapiGeocode | null {
  const rawCity = String(r[cols.city] ?? "").trim();
  if (!rawCity) return null;
  const city = cityFold(rawCity);
  if (!city) return null;
  const a = Number(String(r[cols.x] ?? "").replace(/,/g, ""));
  const b = Number(String(r[cols.y] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const key = addressKey(city, String(r[cols.street] ?? ""), String(r[cols.house] ?? ""));
  if (!key || !key.houseNorm) return null;
  if (cols.crs === "itm") {
    if (!looksLikeItm(a, b)) return null;
    const [lon, lat] = itmToWgs84(a, b);
    return { key, lon, lat, itmX: a, itmY: b };
  }
  if (!looksLikeWgs84(a, b)) return null;
  const { x, y } = wgs84ToItm(a, b);
  return { key, lon: a, lat: b, itmX: x, itmY: y };
}

/** The centre of a street's numbered points — the fallback ring. */
export function streetCentroid(points: Array<{ lon: number; lat: number }>): { lon: number; lat: number } | null {
  if (!points.length) return null;
  // median per axis, not mean: one mis-keyed number at the far end of town
  // must not drag the street's centre off it
  const lons = points.map((p) => p.lon).sort((a, b) => a - b);
  const lats = points.map((p) => p.lat).sort((a, b) => a - b);
  const mid = Math.floor(points.length / 2);
  return { lon: lons[mid], lat: lats[mid] };
}
