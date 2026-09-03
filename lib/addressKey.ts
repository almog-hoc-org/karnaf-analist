/**
 * The one way this project turns a deal's street + house number into a key
 * that can be looked up in address_geocodes.
 *
 * WHY A KEY BY ADDRESS AND NOT BY DEAL. Ten flats in one building are ten
 * deals and one address; the same building sells again next year and that is
 * still one address. A coordinate stored per address serves every deal that
 * ever was or will be reported there, and a new deal joins it with no work.
 * Storing lat/lon on nadlan_transactions instead would also have brushed
 * against the deal identity key (lib/dealKey.ts), which street and house_num
 * are part of.
 *
 * TWO SOURCES, ONE SPELLING. The Tax Authority writes "שד' רוטשילד"; the
 * national address file writes "שדרות רוטשילד"; a user types "רוטשילד 16".
 * All three must land on the same row, so normalisation runs on both the
 * writing side (import, geocode) and the reading side (join), through this
 * file only. normStreet builds on lib/searchIndex.normalizeStreetQuery (the
 * prefix and glued-number rules) and adds the character rules that
 * lib/hoodKey.normHoodKey uses for neighbourhoods — deliberately NOT by
 * calling normHoodKey, which keys the map join and must not drift for a
 * street's sake.
 */
import { cleanStreetName } from "./searchIndex";

export interface AddressKey {
  /** cities-table spelling, as stored on the deal */
  cityName: string;
  streetNorm: string;
  /** '' means "the street, no number" — a street-level row */
  houseNorm: string;
}

export interface HouseNumber {
  /** the number that identifies the row — "12" for "12-14", "12" for "12/3" */
  primary: string;
  /** other numbers the raw value names ("14" for "12-14"), tried when the
   *  primary has no geocode */
  alts: string[];
}

/**
 * "שד' רוטשילד" → "שדרות רוטשילד"; "רח' הרצל 14" → "הרצל".
 *
 * The prefix rule keeps שדרות rather than dropping it: "שדרות ירושלים" and
 * "ירושלים" are different streets in Tel Aviv, and normalizeStreetQuery's
 * strip-it-all rule is right for a LIKE query and wrong for an exact key.
 */
export function normStreet(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = String(raw)
    .replace(/["'`׳״]/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const isBoulevard = /^(?:שדרות|שד)\s+/.test(s);
  // Quotes are already gone, so "רח'" and "שד׳" are the bare "רח" and "שד".
  // The trailing glued house number goes through the search index's rule.
  const bare = cleanStreetName(s.replace(/^(?:רחוב|רח|שדרות|שד)\s+/, ""));
  const body = bare
    .replace(/יי/g, "י")
    .replace(/וו/g, "ו")
    .replace(/\s+/g, " ")
    .trim();
  if (!body) return "";
  return isBoulevard ? `שדרות ${body}` : body;
}

/**
 * House numbers as the Tax Authority and the address file write them, folded
 * to what both mean: "12", "12א", "12-14" (a range: the first is primary),
 * "12/3" (entrance or flat after the slash — not part of the building),
 * " 012 " (leading zeros), "0" and blanks (no number at all).
 */
export function normHouse(raw: string | number | null | undefined): HouseNumber {
  if (raw == null) return { primary: "", alts: [] };
  let s = String(raw).replace(/["'`׳״]/g, "").replace(/\s+/g, " ").trim();
  if (!s) return { primary: "", alts: [] };
  // entrance / apartment after a slash or backslash is not the building
  s = s.split(/[\\/]/)[0].trim();
  // a range: "12-14", "12 - 14", "12–14"
  const parts = s.split(/\s*[-–—]\s*/).map(normOneHouse).filter(Boolean);
  if (parts.length === 0) return { primary: "", alts: [] };
  const [primary, ...alts] = parts;
  return { primary, alts: alts.filter((a) => a !== primary) };
}

/** "12 א" → "12א"; "012" → "12"; "0" → ""; letters-only → "". */
function normOneHouse(s: string): string {
  const m = s.trim().match(/^0*(\d{1,5})\s*([א-תA-Za-z])?$/);
  if (!m) return "";
  const num = m[1];
  if (num === "0" || num === "") return "";
  const suffix = m[2] ? m[2].toUpperCase() : "";
  return `${num}${suffix}`;
}

/** The lookup key for one deal, or null when the deal has no street at all. */
export function addressKey(
  cityName: string,
  street: string | null | undefined,
  house: string | number | null | undefined
): AddressKey | null {
  const streetNorm = normStreet(street);
  if (!streetNorm) return null;
  return { cityName, streetNorm, houseNorm: normHouse(house).primary };
}

/** `${streetNorm}|${houseNorm}` — a Map key within one city. */
export function addressKeyString(k: { streetNorm: string; houseNorm: string }): string {
  return `${k.streetNorm}|${k.houseNorm}`;
}
