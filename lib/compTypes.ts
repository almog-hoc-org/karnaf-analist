/**
 * Pure types for the comparable-deals engine — client-safe.
 * lib/streetComps.ts (server, touches sqlite) re-exports these, so client
 * components import from HERE and never pull the database into the bundle.
 */
export type GeoLevel = "street" | "neighborhood" | "city";
export type MatchLevel = "tight" | "wide" | "rooms" | "any";

export interface CompDeal {
  deal_date: string;
  area: number | null;
  rooms: number | null;
  price: number | null;
  price_sqm: number | null;
  street: string | null;
  house_num: string | null;
  neighborhood: string | null;
  /** build year — a 10-year-old building and a 50-year-old one are different markets */
  year_built: number | null;
}

/** What location granularity the comparison rows actually carry, so the UI can
 *  show a street column, fall back to neighborhood, or drop the column honestly
 *  (small settlements like רמת ישי expose neither in the source feed). */
export type AddressGranularity = "street" | "neighborhood" | "none";
export function addressGranularity(rows: CompDeal[]): AddressGranularity {
  if (rows.some((r) => r.street && r.street.trim())) return "street";
  if (rows.some((r) => r.neighborhood && r.neighborhood.trim())) return "neighborhood";
  return "none";
}
export function rowAddress(r: CompDeal): string | null {
  const st = [r.street, r.house_num].filter((x) => x && String(x).trim()).join(" ").trim();
  if (st) return st;
  if (r.neighborhood && r.neighborhood.trim()) return r.neighborhood.trim();
  return null;
}

export interface StreetComp {
  level: GeoLevel;
  geoLevel: GeoLevel;
  matchLevel: MatchLevel;
  label: string;
  medianSqm: number | null;
  n: number;
  areaRange: [number, number] | null;
  rooms: number | null;
  years: number;
  recent: CompDeal[];
  /** the street the rung actually matched on, when geoLevel === "street" */
  matchedStreet: string | null;
  /** the neighbourhood the rung matched on, when geoLevel === "neighborhood" */
  matchedHood: string | null;
  /** the hood was not typed by the user — it was looked up from the street's
   *  modal-majority assignment in search_index */
  hoodInferred: boolean;
}

/**
 * WHAT the comparison is against — the geography, named. The old note led with
 * the similarity grade ("התאמה מדויקת") and buried the geography behind a dot,
 * so a city-wide fallback read like a precise answer. The user's spec: say
 * what the number was compared TO, always.
 */
export function compWhere(c: StreetComp): string {
  if (c.geoLevel === "street") return "ברחוב";
  if (c.geoLevel === "neighborhood") return c.matchedHood ? `בשכונת ${c.matchedHood}` : "בשכונה";
  return "בכל העיר";
}

/** HOW similar the compared deals are — the second half of the note. */
export function compHow(c: StreetComp): string {
  if (c.matchLevel === "tight" || c.matchLevel === "wide") return "דירות דומות";
  if (c.matchLevel === "rooms") return "לפי מס׳ חדרים";
  return "כל הדירות";
}

/** Short human explanation of what the comparison matched (for the UI chip). */
export function compMatchNote(c: StreetComp): string {
  if (!c || c.n === 0) return "אין עסקאות דומות";
  return `${compWhere(c)} · ${compHow(c)}`;
}
