import { prisma } from "./db";
import { loadOfficialPriceSeries, type OfficialPricePoint } from "./official-price-series";

/**
 * Data for the per-city price graphs — 100% the collected nadlan deals (no govmap):
 *   1. median      — official nadlan median (nadlan_price_trends), by year.
 *   2. avg all     — nadlan_year_room_stats scope="all", by year×room (inspectable, drill-down).
 *   3. avg 2nd-hand — scope="secondhand" (dealYear − yearBuilt ≥ 3), by year×room.
 *   (+ scope="new" — first-hand, has build year AND not second-hand — for period-compare/table.)
 * All average series come from the same collected transactions, inspectable via loadCityDeals.
 */

export type RoomKey = "3" | "4" | "5" | "all";
export type Scope = "all" | "secondhand" | "new";
export const ROOM_KEYS: RoomKey[] = ["3", "4", "5", "all"];

export interface StatPoint {
  year: number;
  avgSqm: number | null;
  medianSqm: number | null;
  avgPrice: number | null;
  medianPrice: number | null;
  n: number;
}
/** per room bucket → points sorted by year */
export type RoomSeries = Record<RoomKey, StatPoint[]>;

export interface CityGraphData {
  cityName: string;
  median: OfficialPricePoint[];            // graph 1
  nadlan: Record<Scope, RoomSeries>;       // graphs 2 (all) + 3 (secondhand) + new
  nadlanYears: number[];                   // years present in the collected data (union)
}

export interface NadlanDeal {
  dealDate: string;
  dealYear: number;
  rooms: number | null;
  roomBucket: string;
  area: number | null;
  price: number | null;
  priceSqm: number | null;
  yearBuilt: number | null;
  isSecondHand: boolean;
  source: string; // "govmap" (רשות המסים, broad) | "nadlan" (build-year)
}

function emptyRoomSeries(): RoomSeries {
  return { "3": [], "4": [], "5": [], all: [] };
}

export async function loadCityGraphSeries(cityName: string): Promise<CityGraphData> {
  const [median, statRows] = await Promise.all([
    loadOfficialPriceSeries(cityName),
    prisma.nadlan_year_room_stats.findMany({
      where: { city_name: cityName },
      orderBy: [{ year: "asc" }],
    }),
  ]);

  const nadlan: Record<Scope, RoomSeries> = { all: emptyRoomSeries(), secondhand: emptyRoomSeries(), new: emptyRoomSeries() };
  const yearsSet = new Set<number>();
  for (const r of statRows) {
    if (!(["all", "secondhand", "new"] as string[]).includes(r.scope)) continue;
    const scope = r.scope as Scope;
    const bucket = (["3", "4", "5", "all"].includes(r.room_bucket) ? r.room_bucket : null) as RoomKey | null;
    if (!bucket) continue;
    nadlan[scope][bucket].push({
      year: r.year,
      avgSqm: r.avg_sqm, medianSqm: r.median_sqm, avgPrice: r.avg_price, medianPrice: r.median_price, n: r.n,
    });
    yearsSet.add(r.year);
  }

  // sort each room series by year
  for (const scope of ["all", "secondhand", "new"] as Scope[])
    for (const k of ROOM_KEYS) nadlan[scope][k].sort((a, b) => a.year - b.year);

  return {
    cityName, median, nadlan,
    nadlanYears: [...yearsSet].sort((a, b) => a - b),
  };
}

/** Raw nadlan deals for a city, for the drill-down drawer (client filters by rooms/years/scope). */
/**
 * Deals for the drill-down drawer. Capped (most-recent-first) to keep the page payload
 * reasonable for big cities with 15k+ deals — the GRAPHS use the full stats table, so
 * they stay accurate; the drawer is a recent inspection sample.
 */
const DRAWER_CAP = 2000; // trimmed: page-payload weight dominated city-page latency
export async function loadCityDeals(cityName: string): Promise<NadlanDeal[]> {
  const rows = await prisma.nadlan_transactions.findMany({
    where: { city_name: cityName },
    orderBy: [{ deal_date: "desc" }],
    take: DRAWER_CAP,
  });
  return rows.map((r) => ({
    dealDate: r.deal_date,
    dealYear: r.deal_year,
    rooms: r.rooms,
    roomBucket: r.room_bucket,
    area: r.area,
    price: r.price,
    priceSqm: r.price_sqm,
    yearBuilt: r.year_built,
    isSecondHand: !!r.is_secondhand,
    source: r.source ?? "nadlan",
  }));
}
