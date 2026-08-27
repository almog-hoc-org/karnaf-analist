/**
 * Pulling the reported address out of a raw nadlan.gov.il deal item —
 * DEFENSIVELY, because the exact field names are not yet measured.
 *
 * THE SITUATION THIS SOLVES. The deal-data API demonstrably returns more than
 * the nine fields the collector types: nadlan.gov.il itself renders a full
 * address for every deal, and the collector already receives (and drops)
 * `neighborhoodName`. But the sandbox this code is written in cannot reach the
 * API, so the street field's real name is unknown until the next collection
 * run prints the raw keys. Guessing one name and being wrong would silently
 * store nothing for another cycle.
 *
 * So this reads EVERY plausible spelling, in a fixed priority order, and
 * returns null when none is present — the collector stores NULL exactly as it
 * does today, and the raw-keys log line tells us which name to promote. The
 * candidates cover the API's own historical spellings (the classic endpoint
 * used FULLADRESS with one D) and the camelCase the current one uses for its
 * other fields.
 *
 * Pure and dependency-free so the tests can pin the parsing without a browser.
 */

/** Field names that may carry "רחוב מספר, עיר" or just the street. */
const ADDRESS_KEYS = [
  "fullAdress", "fullAddress", "FULLADRESS",
  "displayAdress", "displayAddress",
  "addressName", "address",
] as const;

const STREET_KEYS = ["streetName", "street", "streetNameHeb"] as const;
const HOUSE_KEYS = ["houseNum", "houseNumber", "house_num", "buildingNumber"] as const;

export interface ReportedAddress {
  street: string | null;
  houseNum: string | null;
}

function firstString(item: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * "הרצל 14, תל אביב-יפו" → { street: "הרצל", houseNum: "14" }.
 *
 * The number is taken only from the END of the street part — "דרך 90" the
 * road-name stays intact, and a street with no trailing number returns the
 * whole cleaned string with houseNum null.
 */
export function splitAddress(raw: string, cityName?: string): ReportedAddress {
  let s = raw.trim();
  // Drop a trailing ", city" — the address is stored per-city anyway.
  const comma = s.lastIndexOf(",");
  if (comma > 0) {
    const tail = s.slice(comma + 1).trim();
    if (!cityName || tail === cityName || cityName.includes(tail) || tail.includes(cityName.split(" ")[0]))
      s = s.slice(0, comma).trim();
  }
  const m = s.match(/^(.*?)[\s]+(\d{1,4}[א-ת]?)$/);
  if (m && m[1].trim()) return { street: m[1].trim(), houseNum: m[2] };
  return { street: s || null, houseNum: null };
}

/** The address as reported, from whichever field the API used — or nulls. */
export function extractAddress(item: Record<string, unknown>, cityName?: string): ReportedAddress {
  const street = firstString(item, STREET_KEYS);
  if (street) {
    const house = firstString(item, HOUSE_KEYS);
    // Some payloads glue the number into the street field itself.
    if (!house) return splitAddress(street, cityName);
    return { street, houseNum: house };
  }
  const addr = firstString(item, ADDRESS_KEYS);
  if (addr) return splitAddress(addr, cityName);
  return { street: null, houseNum: null };
}

/** One log line per run: the raw keys, so the next reader KNOWS the schema
 *  instead of guessing it the way this file had to. */
export function describeRawItem(item: Record<string, unknown>): string {
  return Object.entries(item)
    .map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v.slice(0, 30)) : String(v)}`)
    .join(" · ");
}
