/**
 * The "within N metres" rung of the comparison ladder — the pure half.
 *
 * WHY A RADIUS AND NOT `street LIKE`. A street rung compares against the
 * whole street, which for שדרות רוטשילד is two kilometres of very different
 * blocks, and against nothing on the parallel street thirty metres away. A
 * circle around the building is what a buyer means by "around here". It
 * needs coordinates, so it exists only where the address campaign and the
 * geocode imports have both reached: the query address must be geocoded at
 * house level, and only house-level geocodes count as inside the circle —
 * a street's centroid says nothing about where on the street a deal was.
 *
 * lib/streetComps.ts does the SQL (the box pre-filter on address_geocodes,
 * the deals on the streets the box touches); everything that decides is here
 * and tested.
 */
import { distanceM, type LonLat } from "./geo";
import { addressKeyString, normHouse, normStreet } from "./addressKey";
import type { CompDeal, MatchLevel } from "./compTypes";

/** One geocoded building — what the box query returns. */
export interface HouseGeocode {
  street_norm: string;
  house_norm: string;
  lon: number;
  lat: number;
}

export interface RadiusCentre {
  lonLat: LonLat;
  /** "רוטשילד 16" — the address the circle is drawn around, as typed */
  label: string;
}

/** The geocodes within the circle (the box is a superset), keyed by address. */
export function housesWithin(
  centre: LonLat,
  radiusM: number,
  candidates: HouseGeocode[]
): Map<string, HouseGeocode> {
  const out = new Map<string, HouseGeocode>();
  for (const g of candidates) {
    if (!g.street_norm || !g.house_norm) continue;
    if (distanceM(centre, [g.lon, g.lat]) <= radiusM) {
      out.set(addressKeyString({ streetNorm: g.street_norm, houseNorm: g.house_norm }), g);
    }
  }
  return out;
}

/**
 * The SQL cannot compare a raw Tax Authority street spelling with a
 * normalised geocode key, so it narrows by the longest word of each street
 * inside the circle (LIKE), and the exact key is applied here. The same
 * rule lib/dealPins.ts uses for a street page.
 */
export function streetCores(streetNorms: Iterable<string>): string[] {
  const cores = new Set<string>();
  for (const key of streetNorms) {
    const core = key.replace(/^שדרות /, "").split(" ").sort((a, b) => b.length - a.length)[0] ?? key;
    if (core.length >= 2) cores.add(core);
  }
  return [...cores];
}

/**
 * Keep the deals whose building is one of `inside`. A range like "12-14"
 * counts when either number is a geocoded building inside the circle. A
 * deal with no house number cannot be placed and is dropped — never
 * approximated to the street.
 */
export function dealsWithin(rows: CompDeal[], inside: Map<string, HouseGeocode>): CompDeal[] {
  return rows.filter((r) => {
    const streetNorm = normStreet(r.street);
    if (!streetNorm) return false;
    const h = normHouse(r.house_num);
    if (!h.primary) return false;
    for (const houseNorm of [h.primary, ...h.alts]) {
      if (inside.has(addressKeyString({ streetNorm, houseNorm }))) return true;
    }
    return false;
  });
}

const ROOM_TOLERANCE = 0.25; // matches 3.5 to 3.5 but never to 4

/**
 * The similarity grades of the ladder, applied in JS — the radius rung
 * fetches its deals once (they are the same rows for every grade) and
 * narrows here, so its grades mean exactly what the SQL grades mean.
 */
export function similarDeals(
  rows: CompDeal[],
  match: MatchLevel,
  rooms: number | null,
  size: number | null,
  pct: { tight: number; wide: number }
): CompDeal[] {
  const hasRooms = rooms != null && rooms > 0;
  const hasSize = size != null && size > 0;
  if ((match === "tight" || match === "wide") && !(hasRooms && hasSize)) return [];
  if (match === "rooms" && !hasRooms) return [];
  return rows.filter((r) => {
    if (match === "any") return true;
    if (r.rooms == null || Math.abs(Number(r.rooms) - rooms!) > ROOM_TOLERANCE) return false;
    if (match === "rooms") return true;
    const p = (match === "tight" ? pct.tight : pct.wide) / 100;
    return r.area != null && Number(r.area) >= size! * (1 - p) && Number(r.area) <= size! * (1 + p);
  });
}
