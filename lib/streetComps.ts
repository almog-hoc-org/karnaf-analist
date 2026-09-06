/**
 * Comparable-deals engine for a client's tracked apartment.
 *
 * Rule (user spec): compare ONLY to genuinely similar deals — same room count,
 * similar area (±7%, widening to ±20% when nothing matches) — and keep widening
 * the search area (street → neighbourhood → whole city) until at least one such
 * deal is found. Time window and all thresholds come from the admin rules.
 *
 * The ladder is walked in priority order and stops at the first rung that has
 * enough deals, so the client always sees the most relevant comparison that
 * actually exists, with a label saying exactly what was matched.
 */
import { prisma } from "./db";
import { getRuleNum, getRuleBool } from "./systemRules";
import { normalizeStreetQuery, searchNorm } from "./searchIndex";
import { bboxAroundM, type LonLat } from "./geo";
import { normHouse, normStreet } from "./addressKey";
import { dealsWithin, housesWithin, similarDeals, streetCores, type HouseGeocode, type RadiusCentre } from "./radiusComps";
import type { GeoLevel, MatchLevel, CompDeal, StreetComp } from "./compTypes";

export type { GeoLevel, MatchLevel, CompDeal, StreetComp } from "./compTypes";
export { compMatchNote, compWhere, compHow } from "./compTypes";

