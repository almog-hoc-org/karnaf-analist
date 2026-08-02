import { prisma } from "./db";
import { loadOfficialPriceSeries, type OfficialPricePoint } from "./official-price-series";
import { getRuleNum } from "./systemRules";

/**
 * Data for the per-city price graphs — 100% the collected nadlan deals (no govmap):
 *   1. median      — official nadlan median (nadlan_price_trends), by year.
 *   2. avg all     — nadlan_year_room_stats scope="all", by year×room (inspectable, drill-down).
 *   3. avg 2nd-hand — scope="secondhand" (dealYear − yearBuilt ≥ 3), by year×room.
 *   (+ scope="new" — first-hand, has build year AND not second-hand — for period-compare/table.)
 * All average series come from the same collected transactions, inspectable via loadCityDeals.
 */

export type RoomKey = "3" | "4" | "5" | "all";
export type Scope = "all" | "secondhand" | "new" | "secondhand_modern" | "secondhand_old" | "secondhand_fixedmix" | "all_govmap";
export const SCOPES: Scope[] = ["all", "secondhand", "new", "secondhand_modern", "secondhand_old", "secondhand_fixedmix", "all_govmap"];
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
  partialYears: number[];                  // years with incomplete data (current year, <11 months) — never a trend endpoint
  lastFullYear: number | null;             // latest year that is NOT partial — the honest trend endpoint
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
  /** luxury deals stay visible in the drill-down but never set an average */
  luxury?: boolean;
}

function emptyRoomSeries(): RoomSeries {
  return { "3": [], "4": [], "5": [], all: [] };
}

