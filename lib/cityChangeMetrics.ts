import { prisma } from "./db";
import { loadThinSampleCities } from "./cityTransactionPrices";

/**
 * Per-city yearly value series for the cities-table windowed price-change columns
 * (1/3/5/10 yr per column). All from the COLLECTED nadlan transactions (no govmap):
 *   - all               : avg ₪/m² of ALL deals              → nadlan_year_room_stats (scope="all",  room="all")
 *   - secondhand        : avg ₪/m² of second-hand deals      → scope="secondhand" (year-cells with n≥10 only)
 *   - secondhand_median : median ₪/m² of second-hand deals   → scope="secondhand" (year-cells with n≥10 only)
 *   - new               : avg ₪/m² of new (first-hand)       → scope="new"
 *   - median            : official nadlan median ₪ (opt)     → nadlan_price_trends
 * The client computes change = (latest − latest−W)/(latest−W). Sparse windows → "—".
 *
 * SECOND-HAND FIRST (site directive): price-change comparisons/rankings are based on
 * second-hand deals — the general average is biased upward when a new expensive
 * neighborhood is built in an otherwise old city.
 */

export type ChangeMetric = "all" | "secondhand" | "new" | "median" | "secondhand_median";
/** year → value */
export type YearValue = Record<number, number>;
export interface CityChangeMetrics {
  all: YearValue;
  secondhand: YearValue;
  new: YearValue;
  median: YearValue;
  secondhand_median: YearValue;
}

/** A second-hand year-cell below this deal count is too thin to price from. */
const SH_MIN_N = 10;

export async function loadCitiesChangeMetrics(): Promise<Map<string, CityChangeMetrics>> {
  const out = new Map<string, CityChangeMetrics>();
  const ensure = (city: string): CityChangeMetrics => {
    let m = out.get(city);
    if (!m) { m = { all: {}, secondhand: {}, new: {}, median: {}, secondhand_median: {} }; out.set(city, m); }
    return m;
  };

  // all / secondhand / new — collected nadlan ₪/m² by year (room "all").
  // Second-hand cells (avg AND median) are gated on n≥10 — thin years are noise.
  const statRows = await prisma.nadlan_year_room_stats.findMany({
    where: { room_bucket: "all" },
    select: { city_name: true, year: true, scope: true, avg_sqm: true, median_sqm: true, n: true },
  });
  for (const r of statRows) {
    if (r.scope === "all" || r.scope === "new") {
      if (r.avg_sqm != null) ensure(r.city_name)[r.scope][r.year] = r.avg_sqm;
    } else if (r.scope === "secondhand") {
      if (r.n < SH_MIN_N) continue;
      const m = ensure(r.city_name);
      if (r.avg_sqm != null) m.secondhand[r.year] = r.avg_sqm;
      if (r.median_sqm != null) m.secondhand_median[r.year] = r.median_sqm;
    }
  }
  // MIX-ADJUSTED override (verified 2026-07-29): the raw second-hand series is inflated
  // by sample-composition drift (TLV showed +12.3% while identical apartments did ~+3%).
  // Where the fixed-basket series exists it REPLACES the raw values for change metrics.
  for (const r of statRows) {
    if (r.scope !== "secondhand_fixedmix" || r.median_sqm == null || r.n < SH_MIN_N) continue;
    const m = ensure(r.city_name);
    m.secondhand[r.year] = r.median_sqm;
    m.secondhand_median[r.year] = r.median_sqm;
  }

  // median — official nadlan (avg quarters → yearly median total ₪)
  const medRows = await prisma.nadlan_price_trends.findMany({
    where: { median_price: { not: null, gt: 0 } },
    select: { city_name: true, year: true, median_price: true },
  });
  const medAgg = new Map<string, Map<number, { sum: number; n: number }>>();
  for (const r of medRows) {
    if (r.median_price == null) continue;
    let ym = medAgg.get(r.city_name);
    if (!ym) { ym = new Map(); medAgg.set(r.city_name, ym); }
    const cur = ym.get(r.year) ?? { sum: 0, n: 0 };
    cur.sum += r.median_price; cur.n += 1; ym.set(r.year, cur);
  }
  for (const [city, ym] of medAgg) {
    const m = ensure(city);
    for (const [year, v] of ym) m.median[year] = v.sum / v.n;
  }

  return out;
}

/* ── Second-hand windowed changes (site-wide comparison basis) ───────────── */

/** Latest COMPLETE deal-year in the DB (2026 is partial). */
export const SH_REF_YEAR = 2025;
/** |Δ%| beyond this is data noise, not a market move (memory rule: verify KPIs). */
const SH_MAX_ABS_CHANGE = 80;

export interface SecondhandChange {
  city_name: string;
  /** % change of second-hand ₪/m² (room "all"): refYear vs refYear−win. */
  pct: number;
  fromY: number;
  toY: number;
}

/**
 * Δ% of second-hand ₪/m² per city over a fixed window ending at SH_REF_YEAR.
 * Gates: room="all", scope="secondhand", n≥10 in BOTH year-cells, |Δ%| ≤ 80,
 * and the city_min_total_deals rule (thin-sample cities never emit a change —
 * they are yellow in tables and excluded from every ranking/KPI consumer).
 * `field` picks avg (default) or median ₪/m². Sorted descending by pct.
 */
export async function loadSecondhandChanges(
  win: number,
  field: "avg_sqm" | "median_sqm" = "avg_sqm",
  refYear: number = SH_REF_YEAR
): Promise<SecondhandChange[]> {
  const fromYear = refYear - win;
  const thinCities = await loadThinSampleCities();
  const rows = await prisma.nadlan_year_room_stats.findMany({
    where: {
      scope: { in: ["secondhand", "secondhand_fixedmix"] },
      room_bucket: "all",
      year: { in: [fromYear, refYear] },
      n: { gte: SH_MIN_N },
    },
    select: { city_name: true, year: true, scope: true, avg_sqm: true, median_sqm: true },
  });

  // mix-adjusted values win over raw ones (composition-drift fix, 2026-07-29)
  const byCity = new Map<string, { from?: number; to?: number; fromAdj?: boolean; toAdj?: boolean }>();
  for (const r of rows) {
    const adj = r.scope === "secondhand_fixedmix";
    const v = adj ? r.median_sqm : field === "avg_sqm" ? r.avg_sqm : r.median_sqm;
    if (v == null || v <= 0) continue;
    const cur = byCity.get(r.city_name) ?? {};
    if (r.year === fromYear) { if (adj || !cur.fromAdj) { cur.from = v; cur.fromAdj = cur.fromAdj || adj; } }
    else { if (adj || !cur.toAdj) { cur.to = v; cur.toAdj = cur.toAdj || adj; } }
    byCity.set(r.city_name, cur);
  }

  const out: SecondhandChange[] = [];
  for (const [city_name, c] of byCity) {
    if (thinCities.has(city_name)) continue; // city_min_total_deals rule
    if (c.from == null || c.to == null) continue;
    const pct = (c.to / c.from - 1) * 100;
    if (!Number.isFinite(pct) || Math.abs(pct) > SH_MAX_ABS_CHANGE) continue;
    out.push({ city_name, pct, fromY: fromYear, toY: refYear });
  }
  return out.sort((a, b) => b.pct - a.pct);
}
