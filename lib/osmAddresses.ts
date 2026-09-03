/**
 * The pure half of the OpenStreetMap address import
 * (scripts/import-osm-addresses.ts): the Overpass query for a city's box,
 * and the rule that turns one OSM element into a geocode row. No network,
 * no database — pinned in tests/pure.test.ts.
 *
 * WHY OSM AT ALL. The scan of data.gov.il (3.9.2026) found no national
 * address file with coordinates — the Survey of Israel publishes parcels and
 * roads, not addresses. OpenStreetMap carries `addr:housenumber` on
 * buildings and entrances wherever a mapper bothered, which in the big
 * cities is a large share of the buildings. It is free, bulk, reachable
 * from the server, and ranks BELOW the government sources
 * (lib/geocode.ts SOURCE_RANK): a surveyed number replaces it, it never
 * replaces a surveyed number.
 */
import type { BBox } from "./geo";
import { addressKey, type AddressKey } from "./addressKey";
import { wgs84ToItm } from "./itm";

/**
 * Every node, way and relation in the box that carries a street and a house
 * number. `out center` gives ways and relations one representative point —
 * the building's centre — which is exactly the pin we want.
 */
export function overpassAddressQuery(bbox: BBox, timeoutSec = 180): string {
  const bb = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  return `[out:json][timeout:${timeoutSec}];
(
  node(${bb})["addr:housenumber"]["addr:street"];
  way(${bb})["addr:housenumber"]["addr:street"];
  relation(${bb})["addr:housenumber"]["addr:street"];
);
out center tags;`;
}

export interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OsmGeocode {
  key: AddressKey;
  lon: number;
  lat: number;
  itmX: number;
  itmY: number;
  osmId: string;
}

export interface CityCentre { city: string; lat: number; lon: number }

/**
 * Which of OUR cities a point belongs to.
 *
 * MEASURED, NOT ASSUMED (3.9.2026): the first run credited every element in
 * a 22 km box to the box's city — Bat Yam came back with 63,000 addresses,
 * which are Tel Aviv's. OpenStreetMap has no municipal boundaries for
 * Israel to cut by, so the rule is: an explicit `addr:city` that folds to
 * one of ours wins; otherwise the NEAREST city centre among ours. Nearest
 * centre is not a boundary, but at the scale of a pin on a neighbourhood map
 * it is right far more often than any box, and it is wrong only along the
 * seam between two adjacent cities.
 */
export function assignCity(
  lon: number,
  lat: number,
  addrCity: string | undefined,
  centres: CityCentre[],
  cityFold: (raw: string) => string | null
): string | null {
  if (addrCity) {
    const folded = cityFold(addrCity);
    if (folded) return folded;
  }
  let best: CityCentre | null = null, bestD = Infinity;
  const kx = Math.cos((lat * Math.PI) / 180);
  for (const c of centres) {
    const dx = (c.lon - lon) * kx, dy = c.lat - lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best?.city ?? null;
}

/**
 * One element → one geocode, or null. The element's city comes from
 * `assignCity` (its own tag, else the nearest of our centres); an element
 * with no usable number, no point, or a point outside the box is dropped.
 */
export function osmElementToGeocode(
  el: OsmElement,
  bbox: BBox,
  centres: CityCentre[],
  cityFold: (raw: string) => string | null
): OsmGeocode | null {
  const tags = el.tags ?? {};
  const street = tags["addr:street"];
  const house = tags["addr:housenumber"];
  if (!street || !house) return null;
  const lat = el.type === "node" ? el.lat : el.center?.lat;
  const lon = el.type === "node" ? el.lon : el.center?.lon;
  if (lat == null || lon == null) return null;
  if (lon < bbox.minLon || lon > bbox.maxLon || lat < bbox.minLat || lat > bbox.maxLat) return null;
  const city = assignCity(lon, lat, tags["addr:city"], centres, cityFold);
  if (!city) return null;
  const key = addressKey(city, street, house);
  if (!key || !key.houseNorm) return null;
  const { x, y } = wgs84ToItm(lon, lat);
  return { key, lon, lat, itmX: x, itmY: y, osmId: `${el.type[0]}${el.id}` };
}

/** A box around a city centre when the map collector has not run. ~7 km
 *  each way by default: with nearest-centre assignment the box only has to
 *  CONTAIN the city, and a smaller box is a smaller Overpass answer. */
export function boxAround(lat: number, lon: number, dLat = 0.065, dLon = 0.075): BBox {
  return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}