const norm = (s: string) => s.replace(/["'`]/g, "").replace(/\s+/g, " ").trim();
const ROOM_TOLERANCE = 0.25; // matches 3.5 to 3.5 but never to 4

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export async function computeStreetComp(
  city: string,
  street: string | null,
  neighborhood: string | null,
  rooms?: number | null,
  size?: number | null,
  house?: string | null
): Promise<StreetComp> {
  const years = getRuleNum("comp_years", 5);
  const radiusM = Math.max(0, getRuleNum("comp_radius_m"));
  const tightPct = getRuleNum("comp_area_tight_pct", 7);
  const widePct = getRuleNum("comp_area_wide_pct", 20);
  const minDeals = Math.max(1, getRuleNum("comp_min_deals", 1));
  const minSqmPrice = getRuleNum("min_sqm_price", 2000);
  const shOnly = getRuleBool("comp_secondhand_only", true);
  const shMinAge = getRuleNum("secondhand_min_age");

  const hasRooms = rooms != null && rooms > 0;
  const hasSize = size != null && size > 0;
  const st = street && normalizeStreetQuery(street).length >= 2 ? normalizeStreetQuery(street) : null;
  let nb = neighborhood && norm(neighborhood).length >= 2 ? norm(neighborhood) : null;

  // The smart part (user spec 8/2026): when the user left the neighbourhood
  // blank but gave a street, the engine looks the street up in search_index —
  // the modal-majority street→hood map the pipeline builds under the
  // never-guess rule (≥70% of the street's classified deals, ≥5 deals). A
  // street that genuinely straddles hoods is not in the index, and then the
  // ladder simply skips the neighbourhood rungs, as before.
  let hoodInferred = false;
  if (!nb && st) {
    // Exact normalised match first; containment as fallback, because people
    // type "אפקה" for a street the index stores as "שדרות אפקה". Among
    // containment hits the busiest street wins — the same ranking the
    // suggest API uses.
    const key = searchNorm(st);
    const hit = await prisma.$queryRawUnsafe<Array<{ hood: string }>>(
      `SELECT hood FROM search_index WHERE kind='street' AND city_name = ?
         AND (norm = ? OR norm LIKE ?)
       ORDER BY (norm = ?) DESC, n DESC LIMIT 1`,
      city, key, `%${key}%`, key
    ).catch(() => []);
    if (hit.length && hit[0].hood) { nb = norm(hit[0].hood); hoodInferred = true; }
  }

  // THE RADIUS RUNG'S CENTRE. Street + house number → the geocoded building
  // (house level only — a street centroid would put the circle anywhere
  // along the street). No geocode, no rung: the ladder falls through to the
  // neighbourhood exactly as before, and nothing is approximated.
  const houseNorm = house ? normHouse(house).primary : "";
  const centre: RadiusCentre | null = await (async () => {
    if (!street || !houseNorm || radiusM <= 0) return null;
    const streetNorm = normStreet(street);
    if (!streetNorm) return null;
    const rows = await prisma.$queryRawUnsafe<Array<{ lon: number; lat: number }>>(
      `SELECT lon, lat FROM address_geocodes
        WHERE city_name = ? AND street_norm = ? AND house_norm = ? AND level = 'house'
          AND lon IS NOT NULL AND lat IS NOT NULL LIMIT 1`,
      city, streetNorm, houseNorm
    ).catch(() => []);
    if (!rows.length) return null;
    return { lonLat: [Number(rows[0].lon), Number(rows[0].lat)] as LonLat, label: `${street.trim()} ${houseNorm}` };
  })();

  // The deals inside the circle, fetched once for all similarity grades:
  // geocoded buildings in the circle's box → exact haversine → the deals on
  // those streets, keyed to those buildings. Cached per call, not per rung.
  let radiusRows: CompDeal[] | null = null;
  async function loadRadiusRows(baseConds: string[], baseParams: unknown[]): Promise<CompDeal[]> {
    if (radiusRows) return radiusRows;
    if (!centre) return (radiusRows = []);
    const box = bboxAroundM(centre.lonLat, radiusM);
    const houses = await prisma.$queryRawUnsafe<HouseGeocode[]>(
      `SELECT street_norm, house_norm, lon, lat FROM address_geocodes
        WHERE city_name = ? AND level = 'house' AND lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?`,
      city, box.minLon, box.maxLon, box.minLat, box.maxLat
    ).catch(() => [] as HouseGeocode[]);
    const inside = housesWithin(centre.lonLat, radiusM, houses.map((h) => ({ ...h, lon: Number(h.lon), lat: Number(h.lat) })));
    const cores = streetCores(new Set([...inside.values()].map((g) => g.street_norm)));
    if (!cores.length) return (radiusRows = []);
    const rows = await prisma.$queryRawUnsafe<CompDeal[]>(
      `SELECT deal_date, area, rooms, price, price_sqm, street, house_num, neighborhood, year_built
         FROM nadlan_transactions
        WHERE ${baseConds.join(" AND ")} AND street IS NOT NULL AND (${cores.map(() => "street LIKE ?").join(" OR ")})
        ORDER BY deal_date DESC LIMIT 4000`,
      ...baseParams, ...cores.map((c) => `%${c}%`)
    ).catch(() => [] as CompDeal[]);
    return (radiusRows = dealsWithin(rows, inside));
  }

  /** One query: geography × similarity. Returns [] when the rung is impossible. */
  async function fetchRung(geo: GeoLevel, match: MatchLevel): Promise<CompDeal[]> {
    if (geo === "street" && !st) return [];
    if (geo === "radius" && !centre) return [];
    if (geo === "neighborhood" && !nb) return [];
    if ((match === "tight" || match === "wide") && !(hasRooms && hasSize)) return [];
    if (match === "rooms" && !hasRooms) return [];

    const conds = [
      "city_name = ?",
      `price_sqm > ${minSqmPrice}`,
      "COALESCE(excluded,0) = 0",
      // a luxury sale is not a comparable for an ordinary flat (same rule as every
      // other average on the site — see scripts/flag-luxury-deals.ts)
      "COALESCE(luxury,0) = 0",
      `deal_date >= date('now','-${years} years')`,
    ];
    // A new-from-contractor price is not a comparable for a resale flat.
    if (shOnly) conds.push(`year_built IS NOT NULL AND (deal_year - year_built) >= ${shMinAge}`);
    const params: unknown[] = [city];

    if (geo === "radius") {
      const rows = await loadRadiusRows(conds, params);
      return similarDeals(rows, match, hasRooms ? rooms! : null, hasSize ? size! : null, { tight: tightPct, wide: widePct }).slice(0, 400);
    }

    if (geo === "street") { conds.push("street LIKE ?"); params.push(`%${st}%`); }
    else if (geo === "neighborhood") { conds.push("neighborhood LIKE ?"); params.push(`%${nb}%`); }

    if (match === "tight" || match === "wide" || match === "rooms") {
      conds.push("rooms IS NOT NULL AND ABS(rooms - ?) <= ?");
      params.push(rooms, ROOM_TOLERANCE);
    }
    if (match === "tight" || match === "wide") {
      const pct = (match === "tight" ? tightPct : widePct) / 100;
      conds.push("area IS NOT NULL AND area BETWEEN ? AND ?");
      params.push(size! * (1 - pct), size! * (1 + pct));
    }

    return prisma.$queryRawUnsafe<CompDeal[]>(
      `SELECT deal_date, area, rooms, price, price_sqm, street, house_num, neighborhood, year_built
       FROM nadlan_transactions WHERE ${conds.join(" AND ")}
       ORDER BY deal_date DESC LIMIT 400`,
      ...params
    ).catch(() => []);
  }

  // GEOGRAPHY FIRST (user spec 8/2026): always the street, then the
  // neighbourhood, then the city — the old order widened the map before
  // giving up on the tightest similarity, so a flat with no size-twin on its
  // own street was compared against the WHOLE CITY while thirty same-room
  // deals sat one block away. Within each geography the similarity still
  // narrows tight → wide → same-rooms; the "any apartment type" rungs stay
  // last across all geographies, because comparing a 4-room flat to the
  // street's studios is worse than to similar flats in the neighbourhood.
  //
  // THE RADIUS SITS BETWEEN THE STREET AND THE NEIGHBOURHOOD (9/2026): a
  // circle of comp_radius_m around the building, when the query carried a
  // house number that is geocoded. Closer than the neighbourhood, wider
  // than the street, and it is the first rung that can see the parallel
  // street. It is skipped silently when there is no centre.
  const ladder: Array<[GeoLevel, MatchLevel]> = [
    ["street", "tight"], ["street", "wide"], ["street", "rooms"],
    ["radius", "tight"], ["radius", "wide"], ["radius", "rooms"],
    ["neighborhood", "tight"], ["neighborhood", "wide"], ["neighborhood", "rooms"],
    ["city", "tight"], ["city", "wide"], ["city", "rooms"],
    ["street", "any"], ["radius", "any"], ["neighborhood", "any"], ["city", "any"],
  ];

  for (const [geo, match] of ladder) {
    const rows = await fetchRung(geo, match);
    if (rows.length < minDeals) continue;

    const pct = match === "tight" ? tightPct : match === "wide" ? widePct : null;
    const areaRange: [number, number] | null =
      pct != null && hasSize ? [Math.round(size! * (1 - pct / 100)), Math.round(size! * (1 + pct / 100))] : null;

    const where =
      geo === "street" ? `רחוב ${st}`
      : geo === "radius" ? `${radiusM} מ׳ מ-${centre!.label}`
      : geo === "neighborhood" ? `שכונת ${nb}${hoodInferred ? " (שויכה לפי הרחוב)" : ""}`
      : city;
    const what =
      match === "tight" || match === "wide"
        ? `${rooms} חד׳ · ${areaRange![0]}–${areaRange![1]} מ״ר`
        : match === "rooms"
          ? `${rooms} חד׳ · כל השטחים`
          : "כל סוגי הדירות";

    return {
      level: geo, geoLevel: geo, matchLevel: match,
      label: `${what} · ${where} · ${years} שנים אחרונות${shOnly ? " · יד-שנייה בלבד" : ""}`,
      medianSqm: Math.round(median(rows.map((r) => Number(r.price_sqm)))),
      n: rows.length,
      areaRange,
      rooms: hasRooms ? rooms! : null,
      years,
      recent: rows.slice(0, 10),
      matchedStreet: geo === "street" ? st : null,
      radiusM: geo === "radius" ? radiusM : null,
      matchedAddress: geo === "radius" ? centre!.label : null,
      matchedHood: geo === "neighborhood" ? nb : null,
      hoodInferred: geo === "neighborhood" && hoodInferred,
    };
  }

  return {
    level: "city", geoLevel: "city", matchLevel: "any",
    label: `לא נמצאו עסקאות ${shOnly ? "יד-שנייה " : ""}להשוואה ב${city} ב-${years} השנים האחרונות`,
    medianSqm: null, n: 0, areaRange: null, rooms: hasRooms ? rooms! : null, years, recent: [],
    matchedStreet: null, radiusM: null, matchedAddress: null, matchedHood: null, hoodInferred: false,
  };
}
