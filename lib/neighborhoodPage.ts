import { prisma } from "./db";
import { cachedMarket } from "./cache";
import { getRuleNum } from "./systemRules";
import { normHoodKey } from "./hoodKey";
import { loadNeighborhoodCells, neighborhoodSummary } from "./neighborhoods";
import { pickLastUsableYear, type NadlanDeal } from "./nadlanTransactionSeries";

/**
 * Everything the neighbourhood PAGE needs, and nothing the city page already
 * loads better.
 *
 * THE SPELLING IS THE KEY. A neighbourhood has no id anywhere in this system —
 * the Tax Authority's spelling of its name keys the stats table, the deals
 * table, and now the URL. Which means the URL can arrive in a reader's
 * spelling ("נוה צדק") and must land on ours ("נווה צדק"): resolveHoodName
 * answers with the canonical string via normHoodKey, and the page redirects
 * to it rather than serving the same content under two addresses.
 *
 * THE LAST POINT ON THE CHART MUST BE A REAL YEAR. neighborhoodSummary takes
 * max(year) with no guard, which is fine for a table cell labelled with its
 * year — but a trend chart's rightmost point reads as "now", and a
 * two-month sample rendered as a year is a confident lie about the present.
 * The reference year here goes through pickLastUsableYear — the exact rule
 * the city page uses — with the neighbourhood's own n as the sample floor.
 */

export interface HoodTrendPoint {
  year: number;
  sqm: number | null;
  medianSqm: number | null;
  medianPrice: number | null;
  avgPrice: number | null;
  n: number;
}

export interface HoodPageData {
  /** canonical Tax Authority spelling */
  neighborhood: string;
  cityName: string;
  scope: "secondhand" | "all";
  /** every year, ascending — holes stay holes for the chart to show */
  trend: HoodTrendPoint[];
  /** the year the headline numbers describe (partial-year guarded) */
  refYear: number | null;
  sqm: number | null;
  medianPrice: number | null;
  /** average whole-deal price at refYear — shown beside the ₪/m² figure */
  avgPrice: number | null;
  n: number | null;
  changePct: number | null;
  fromYear: number | null;
  /** the city's own level in refYear, from the same cells */
  citySqm: number | null;
  /** the CITY's ₪/m² change over the same window — the baseline the hood's
   *  changePct is judged against. From the same neighbourhood cells (weighted
   *  by n), never from the city stats table, which counts deals with no
   *  neighbourhood at all. */
  cityChangePct: number | null;
  /** 1-based position by ₪/m² among the city's priced neighbourhoods, and the total */
  rank: number | null;
  rankOf: number;
  /** the city's other priced neighbourhoods, for the footer nav (canonical spellings) */
  siblings: string[];
}

/**
 * A reader's spelling → the canonical one, or null when the city has no such
 * neighbourhood. Exact match wins before normalisation so two real
 * neighbourhoods that normalise identically (rare, but the collapse of יי/וו
 * makes it possible) each keep their own page.
 */
export function resolveHoodName(requested: string, known: string[]): string | null {
  if (known.includes(requested)) return requested;
  const want = normHoodKey(requested);
  return known.find((k) => normHoodKey(k) === want) ?? null;
}

/** 1-based rank of `hood` by descending ₪/m². Ties share the better rank. */
export function hoodRank(hood: string, rows: Array<{ neighborhood: string; sqm: number }>): number | null {
  const mine = rows.find((r) => r.neighborhood === hood);
  if (!mine) return null;
  return 1 + rows.filter((r) => r.sqm > mine.sqm).length;
}

