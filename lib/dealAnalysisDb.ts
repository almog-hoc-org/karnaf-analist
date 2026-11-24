/**
 * analyzeDeal(id) — everything the deal page (app/deal/[id]) shows about one
 * reported sale: the row, its comparables at the time (lib/dealAnalysis.ts
 * rules), the neighbourhood and city that year, the building's other sales
 * and this flat's earlier ones, and what the same ₪/m² is worth today by the
 * area's index.
 *
 * One SQL query per ladder rung, stopping at the first rung with enough
 * comparables; the indexes (city_name, street) and (city_name, deal_date)
 * serve them.
 */
import { prisma, isMissingTable } from "./db";
import { getRuleNum } from "./systemRules";
import { normHouse } from "./addressKey";
import { DEAL_COLS, toDeal, resolveStreet, loadBuildingPage, type RawDeal } from "./addressPages";
import { loadNeighborhoodCells } from "./neighborhoods";
import type { AddressDeal, ApartmentThread } from "./buildingRules";
import {
  COMP_MIN, COMP_WINDOW_MONTHS, RUNG_ORDER, compConfidence, compStats, percentileOf, pickComps, timeAdjustAny, verdict,
  type CompConfidence, type CompPick, type CompRung, type Verdict,
} from "./dealAnalysis";

export interface DealRecord extends AddressDeal {
  cityName: string;
  source: string | null;
  excluded: boolean;
  exclusionReason: string | null;
  parcel: string | null;
}

export interface DealComps {
  rung: CompRung;
  enough: boolean;
  n: number;
  medianSqm: number | null;
  spread: [number, number] | null;
  percentile: number | null;
  deltaPct: number | null;
  verdict: Verdict | null;
  confidence: CompConfidence;
  unadjusted: number;
  rows: AddressDeal[];
}

export interface DealAnalysis {
  deal: DealRecord;
  /** register details when the row came from (or was matched to) the tax register */
  register: { declaredAmount: number | null; nature: string | null; portion: number | null } | null;
  comps: DealComps | null;
  /** the neighbourhood's / city's second-hand ₪/m² in the deal's year */
  baseline: { hood: string | null; hoodSqm: number | null; hoodN: number | null; citySqm: number | null; cityN: number | null; year: number };
  /** the deal's ₪/m² moved to the latest year the index has */
  today: { year: number; sqm: number; price: number | null; changePct: number } | null;
  /** the area's yearly series used for the chart and the adjustments */
  series: Array<{ year: number; hood: number | null; city: number | null }>;
  building: { street: string; houseLabel: string; hood: string | null; deals: AddressDeal[]; thread: ApartmentThread | null } | null;
}

const MIN_SERIES_N = 10;

async function loadDeal(id: number): Promise<DealRecord | null> {
  const rows = await prisma.$queryRawUnsafe<Array<RawDeal & {
    city_name: string; source: string | null; excluded: number | null; exclusion_reason: string | null; parcel_num: string | null;
  }>>(
    `SELECT ${DEAL_COLS}, city_name, source, COALESCE(excluded,0) excluded, exclusion_reason, parcel_num
       FROM nadlan_transactions WHERE id = ?`,
    id
  );
  const r = rows[0];
  if (!r) return null;
  return {
    ...toDeal(r), cityName: String(r.city_name), source: r.source,
    excluded: !!Number(r.excluded), exclusionReason: r.exclusion_reason, parcel: r.parcel_num,
  };
}

async function loadRegister(id: number): Promise<DealAnalysis["register"]> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ declared_amount: number | null; nature: string | null; portion: number | null }>>(
      `SELECT m.declared_amount, m.nature, m.portion FROM nadlan_transactions t
         JOIN mekarkein_deals m ON m.id = t.mekarkein_id WHERE t.id = ?`,
      id
    );
    const r = rows[0];
    return r ? { declaredAmount: r.declared_amount == null ? null : Number(r.declared_amount), nature: r.nature, portion: r.portion == null ? null : Number(r.portion) } : null;
  } catch { return null; } // no register table / column on this database
}

