/**
 * Investor-oriented per-city metrics, ALL derived from data already in the DB:
 *  - appreciation windows + momentum (nadlan_year_room_stats, scope=all, room=all, avg_sqm)
 *  - new-build premium (scope new vs secondhand)
 *  - liquidity: deals per 1,000 households + 3y liquidity trend
 *  - supply pressure: gap % of demand (lib/gap-analysis fallback ladder)
 *  - data confidence (deal count + distinct years actually collected)
 *  - composite investor score 0–100 (percentile-weighted, transparent parts)
 *
 * Bound-checking is deliberate and aggressive (memory rule: never ship absurd KPIs):
 * year-over-year moves beyond ±80% are treated as data noise → null; premium is
 * clamped to a sane [-30%, +60%] window; liquidity capped at 200/1k households.
 * Cities missing an input get null for that part and "—" in the UI — never a fake 0.
 *
 * Reference period: latest FULL year (2026 is partial) — currently 2025.
 * Every consumer must label values with the window (memory rule: no unlabeled windows).
 */
import { prisma } from "./db";
import { computeAllCityGaps } from "./gap-analysis";
import { refYear } from "./refYear";

// The reference year is no longer defined here. It was `const REF_YEAR = 2025`,
// one of three independent copies that drifted apart. Import refYear() from
// lib/refYear instead — see that file for what the drift produced.

export interface InvestorMetrics {
  cityName: string;
  /** % change avg ₪/m² (scope=all): REF_YEAR vs REF_YEAR-1 */
  chg1y: number | null;
  /** % change avg ₪/m² (scope=all): REF_YEAR vs REF_YEAR-3 */
  chg3y: number | null;
  /** annualized 3y % */
  chg3yAnnual: number | null;
  /** momentum in percentage points: chg1y − chg3yAnnual (positive = accelerating) */
  momentum: number | null;
  /** new vs second-hand avg ₪/m² premium, latest year with both (≥10 deals each) */
  newPremiumPct: number | null;
  newPremiumYear: number | null;
  /** avg deals/year over the last 2 full years (scope=all) */
  dealsPerYear: number | null;
  /** deals per 1,000 households (households_2022) */
  liquidityPer1k: number | null;
  /** % change in yearly deal count: REF_YEAR vs REF_YEAR-3 */
  liquidityTrendPct: number | null;
  /** supply gap as % of demand over the gap window (positive = shortage) */
  gapPctOfDemand: number | null;
  gapSource: string;
  /** data confidence */
  nDeals: number;
  distinctYears: number;
  confidence: "high" | "medium" | "low";
  /** composite score 0–100 (null if fewer than 3 parts available) */
  score: number | null;
  /** each part is a 0–100 percentile among cities (null = missing input) */
  scoreParts: {
    appreciation: number | null; // chg3y percentile
    momentum: number | null;
    liquidity: number | null;   // liquidityPer1k percentile
    supply: number | null;      // shortage percentile (more shortage = higher)
    premium: number | null;     // INVERTED: lower premium = higher percentile (relative bargain on new)
  };
}

const SCORE_WEIGHTS = { appreciation: 0.3, momentum: 0.2, liquidity: 0.2, supply: 0.2, premium: 0.1 } as const;
const MAX_ABS_CHANGE = 80; // % — beyond this it's noise, not a market move
const MIN_N_PER_YEAR = 30; // a year-cell below this deal count is too thin to price from

type Cell = { avg: number | null; n: number } | undefined;

/** % change between two year-cells, gated on both being statistically usable. */
function pctCell(now: Cell, before: Cell): number | null {
  if (!now?.avg || !before?.avg || before.avg <= 0) return null;
  if (now.n < MIN_N_PER_YEAR || before.n < MIN_N_PER_YEAR) return null;
  const p = (now.avg / before.avg - 1) * 100;
  return Math.abs(p) > MAX_ABS_CHANGE ? null : p;
}

function percentileRank(values: number[], v: number): number {
  if (values.length === 0) return 50;
  let below = 0;
  for (const x of values) if (x < v) below++;
  return Math.round((below / values.length) * 100);
}

interface StatRow { city_name: string; year: number; scope: string; avg_sqm: number | null; n: number }

