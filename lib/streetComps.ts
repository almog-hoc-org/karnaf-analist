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
import type { GeoLevel, MatchLevel, CompDeal, StreetComp } from "./compTypes";

export type { GeoLevel, MatchLevel, CompDeal, StreetComp } from "./compTypes";

const norm = (s: string) => s.replace(/["'`]/g, "").replace(/\s+/g, " ").trim();
const ROOM_TOLERANCE = 0.25; // matches 3.5 to 3.5 but never to 4

const GEO_HE: Record<GeoLevel, string> = { street: "רחוב", neighborhood: "שכונה", city: "יישוב" };

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
  size?: number | null
): Promise<StreetComp> {
  const years = getRuleNum("comp_years", 5);
  const tightPct = getRuleNum("comp_area_tight_pct", 7);
  const widePct = getRuleNum("comp_area_wide_pct", 20);
  const minDeals = Math.max(1, getRuleNum("comp_min_deals", 1));
  const minSqmPrice = getRuleNum("min_sqm_price", 2000);
  const shOnly = getRuleBool("comp_secondhand_only", true);
  const shMinAge = getRuleNum("secondhand_min_age");

  const hasRooms = rooms != null && rooms > 0;
  const hasSize = size != null && size > 0;
  const st = street && norm(street).length >= 2 ? norm(street) : null;
  const nb = neighborhood && norm(neighborhood).length >= 2 ? norm(neighborhood) : null;

  /** One query: geography × similarity. Returns [] when the rung is impossible. */
  async function fetchRung(geo: GeoLevel, match: MatchLevel): Promise<CompDeal[]> {
    if (geo === "street" && !st) return [];
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
      `SELECT deal_date, area, rooms, price, price_sqm, street, house_num, neighborhood
       FROM nadlan_transactions WHERE ${conds.join(" AND ")}
       ORDER BY deal_date DESC LIMIT 400`,
      ...params
    ).catch(() => []);
  }

  // Priority: same-type comps first, widening the map before giving up on type.
  const ladder: Array<[GeoLevel, MatchLevel]> = [
    ["street", "tight"], ["street", "wide"],
    ["neighborhood", "tight"], ["neighborhood", "wide"],
    ["city", "tight"], ["city", "wide"],
    ["street", "rooms"], ["neighborhood", "rooms"], ["city", "rooms"],
    ["street", "any"], ["neighborhood", "any"], ["city", "any"],
  ];

  for (const [geo, match] of ladder) {
    const rows = await fetchRung(geo, match);
    if (rows.length < minDeals) continue;

    const pct = match === "tight" ? tightPct : match === "wide" ? widePct : null;
    const areaRange: [number, number] | null =
      pct != null && hasSize ? [Math.round(size! * (1 - pct / 100)), Math.round(size! * (1 + pct / 100))] : null;

    const where = geo === "street" ? `רחוב ${st}` : geo === "neighborhood" ? `שכונת ${nb}` : city;
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
    };
  }

  return {
    level: "city", geoLevel: "city", matchLevel: "any",
    label: `לא נמצאו עסקאות ${shOnly ? "יד-שנייה " : ""}להשוואה ב${city} ב-${years} השנים האחרונות`,
    medianSqm: null, n: 0, areaRange: null, rooms: hasRooms ? rooms! : null, years, recent: [],
  };
}

/** Short human explanation of what the comparison matched (for the UI chip). */
export function compMatchNote(c: StreetComp): string {
  if (c.n === 0) return "אין עסקאות דומות";
  const geo = GEO_HE[c.geoLevel];
  if (c.matchLevel === "tight") return `התאמה מדויקת · ${geo}`;
  if (c.matchLevel === "wide") return `שטח מורחב · ${geo}`;
  if (c.matchLevel === "rooms") return `אותו מס׳ חדרים · ${geo}`;
  return `כל הדירות · ${geo}`;
}