/**
 * The city's second-hand ₪/m² by year (room bucket "all"), years with enough
 * deals — or, for a city whose deals carry no build year to split by, all of
 * its deals.
 */
async function citySeries(cityName: string): Promise<Map<number, { sqm: number; n: number }>> {
  const by = { secondhand: new Map<number, { sqm: number; n: number }>(), all: new Map<number, { sqm: number; n: number }>() };
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ scope: "secondhand" | "all"; year: number; median_sqm: number | null; avg_sqm: number | null; n: number }>>(
      `SELECT scope, year, median_sqm, avg_sqm, n FROM nadlan_year_room_stats
        WHERE city_name = ? AND scope IN ('secondhand', 'all') AND room_bucket = 'all'`,
      cityName
    );
    for (const r of rows) {
      const v = r.median_sqm ?? r.avg_sqm;
      if (v && Number(r.n) >= MIN_SERIES_N) by[r.scope].set(Number(r.year), { sqm: Number(v), n: Number(r.n) });
    }
  } catch (e) { if (!isMissingTable(e)) throw e; }
  return by.secondhand.size ? by.secondhand : by.all;
}

export interface AreaSeries {
  hoodYears: Map<number, { sqm: number; n: number }>;
  cityYears: Map<number, { sqm: number; n: number }>;
  hoodMap: Map<number, number>;
  cityMap: Map<number, number>;
  /** the latest year either series prices */
  latest: number | null;
}

/**
 * The yearly ₪/m² series a price is moved through time by: the
 * neighbourhood's second-hand cells (or all its deals where the split is
 * unavailable), then the city's. Years with fewer than MIN_SERIES_N deals
 * are not an index.
 */
export async function areaSeries(city: string, hood: string | null): Promise<AreaSeries> {
  const [shCells, allCells, cityYears] = await Promise.all([
    hood ? loadNeighborhoodCells(city, "secondhand") : Promise.resolve([]),
    hood ? loadNeighborhoodCells(city, "all") : Promise.resolve([]),
    citySeries(city),
  ]);
  const hoodSeries = (cells: typeof shCells) => {
    const m = new Map<number, { sqm: number; n: number }>();
    for (const c of cells) if (c.neighborhood === hood && c.sqm && c.n >= MIN_SERIES_N) m.set(c.year, { sqm: c.sqm, n: c.n });
    return m;
  };
  const sh = hoodSeries(shCells);
  const hoodYears = sh.size ? sh : hoodSeries(allCells);
  const hoodMap = new Map([...hoodYears].map(([y, v]) => [y, v.sqm]));
  const cityMap = new Map([...cityYears].map(([y, v]) => [y, v.sqm]));
  const years = [...hoodMap.keys(), ...cityMap.keys()];
  return { hoodYears, cityYears, hoodMap, cityMap, latest: years.length ? Math.max(...years) : null };
}

