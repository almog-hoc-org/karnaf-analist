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

/**
 * One element → one geocode, or null. The city is the CALLER's — the box was
 * drawn around one city and every element in it is assigned to that city,
 * unless the element names a different `addr:city` that folds to one of
 * ours (a Ramat Gan building inside Tel Aviv's generous box stays Ramat
 * Gan's). An element with no usable number, no point, or a point outside
 * the box is dropped.
 */
export function osmElementToGeocode(
  el: OsmElement,
  boxCity: string,
  bbox: BBox,
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
  let city = boxCity;
  if (tags["addr:city"]) {
    const folded = cityFold(tags["addr:city"]);
    if (folded) city = folded;
  }
  const key = addressKey(city, street, house);
  if (!key || !key.houseNorm) return null;
  const { x, y } = wgs84ToItm(lon, lat);
  return { key, lon, lat, itmX: x, itmY: y, osmId: `${el.type[0]}${el.id}` };
}

/** A generous box around a city centre when the map collector has not run:
 *  ~11 km each way, the same reach scripts/collect-city-map.ts uses. */
export function boxAround(lat: number, lon: number, dLat = 0.11, dLon = 0.12): BBox {
  return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}
