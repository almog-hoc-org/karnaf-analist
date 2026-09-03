import { prisma } from "./db";
import { loadOfficialPriceSeries, type OfficialPricePoint } from "./official-price-series";
import { getRuleNum } from "./systemRules";
import { historyFromYear } from "./historyWindow";
import { cachedMarket } from "./cache";

/**
 * Data for the per-city price graphs — 100% the collected nadlan deals (no govmap):
 *   1. median      — official nadlan median (nadlan_price_trends), by year.
 *   2. avg all     — nadlan_year_room_stats scope="all", by year×room (inspectable, drill-down).
 *   3. avg 2nd-hand — scope="secondhand" (dealYear − yearBuilt ≥ secondhand_min_age,
 *      default 4 — this comment said 3 while the code always used 4), by year×room.
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
  partialYears: number[];                  // years still filling up (current year, <11 months) — labelled, not excluded
  lastFullYear: number | null;             // latest year with a complete 12 months
  /**
   * The latest year usable as a comparison endpoint.
   *
   * This is NOT the same as the last FULL year, and the difference is the
   * point. ₪/m² is a RATE, not a total: seven months of deals produce the same
   * kind of number as twelve, just from a smaller sample. Refusing to compare
   * against the running year threw away the freshest price level the site has
   * — in cities with hundreds of 2026 deals — and pinned every headline to a
   * year that gets staler every day.
   *
   * A partial year qualifies when it has enough MONTHS to not be a single
   * season (partial_year_min_months) and its cells clear the usual n floor.
   * Volume figures still use full years only: those DO scale with time, and
   * comparing seven months of deal COUNT against twelve is simply wrong.
   */
  lastUsableYear: number | null;
  /** year → distinct months of data, so the UI can say "7 חודשים" rather than just "partial" */
  monthsByYear: Record<number, number>;
}

export interface NadlanDeal {
  /** row id — what a pin on the map points at. Optional: the series loaders
   *  that never show a single deal do not select it. */
  id?: number;
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
  /**
   * Address, as reported to the Tax Authority.
   *
   * This is the evidence. Everything else on the page is a statistic — a
   * number a reader has to trust — while "רחוב הרצל 14, קומה 3, ₪2.1M" is a
   * fact they can check against a listing they saw last week. It was collected,
   * stored, and shown only inside the private /deals workspace; the drill-down
   * that exists to prove the averages are real was withholding the proof.
   */
  street?: string | null;
  houseNum?: string | null;
  neighborhood?: string | null;
  floor?: string | null;
}

/**
 * Which year may serve as the endpoint of a comparison.
 *
 * A partial year earns its place on evidence, per city: enough MONTHS not to be
 * a single season, and enough deals in the headline cell to be a price rather
 * than an anecdote. Cities whose running year is genuinely thin fall back to
 * the last full year, exactly as before.
 *
 * Pure and exported so it can be tested without a database — the failure mode
 * here is a plausible-but-wrong year, which no crash would announce. Its twin
 * lives in scripts/report-partial-year.ts; the two must agree.
 */
export function pickLastUsableYear({
  years, partialYears, lastFullYear, monthsOf, headlineNOf, minMonths, minDeals,
}: {
  years: number[];
  partialYears: number[];
  lastFullYear: number | null;
  monthsOf: (year: number) => number;
  headlineNOf: (year: number) => number;
  minMonths: number;
  minDeals: number;
}): number | null {
  const partial = new Set(partialYears);
  const usable = years.filter(
    (y) => !partial.has(y) || (monthsOf(y) >= minMonths && headlineNOf(y) >= minDeals)
  );
  return usable.length ? usable[usable.length - 1] : lastFullYear;
}

/**
 * Can this deal be classified as second-hand or new?
 *
 * ONLY a usable build year qualifies (operator rule, 8/2026). The Tax
 * Authority also publishes a Sale-Law flag and previous-deal history, and
 * scripts/classify-sale-channel.ts still uses them to fill `is_secondhand` —
 * but inference no longer decides what the price graph calls second-hand or
 * new. The site states "classified by build year", and a series partly built
 * on inference could not honestly be described that way.
 *
 * Zero is how "unknown" is published (30% of Tirat Karmel, 46% of Akko) and
 * must never be read as the year 0 — that would make every such deal a
 * two-thousand-year-old flat, i.e. second-hand, i.e. exactly wrong.
 */
export function isClassifiable(yearBuilt: number | null | undefined): boolean {
  return (yearBuilt ?? 0) > 1800;
}

/**
 * Second-hand, new, or neither — the whole rule, in one place.
 * Returns null for a deal that cannot be classified; that deal belongs only to
 * the "all" series.
 */
export function classifyDeal(
  yearBuilt: number | null | undefined,
  dealYear: number,
  minAge: number
): "secondhand" | "new" | null {
  if (!isClassifiable(yearBuilt)) return null;
  return dealYear - (yearBuilt as number) >= minAge ? "secondhand" : "new";
}