export async function loadCityGraphSeries(cityName: string): Promise<CityGraphData> {
  const [median, statRows, monthRows] = await Promise.all([
    loadOfficialPriceSeries(cityName),
    prisma.nadlan_year_room_stats.findMany({
      where: { city_name: cityName },
      orderBy: [{ year: "asc" }],
    }),
    // month coverage per year → detect the partial current year (same rule as the reliability audit)
    prisma.$queryRawUnsafe<{ deal_year: number; months: number }[]>(
      `SELECT deal_year, COUNT(DISTINCT substr(deal_date,6,2)) months FROM nadlan_transactions
       WHERE city_name=? AND COALESCE(excluded,0)=0 GROUP BY deal_year`, cityName
    ),
  ]);
  const thisYear = new Date().getFullYear();
  const monthsByYear = new Map(monthRows.map((m) => [Number(m.deal_year), Number(m.months)]));

  const nadlan = Object.fromEntries(SCOPES.map((s) => [s, emptyRoomSeries()])) as Record<Scope, RoomSeries>;
  const yearsSet = new Set<number>();
  for (const r of statRows) {
    if (!(SCOPES as string[]).includes(r.scope)) continue;
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
  for (const scope of SCOPES)
    for (const k of ROOM_KEYS) nadlan[scope][k].sort((a, b) => a.year - b.year);

  const nadlanYears = [...yearsSet].sort((a, b) => a - b);
  // a year is partial if it's the current calendar year (or later) AND has <11 months of data
  const partialYears = nadlanYears.filter((y) => y >= thisYear && (monthsByYear.get(y) ?? 12) < 11);
  const fullYears = nadlanYears.filter((y) => !partialYears.includes(y));
  const lastFullYear = fullYears.length ? fullYears[fullYears.length - 1] : null;

  return {
    cityName, median, nadlan,
    nadlanYears,
    partialYears,
    lastFullYear,
  };
}

/**
 * Deals for the drill-down drawer.
 *
 * The first page only — the rest is fetched per year from /api/city-transactions
 * as the user opens a year. Loading "the most recent N" was the bug behind the
 * missing year tabs: in a large city the cap was swallowed whole by the current
 * year (Tel Aviv's 84k deals produced tabs for 2026 and nothing else), so a
 * 5- or 10-year filter still showed one year. Small towns fit under the cap and
 * looked fine, which is why it read as working.
 */
export const DRAWER_PAGE = 300;
export async function loadCityDeals(cityName: string, limit = DRAWER_PAGE): Promise<NadlanDeal[]> {
  const rows = await prisma.nadlan_transactions.findMany({
    // admin exclusions never reach the UI (null = legacy rows, treated as included)
    where: { city_name: cityName, OR: [{ excluded: null }, { excluded: 0 }] },
    orderBy: [{ deal_date: "desc" }],
    take: limit,
  });
  return rows.map(toDeal);
}

// is_secondhand/luxury arrive as boolean through Prisma and as 0/1 through raw SQL
function toDeal(r: {
  deal_date: string; deal_year: number; rooms: number | null; room_bucket: string;
  area: number | null; price: number | null; price_sqm: number | null;
  year_built: number | null; is_secondhand: number | boolean; source: string | null;
  luxury?: number | boolean | null;
}): NadlanDeal {
  return {
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
    luxury: !!r.luxury,
  };
}

/**
 * The count cube: one row per (year × type × building-age × rooms) combination
 * the drawer can ask for. ~400 integers per city — under 2 KB — so the year tabs
 * carry TRUE counts for every filter combination, instantly, with no round trip
 * and no sampling. The deal rows themselves arrive on demand.
 *
 * Key: `year|type|age|rooms`, where type = all|sh|new, age = all|modern|old,
 * rooms = 3|4|5|all. Written flat because it crosses to the client as JSON.
 */
export type DealCountCube = Record<string, number>;
export const cubeKey = (year: number, type: string, age: string, rooms: string) => `${year}|${type}|${age}|${rooms}`;

/**
 * What the two cleaning rules held back in this city, so the page can say it out
 * loud. A number the reader can't account for is worse than no number.
 */
export async function loadCityCleaningCounts(cityName: string): Promise<{ dupes: number; luxury: number }> {
  const minYear = new Date().getFullYear() - 10;
  const [row] = await prisma.$queryRawUnsafe<Array<{ dupes: bigint; luxury: bigint }>>(
    `SELECT SUM(CASE WHEN exclusion_reason LIKE 'כפילות-דיווח%' THEN 1 ELSE 0 END) dupes,
            SUM(CASE WHEN COALESCE(excluded,0)=0 AND COALESCE(luxury,0)=1 THEN 1 ELSE 0 END) luxury
     FROM nadlan_transactions WHERE city_name = ? AND deal_year >= ?`, cityName, minYear);
  return { dupes: Number(row?.dupes ?? 0), luxury: Number(row?.luxury ?? 0) };
}

export async function loadDealCountCube(cityName: string): Promise<DealCountCube> {
  const modernMinYear = getRuleNum("modern_min_year", 2005);
  const rows = await prisma.$queryRawUnsafe<Array<{ deal_year: number; room_bucket: string; is_secondhand: number; year_built: number | null; n: bigint }>>(
    `SELECT deal_year, room_bucket, is_secondhand, year_built, COUNT(*) n
     FROM nadlan_transactions
     WHERE city_name = ? AND COALESCE(excluded,0) = 0
     GROUP BY deal_year, room_bucket, is_secondhand, year_built`, cityName);

  const cube: DealCountCube = {};
  const add = (k: string, n: number) => { cube[k] = (cube[k] ?? 0) + n; };
  for (const r of rows) {
    const n = Number(r.n);
    const yb = r.year_built ?? 0;
    const sh = !!r.is_secondhand;
    const roomsKeys = ["all", ...(["3", "4", "5"].includes(r.room_bucket) ? [r.room_bucket] : [])];
    // mirror the drawer's predicates exactly, or a tab count could disagree with its list.
    // building-age only narrows SECOND-HAND — for "all"/"new" the age selector is ignored,
    // so those rows land under every age key. A second-hand row with no build year
    // matches neither modern nor old, exactly as the client filter treats it.
    const types = ["all", ...(sh ? ["sh"] : yb > 0 ? ["new"] : [])];
    for (const t of types) {
      const ages = t !== "sh" ? ["all", "modern", "old"]
        : yb > 0 ? ["all", yb >= modernMinYear ? "modern" : "old"]
        : ["all"];
      for (const a of ages) for (const rm of roomsKeys) add(cubeKey(r.deal_year, t, a, rm), n);
    }
  }
  return cube;
}
