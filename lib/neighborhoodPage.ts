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
  n: number | null;
  changePct: number | null;
  fromYear: number | null;
  /** the city's own level in refYear, from the same cells */
  citySqm: number | null;
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

  const rankedRows = summary.rows.map((r) => ({ neighborhood: r.neighborhood, sqm: r.sqm }));

  return {
    canonical,
    data: {
      neighborhood: canonical,
      cityName,
      scope,
      trend: mine.map((c) => ({
        year: c.year, sqm: c.sqm, medianSqm: c.medianSqm, medianPrice: c.medianPrice, n: c.n,
      })),
      refYear,
      sqm: at?.sqm ?? null,
      medianPrice: at?.medianPrice ?? null,
      n: at?.n ?? null,
      changePct,
      fromYear: base ? base.year : null,
      citySqm: summary.citySqm,
      rank: hoodRank(canonical, rankedRows),
      rankOf: rankedRows.length,
      siblings: summary.rows.map((r) => r.neighborhood).filter((n) => n !== canonical),
    },
  };
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