export async function analyzeDeal(id: number): Promise<DealAnalysis | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const found = await loadDeal(id);
  if (!found) return null;
  const deal: DealRecord = found;
  const city = deal.cityName;
  const house = normHouse(deal.houseNum).primary;

  const [register, building] = await Promise.all([
    loadRegister(id),
    deal.street && house ? loadBuildingPage(city, deal.street, deal.houseNum!) : Promise.resolve(null),
  ]);
  const hood = deal.neighborhood ?? building?.hood ?? null;
  const { hoodYears, cityYears, hoodMap, cityMap } = await areaSeries(city, hood);
  const seriesList = [hoodMap, cityMap];

  // ── comparables, rung by rung ──
  const minSqm = Number(getRuleNum("min_sqm_price", 2000)) || 0;
  const base = [
    "city_name = ?", "COALESCE(excluded,0) = 0", "COALESCE(luxury,0) = 0", `price_sqm > ${minSqm}`, "id != ?",
    `deal_date BETWEEN date(?, '-${COMP_WINDOW_MONTHS} months') AND date(?, '+${COMP_WINDOW_MONTHS} months')`,
  ];
  const baseParams: unknown[] = [city, id, deal.dealDate, deal.dealDate];
  if (deal.rooms != null && deal.rooms > 0) { base.push("rooms IS NOT NULL AND ABS(rooms - ?) <= 0.25"); baseParams.push(deal.rooms); }
  const spellings = deal.street ? (await resolveStreet(city, deal.street))?.spellings ?? [] : [];

  async function rungRows(rung: CompRung): Promise<AddressDeal[] | null> {
    const conds = [...base], params = [...baseParams];
    if (rung === "building" || rung === "street") {
      if (!spellings.length || (rung === "building" && !house)) return null;
      conds.push(`street IN (${spellings.map(() => "?").join(",")})`);
      params.push(...spellings);
    } else if (rung === "neighborhood") {
      if (!hood) return null;
      conds.push("neighborhood = ?");
      params.push(hood);
    }
    const rows = await prisma.$queryRawUnsafe<RawDeal[]>(
      `SELECT ${DEAL_COLS} FROM nadlan_transactions WHERE ${conds.join(" AND ")}
        ORDER BY ABS(julianday(deal_date) - julianday(?)) LIMIT 3000`,
      ...params, deal.dealDate
    ).catch(() => [] as RawDeal[]);
    const out = rows.map(toDeal);
    return rung === "building"
      ? out.filter((d) => { const h = normHouse(d.houseNum); return h.primary === house || h.alts.includes(house); })
      : out;
  }

  let pick: CompPick<AddressDeal> | null = null;
  for (const rung of RUNG_ORDER) {
    const rows = await rungRows(rung);
    if (!rows) continue;
    const p = pickComps(deal, [{ rung, rows }], COMP_MIN);
    if (p) pick = p;
    if (p?.enough) break;
  }

  let comps: DealComps | null = null;
  if (pick) {
    const st = compStats(pick.comps, deal.dealYear, seriesList);
    const own = deal.luxury ? null : deal.priceSqm;
    const enough = pick.enough && st.n >= COMP_MIN;
    const deltaPct = enough && own && st.medianSqm ? (own / st.medianSqm - 1) * 100 : null;
    comps = {
      rung: pick.rung, enough, n: st.n, medianSqm: st.medianSqm, spread: st.spread,
      percentile: enough && own ? percentileOf(own, st.values) : null,
      deltaPct, verdict: verdict(deltaPct), confidence: compConfidence(st.n), unadjusted: st.unadjusted,
      rows: [...pick.comps].sort((a, b) => b.dealDate.localeCompare(a.dealDate)).slice(0, 25),
    };
  }

  // ── value today by the index ──
  const years = [...new Set([...hoodMap.keys(), ...cityMap.keys()])].sort((a, b) => a - b);
  const latest = years.at(-1) ?? 0;
  let today: DealAnalysis["today"] = null;
  if (deal.priceSqm && latest > deal.dealYear) {
    const sqm = timeAdjustAny(deal.priceSqm, deal.dealYear, latest, seriesList);
    if (sqm) today = { year: latest, sqm, price: deal.area ? sqm * deal.area : null, changePct: (sqm / deal.priceSqm - 1) * 100 };
  }

  const thread = building?.threads.find((t) => t.deals.some((d) => d.id === id)) ?? null;

  return {
    deal, register, comps,
    baseline: {
      hood, year: deal.dealYear,
      hoodSqm: hoodYears.get(deal.dealYear)?.sqm ?? null, hoodN: hoodYears.get(deal.dealYear)?.n ?? null,
      citySqm: cityYears.get(deal.dealYear)?.sqm ?? null, cityN: cityYears.get(deal.dealYear)?.n ?? null,
    },
    today,
    series: years.map((y) => ({ year: y, hood: hoodMap.get(y) ?? null, city: cityMap.get(y) ?? null })),
    building: building ? { street: building.street, houseLabel: building.houseLabel, hood: building.hood, deals: building.deals, thread } : null,
  };
}