export async function loadHoodPage(
  cityName: string,
  requestedHood: string,
  scope: "secondhand" | "all" = "secondhand"
): Promise<{ data: HoodPageData | null; canonical: string | null }> {
  const [cells, summary] = await Promise.all([
    loadNeighborhoodCells(cityName, scope),
    neighborhoodSummary(cityName, { scope, years: 3 }),
  ]);
  const known = [...new Set(cells.map((c) => c.neighborhood))];
  const canonical = resolveHoodName(requestedHood, known);
  if (!canonical) return { data: null, canonical: null };

  const mine = cells
    .filter((c) => c.neighborhood === canonical)
    .sort((a, b) => a.year - b.year);

  // Partial-year guard, the city's own rule. The stats table has no month
  // granularity, so "partial" here is simply the current calendar year, and
  // the floor is the same admin rule the table's cells had to clear to exist.
  const nowYear = new Date().getFullYear();
  const years = mine.map((c) => c.year);
  const nOf = (y: number) => mine.find((c) => c.year === y)?.n ?? 0;
  const refYear = pickLastUsableYear({
    years,
    partialYears: years.filter((y) => y >= nowYear),
    lastFullYear: years.filter((y) => y < nowYear).at(-1) ?? null,
    monthsOf: () => 12, // unknown at this granularity — the deal floor decides
    headlineNOf: nOf,
    minMonths: 0,
    minDeals: getRuleNum("neighborhood_min_deals", 8),
  });

  const at = refYear == null ? null : mine.find((c) => c.year === refYear) ?? null;
  const span = 3;
  const base = refYear == null ? null : mine.find((c) => c.year === refYear - span) ?? null;
  const changePct =
    at?.sqm && base?.sqm && base.sqm > 0 ? (at.sqm / base.sqm - 1) * 100 : null;

  // The city's change over the SAME window, from the SAME cells: the weighted
  // city level at refYear and at refYear-span. The excess-growth figure the
  // page shows is hood-change minus this — two numbers from one population.
  const cityLevel = (year: number | null): number | null => {
    if (year == null) return null;
    const ys = cells.filter((c) => c.year === year && c.sqm != null && c.sqm > 0);
    const totalN = ys.reduce((t, c) => t + c.n, 0);
    return totalN > 0 ? ys.reduce((t, c) => t + c.sqm! * c.n, 0) / totalN : null;
  };
  const cityAt = cityLevel(refYear);
  const cityBase = cityLevel(refYear == null ? null : refYear - span);
  const cityChangePct =
    cityAt && cityBase && cityBase > 0 ? (cityAt / cityBase - 1) * 100 : null;

  const rankedRows = summary.rows.map((r) => ({ neighborhood: r.neighborhood, sqm: r.sqm }));

  return {
    canonical,
    data: {
      neighborhood: canonical,
      cityName,
      scope,
      trend: mine.map((c) => ({
        year: c.year, sqm: c.sqm, medianSqm: c.medianSqm, medianPrice: c.medianPrice, avgPrice: c.avgPrice, n: c.n,
      })),
      refYear,
      sqm: at?.sqm ?? null,
      medianPrice: at?.medianPrice ?? null,
      avgPrice: at?.avgPrice ?? null,
      n: at?.n ?? null,
      changePct,
      fromYear: base ? base.year : null,
      citySqm: summary.citySqm,
      cityChangePct,
      rank: hoodRank(canonical, rankedRows),
      rankOf: rankedRows.length,
      siblings: summary.rows.map((r) => r.neighborhood).filter((n) => n !== canonical),
    },
  };
}

export type HoodBucket = "all" | "3" | "4" | "5";
export type HoodScope = "secondhand" | "all" | "new";

/** scope → bucket → year-ascending points. Shipped whole so every filter flip
 *  on the page is client-side, zero requests. */
export type HoodSeries = Record<HoodScope, Record<HoodBucket, HoodTrendPoint[]>>;

/** The hood's own series AND the city's, same scopes × buckets — the city
 *  line is a chart overlay the reader can toggle (operator, 8/2026). */
export interface HoodSeriesBundle {
  hood: HoodSeries;
  city: HoodSeries;
}

const HOOD_SCOPES: HoodScope[] = ["secondhand", "all", "new"];
const HOOD_BUCKETS: HoodBucket[] = ["all", "3", "4", "5"];
const emptySeries = (): HoodSeries =>
  ({ secondhand: {}, all: {}, new: {} } as HoodSeries);

/**
 * The CITY's own year series for one scope×bucket, from the same stats table
 * the city charts read. Hood scope "all" maps to the city's "all" — or
 * "all_govmap" where that is the city's only headline series (govmap-only
 * cities); when both exist for a year, "all" wins.
 */