function emptyRoomSeries(): RoomSeries {
  return { "3": [], "4": [], "5": [], all: [] };
}

async function loadCityGraphSeriesUncached(cityName: string): Promise<CityGraphData> {
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

  const lastUsableYear = pickLastUsableYear({
    years: nadlanYears,
    partialYears,
    lastFullYear,
    monthsOf: (y) => monthsByYear.get(y) ?? 0,
    headlineNOf: (y) =>
      nadlan.all.all.find((p) => p.year === y)?.n
      ?? nadlan.all_govmap.all.find((p) => p.year === y)?.n
      ?? 0,
    minMonths: getRuleNum("partial_year_min_months", 4),
    minDeals: getRuleNum("min_deals_per_year", 10),
  });

  return {
    cityName, median, nadlan,
    nadlanYears,
    partialYears,
    lastFullYear,
    lastUsableYear,
    monthsByYear: Object.fromEntries(monthsByYear),
  };
}

/** Three queries per city, all against nightly-refreshed tables — cached. */
export const loadCityGraphSeries = cachedMarket(loadCityGraphSeriesUncached, ["city-graph-series"]);

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
async function loadCityDealsUncached(cityName: string, limit = DRAWER_PAGE): Promise<NadlanDeal[]> {
  const rows = await prisma.nadlan_transactions.findMany({
    // admin exclusions never reach the UI (null = legacy rows, treated as included)
    where: { city_name: cityName, OR: [{ excluded: null }, { excluded: 0 }] },
    // Explicit, not `*`. Prisma validates every returned column against the
    // schema and throws P2023 for the whole row on a mismatch — so an unused
    // column with one bad value 500s the page it is not even shown on. Asking
    // only for what the drawer renders bounds that blast radius, and the
    // column-types pipeline stage keeps these ones honest.
    select: {
      deal_date: true, deal_year: true, rooms: true, room_bucket: true,
      area: true, price: true, price_sqm: true, year_built: true,
      is_secondhand: true, source: true, luxury: true,
      street: true, house_num: true, neighborhood: true, floor: true,
    },
    orderBy: [{ deal_date: "desc" }],
    take: limit,
  });
  return rows.map(toDeal);
}

/** First drawer page — same rows for every visitor until the data changes. */
export const loadCityDeals = cachedMarket(loadCityDealsUncached, ["city-deals-page"]);

// is_secondhand/luxury arrive as boolean through Prisma and as 0/1 through raw SQL
function toDeal(r: {
  deal_date: string; deal_year: number; rooms: number | null; room_bucket: string;
  area: number | null; price: number | null; price_sqm: number | null;
  year_built: number | null; is_secondhand: number | boolean; source: string | null;
  luxury?: number | boolean | null;
  street?: string | null; house_num?: string | null; neighborhood?: string | null; floor?: string | null;
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
    street: r.street ?? null,
    houseNum: r.house_num ?? null,
    neighborhood: r.neighborhood ?? null,
    floor: r.floor ?? null,
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
async function loadCityCleaningCountsUncached(cityName: string): Promise<{ dupes: number; luxury: number }> {
  // Cleaning now runs over the full history window, so the held-back counts
  // must cover the same range — a decade-scoped count under a 1998+ chart
  // would under-report what the reader is owed.
  const minYear = historyFromYear();
  const [row] = await prisma.$queryRawUnsafe<Array<{ dupes: bigint; luxury: bigint }>>(
    `SELECT SUM(CASE WHEN exclusion_reason LIKE 'כפילות-דיווח%' THEN 1 ELSE 0 END) dupes,
            SUM(CASE WHEN COALESCE(excluded,0)=0 AND COALESCE(luxury,0)=1 THEN 1 ELSE 0 END) luxury
     FROM nadlan_transactions WHERE city_name = ? AND deal_year >= ?`, cityName, minYear);
  return { dupes: Number(row?.dupes ?? 0), luxury: Number(row?.luxury ?? 0) };
}

/** Full-table aggregate for one city — cached; see lib/cache.ts for the rationale. */
export const loadCityCleaningCounts = cachedMarket(loadCityCleaningCountsUncached, ["city-cleaning-counts"]);

async function loadDealCountCubeUncached(cityName: string): Promise<DealCountCube> {
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

/**
 * The single most expensive query on the city page: an unbounded GROUP BY over
 * every non-excluded transaction in the city (~84k rows for Tel Aviv) that
 * yields under 2KB of counts. Ideal to cache.
 *
 * Note it reads `modern_min_year` — a cached cube therefore also freezes that
 * rule until the tag is invalidated. That is correct, not a bug: the rule only
 * changes what the data looks like after the pipeline re-runs, and the pipeline
 * invalidates this tag when it finishes.
 */
export const loadDealCountCube = cachedMarket(loadDealCountCubeUncached, ["deal-count-cube"]);
