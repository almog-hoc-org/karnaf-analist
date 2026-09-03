/**
 * Deal pins: the located deals of one neighbourhood, projected into the
 * city map's own coordinate space.
 *
 * THREE JOINS, IN ORDER OF EXACTNESS. A deal's (street, house) key is looked
 * up in address_geocodes: the exact house first; then the other number a
 * range like "12-14" names; then the street itself, which is drawn as a
 * hollow ring rather than a pin so that it can never pass for the building.
 * A deal with no street, or with a street nobody has geocoded, is counted
 * and not drawn — the caption under the map says how many.
 *
 * THE PROJECTOR IS THE MAP'S. makeProjector(geometry.bbox) with the default
 * pad, exactly as scripts/collect-city-map.ts called it when it wrote the
 * shapes. Any other call puts every pin a few metres to a few hundred metres
 * off its building, consistently, which is the kind of wrong that looks right.
 *
 * COLOUR IS RELATIVE TO THE NEIGHBOURHOOD, NOT THE CITY. The map's fills
 * already say where the neighbourhood sits in its city. Inside it, the
 * question is "which of these sold dear for HERE", so the median that the
 * five bins straddle is the neighbourhood's own, over the window shown.
 */
import { prisma } from "./db";
import { cachedMarket } from "./cache";
import { getRuleNum } from "./systemRules";
import { makeProjector, type BBox } from "./geo";
import { addressKeyString, normStreet } from "./addressKey";
import { loadCityMapGeometry } from "./cityMap";
import type { DealScope } from "./neighborhoodDeals";

export * from "./dealPinTypes";
import {
  joinDealsToGeocodes, capPoints, median, defaultWindow, clampWindow, pinsWorthShowing,
  type HoodDealPoints, type DealRow, type GeoRow,
} from "./dealPinTypes";

/* ───────────────────────── the loader ───────────────────────── */

function scopeClause(scope: DealScope): string {
  if (scope === "sh") return "AND is_secondhand = 1";
  if (scope === "new") return "AND is_secondhand = 0 AND year_built IS NOT NULL AND year_built > 0";
  return "";
}

async function loadGeocodes(cityName: string, streetNorms: string[]): Promise<Map<string, GeoRow>> {
  const out = new Map<string, GeoRow>();
  if (!streetNorms.length) return out;
  try {
    for (let i = 0; i < streetNorms.length; i += 400) {
      const chunk = streetNorms.slice(i, i + 400);
      const rows = await prisma.$queryRawUnsafe<Array<{
        street_norm: string; house_norm: string; lon: number | null; lat: number | null; level: string;
      }>>(
        `SELECT street_norm, house_norm, lon, lat, level FROM address_geocodes
          WHERE city_name = ? AND level IN ('house','street') AND lon IS NOT NULL AND lat IS NOT NULL
            AND street_norm IN (${chunk.map(() => "?").join(",")})`,
        cityName, ...chunk
      );
      for (const r of rows) {
        out.set(addressKeyString({ streetNorm: r.street_norm, houseNorm: r.house_norm }), {
          street_norm: r.street_norm, house_norm: r.house_norm,
          lon: Number(r.lon), lat: Number(r.lat), level: r.level === "house" ? "house" : "street",
        });
      }
    }
  } catch { /* no address_geocodes yet — nothing is located, which is the honest state */ }
  return out;
}

const EMPTY: HoodDealPoints = {
  points: [], streets: [], total: 0, located: 0, houseLevel: 0, streetLevel: 0,
  medianSqm: null, years: null, capped: false, worthShowing: false,
};

async function loadHoodDealPointsUncached(
  cityName: string,
  neighborhood: string,
  scope: DealScope,
  from: number,
  to: number
): Promise<HoodDealPoints> {
  const geometry = await loadCityMapGeometry(cityName);
  const bbox: BBox | null = geometry.bbox;
  if (!bbox) return EMPTY;

  let rows: DealRow[] = [];
  try {
    rows = await prisma.$queryRawUnsafe<DealRow[]>(
      `SELECT id, deal_date, deal_year, price_sqm, rooms, area, price, floor, street, house_num
         FROM nadlan_transactions
        WHERE city_name = ? AND neighborhood = ? AND COALESCE(excluded,0) = 0 ${scopeClause(scope)}`,
      cityName, neighborhood
    );
  } catch { return EMPTY; }
  rows = rows.map((r) => ({
    ...r, id: Number(r.id), deal_year: Number(r.deal_year),
    price_sqm: r.price_sqm == null ? null : Number(r.price_sqm),
    rooms: r.rooms == null ? null : Number(r.rooms),
    area: r.area == null ? null : Number(r.area),
    price: r.price == null ? null : Number(r.price),
  }));

  const dealYears = rows.map((r) => r.deal_year);
  // A requested window is clamped to the years that exist, so the caption
  // says "2019–2025" and never "2016–2100": the reader is told what was
  // drawn, not what was asked for.
  const window = from > 0 && to > 0
    ? clampWindow([from, to], dealYears)
    : defaultWindow(dealYears, getRuleNum("deal_map_default_years"));
  if (!window) return EMPTY;
  const inWindow = rows.filter((r) => r.deal_year >= window[0] && r.deal_year <= window[1]);

  const streetNorms = [...new Set(inWindow.map((r) => normStreet(r.street)).filter(Boolean))];
  const geocodes = await loadGeocodes(cityName, streetNorms);
  const joined = joinDealsToGeocodes(cityName, inWindow, geocodes, makeProjector(bbox));
  const { points, capped } = capPoints(joined.points, getRuleNum("deal_map_max_points"));

  const counts = { total: inWindow.length, located: joined.located };
  return {
    points, streets: joined.streets,
    ...counts,
    houseLevel: joined.houseLevel, streetLevel: joined.streetLevel,
    medianSqm: median(inWindow.map((r) => r.price_sqm ?? 0)),
    years: window, capped,
    worthShowing: pinsWorthShowing(counts, getRuleNum("deal_map_min_geocoded_ratio"), getRuleNum("deal_map_min_points")),
  };
}

export const loadHoodDealPoints = cachedMarket(loadHoodDealPointsUncached, ["hood-deal-points"]);