export async function computeAllInvestorMetrics(): Promise<Map<string, InvestorMetrics>> {
  // Resolved once per call: every window below must be measured against the
  // SAME year, or a 1y and a 3y change could straddle a rule edit mid-run.
  const ry = refYear();
  const [statRows, cities, gapList, coverage] = await Promise.all([
    prisma.$queryRawUnsafe<StatRow[]>(
      `SELECT city_name, year, scope, avg_sqm, n FROM nadlan_year_room_stats
       WHERE room_bucket='all' AND year BETWEEN ? AND ?`,
      ry - 4, ry
    ),
    prisma.city.findMany({ select: { city_name: true, households_2022: true } }),
    computeAllCityGaps().catch(() => []),
    prisma.$queryRawUnsafe<{ city_name: string; n: number; yrs: number }[]>(
      // coverage must count the SAME rows the stats were built from — an unfiltered
      // count credited cities for duplicates and unusable rows they never used
      `SELECT city_name, COUNT(*) n, COUNT(DISTINCT deal_year) yrs FROM nadlan_transactions
       WHERE COALESCE(excluded,0)=0 GROUP BY city_name`
    ),
  ]);

  // index stat rows: city → scope → year → {avg_sqm, n}
  const byCity = new Map<string, Map<string, Map<number, { avg: number | null; n: number }>>>();
  for (const r of statRows) {
    const c = byCity.get(r.city_name) ?? new Map();
    if (!byCity.has(r.city_name)) byCity.set(r.city_name, c);
    const s = c.get(r.scope) ?? new Map();
    if (!c.has(r.scope)) c.set(r.scope, s);
    s.set(Number(r.year), { avg: r.avg_sqm != null ? Number(r.avg_sqm) : null, n: Number(r.n) });
  }
  const hhMap = new Map(cities.map((c) => [c.city_name, c.households_2022 ? Number(c.households_2022) : null]));
  const gapMap = new Map(gapList.map((g) => [g.cityName, g]));
  const covMap = new Map(coverage.map((c) => [c.city_name, { n: Number(c.n), yrs: Number(c.yrs) }]));

  // pass 1 — raw per-city metrics
  const raw = new Map<string, InvestorMetrics>();
  for (const [city, scopes] of byCity) {
    const all = scopes.get("all");
    const get = (scope: string, y: number) => scopes.get(scope)?.get(y);

    const chg1y = pctCell(get("all", ry), get("all", ry - 1));
    const chg3y = pctCell(get("all", ry), get("all", ry - 3));
    const chg3yAnnual =
      chg3y != null ? (Math.pow(1 + chg3y / 100, 1 / 3) - 1) * 100 : null;
    const momentum = chg1y != null && chg3yAnnual != null ? chg1y - chg3yAnnual : null;

    // premium: latest year (down to REF_YEAR-2) where both scopes have ≥10 deals
    let newPremiumPct: number | null = null;
    let newPremiumYear: number | null = null;
    for (let y = ry; y >= ry - 2; y--) {
      const nw = get("new", y);
      const sh = get("secondhand", y);
      if (nw?.avg && sh?.avg && nw.n >= 10 && sh.n >= 10) {
        const p = (nw.avg / sh.avg - 1) * 100;
        if (p >= -30 && p <= 60) { newPremiumPct = p; newPremiumYear = y; }
        break;
      }
    }

    // liquidity
    const nRef = all?.get(ry)?.n ?? 0;
    const nPrev = all?.get(ry - 1)?.n ?? 0;
    const dealsPerYear = nRef > 0 || nPrev > 0 ? Math.round((nRef + nPrev) / ((nRef > 0 ? 1 : 0) + (nPrev > 0 ? 1 : 0))) : null;
    const hh = hhMap.get(city);
    let liquidityPer1k =
      dealsPerYear != null && hh && hh > 0 ? (dealsPerYear / hh) * 1000 : null;
    if (liquidityPer1k != null && (liquidityPer1k < 0 || liquidityPer1k > 200)) liquidityPer1k = null;
    const n3ago = all?.get(ry - 3)?.n ?? 0;
    const liquidityTrendPct = nRef >= 30 && n3ago >= 30 ? (nRef / n3ago - 1) * 100 : null;

    const gap = gapMap.get(city);
    const gapPct = gap?.totals.gapPctOfDemand ?? null;
    const cov = covMap.get(city) ?? { n: 0, yrs: 0 };
    const confidence: InvestorMetrics["confidence"] =
      cov.n >= 3000 && cov.yrs >= 8 ? "high" : cov.n >= 800 && cov.yrs >= 5 ? "medium" : "low";

    raw.set(city, {
      cityName: city,
      chg1y, chg3y, chg3yAnnual, momentum,
      newPremiumPct, newPremiumYear,
      dealsPerYear, liquidityPer1k, liquidityTrendPct,
      gapPctOfDemand: gapPct != null && Math.abs(gapPct) <= 400 ? gapPct : null,
      gapSource: gap?.totals.chosenSource ?? "none",
      nDeals: cov.n, distinctYears: cov.yrs, confidence,
      score: null,
      scoreParts: { appreciation: null, momentum: null, liquidity: null, supply: null, premium: null },
    });
  }

  // pass 2 — percentile parts + weighted score
  const pool = [...raw.values()];
  const vecs = {
    appreciation: pool.map((m) => m.chg3y).filter((v): v is number => v != null),
    momentum: pool.map((m) => m.momentum).filter((v): v is number => v != null),
    liquidity: pool.map((m) => m.liquidityPer1k).filter((v): v is number => v != null),
    supply: pool.map((m) => m.gapPctOfDemand).filter((v): v is number => v != null),
    premium: pool.map((m) => m.newPremiumPct).filter((v): v is number => v != null),
  };
  for (const m of pool) {
    const parts = m.scoreParts;
    if (m.chg3y != null) parts.appreciation = percentileRank(vecs.appreciation, m.chg3y);
    if (m.momentum != null) parts.momentum = percentileRank(vecs.momentum, m.momentum);
    if (m.liquidityPer1k != null) parts.liquidity = percentileRank(vecs.liquidity, m.liquidityPer1k);
    if (m.gapPctOfDemand != null) parts.supply = percentileRank(vecs.supply, m.gapPctOfDemand);
    if (m.newPremiumPct != null) parts.premium = 100 - percentileRank(vecs.premium, m.newPremiumPct);

    // weighted score over available parts (reweighted); need ≥3 parts AND
    // real data depth — thin-data localities must not outrank actual cities.
    let wSum = 0, acc = 0, count = 0;
    for (const k of Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]) {
      const v = parts[k];
      if (v != null) { acc += v * SCORE_WEIGHTS[k]; wSum += SCORE_WEIGHTS[k]; count++; }
    }
    m.score =
      count >= 3 && wSum > 0 && m.confidence !== "low"
        ? Math.round(Math.min(100, Math.max(0, acc / wSum)))
        : null;
  }

  return raw;
}

/** Provenance caption for investor metrics (memory rule: source • period • update). */
/** A function: as a const the year was interpolated once at import time. */
export function investorProvenance(): string {
  return `מאגר העסקאות הפנימי (רשות המסים + נדל"ן) · שנת ייחוס ${refYear()} · היצע: למ"ס`;
}