async function loadCityYearSeriesUncached(
  cityName: string,
  scope: HoodScope,
  bucket: HoodBucket
): Promise<HoodTrendPoint[]> {
  const cityScopes = scope === "all" ? ["all", "all_govmap"] : [scope];
  try {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT year, scope, avg_sqm, median_sqm, median_price, avg_price, n
         FROM nadlan_year_room_stats
        WHERE city_name = ? AND room_bucket = ? AND scope IN (${cityScopes.map(() => "?").join(",")})
        ORDER BY year`,
      cityName, bucket, ...cityScopes
    );
    const byYear = new Map<number, Record<string, unknown>>();
    for (const r of rows) {
      const y = Number(r.year);
      // "all" beats "all_govmap" for the same year; otherwise first wins
      if (!byYear.has(y) || String(r.scope) === "all") byYear.set(y, r);
    }
    return [...byYear.values()]
      .map((r) => ({
        year: Number(r.year),
        sqm: r.avg_sqm == null ? null : Number(r.avg_sqm),
        medianSqm: r.median_sqm == null ? null : Number(r.median_sqm),
        medianPrice: r.median_price == null ? null : Number(r.median_price),
        avgPrice: r.avg_price == null ? null : Number(r.avg_price),
        n: Number(r.n ?? 0),
      }))
      .sort((a, b) => a.year - b.year);
  } catch {
    return []; // stats table missing — the fixtureless dev DB
  }
}
const loadCityYearSeries = cachedMarket(loadCityYearSeriesUncached, ["city-year-series"]);

export async function loadHoodSeries(cityName: string, hood: string): Promise<HoodSeriesBundle> {
  const out: HoodSeriesBundle = { hood: emptySeries(), city: emptySeries() };
  await Promise.all(
    HOOD_SCOPES.flatMap((sc) =>
      HOOD_BUCKETS.flatMap((b) => [
        (async () => {
          const cells = await loadNeighborhoodCells(cityName, sc, b);
          out.hood[sc][b] = cells
            .filter((c) => c.neighborhood === hood)
            .sort((a, b2) => a.year - b2.year)
            .map((c) => ({
              year: c.year, sqm: c.sqm, medianSqm: c.medianSqm,
              medianPrice: c.medianPrice, avgPrice: c.avgPrice, n: c.n,
            }));
        })(),
        (async () => {
          out.city[sc][b] = await loadCityYearSeries(cityName, sc, b);
        })(),
      ])
    )
  );
  return out;
}

/** How many deals the server renders before "הצג עוד" takes over. */
export const HOOD_DEALS_FIRST_PAGE = 15;

/**
 * The first page of the neighbourhood's deals, server-side — the page must
 * carry real rows in its HTML rather than ask every visitor's browser to
 * spend a request (and a slice of the endpoint's rate limit) on paint.
 * Same columns, same exclusion rule and same ordering as the API route the
 * "הצג עוד" button continues through, so page two starts exactly where this
 * ended.
 */
async function loadHoodDealsUncached(
  cityName: string,
  neighborhood: string,
  scope: "secondhand" | "all" = "secondhand"
): Promise<{ deals: NadlanDeal[]; total: number }> {
  const scopeCond = scope === "secondhand" ? "AND is_secondhand = 1" : "";
  try {
    const [rows, countRow] = await Promise.all([
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT deal_date, deal_year, rooms, room_bucket, area, price, price_sqm, year_built,
                is_secondhand, source, COALESCE(luxury,0) luxury, street, house_num, neighborhood, floor
           FROM nadlan_transactions
          WHERE city_name = ? AND neighborhood = ? AND COALESCE(excluded,0) = 0 ${scopeCond}
          ORDER BY deal_date DESC LIMIT ${HOOD_DEALS_FIRST_PAGE}`,
        cityName, neighborhood),
      prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*) n FROM nadlan_transactions
          WHERE city_name = ? AND neighborhood = ? AND COALESCE(excluded,0) = 0 ${scopeCond}`,
        cityName, neighborhood),
    ]);
    const deals: NadlanDeal[] = rows.map((r) => ({
      dealDate: String(r.deal_date),
      dealYear: Number(r.deal_year),
      rooms: r.rooms == null ? null : Number(r.rooms),
      roomBucket: String(r.room_bucket),
      area: r.area == null ? null : Number(r.area),
      price: r.price == null ? null : Number(r.price),
      priceSqm: r.price_sqm == null ? null : Number(r.price_sqm),
      yearBuilt: r.year_built == null ? null : Number(r.year_built),
      isSecondHand: !!Number(r.is_secondhand),
      source: String(r.source ?? "nadlan"),
      luxury: !!Number(r.luxury),
      street: r.street == null ? null : String(r.street),
      houseNum: r.house_num == null ? null : String(r.house_num),
      neighborhood: r.neighborhood == null ? null : String(r.neighborhood),
      floor: r.floor == null ? null : String(r.floor),
    }));
    return { deals, total: Number(countRow[0]?.n ?? 0) };
  } catch {
    return { deals: [], total: 0 }; // table missing — the fixtureless dev DB
  }
}

export const loadHoodDeals = cachedMarket(loadHoodDealsUncached, ["hood-first-deals"]);
