/**
 * THE site's price axis — per-city price levels derived from REAL collected
 * transactions (nadlan_year_room_stats), replacing every old-Excel price field.
 *
 * Four separate metrics per city (user rule: shown separately, user picks):
 *   - avgAllSqm        ממוצע כללי ₪/מ"ר   (scope=all)
 *   - medianAllSqm     חציון כללי ₪/מ"ר   (scope=all)
 *   - avgShSqm         ממוצע יד-2 ₪/מ"ר   (scope=secondhand)  ← comparison basis
 *   - medianShSqm      חציון יד-2 ₪/מ"ר   (scope=secondhand)  ← comparison basis
 * plus coverage (deal counts + year span) so every consumer can show
 * "מבוסס N עסקאות · שנים X–Y" and flag thin cities loudly.
 *
 * Reference period = latest FULL year with data per city (2026 is partial —
 * we prefer REF_YEAR but fall back a year when a city's collection lags).
 * Year-cells below MIN_N deals are ignored (never price from noise).
 */
import { prisma } from "./db";
import { getRuleNum, getRuleBool } from "./systemRules";

/**
 * These are FUNCTIONS, not module-level constants, and that distinction is the
 * whole point.
 *
 * They used to be `const`s initialised by calling getRuleNum at import time. ES
 * module top-level code runs exactly once per process, so the value was a
 * snapshot of system_rules taken at server start and frozen for the process
 * lifetime. setRule() calls invalidateRuleCache(), but that invalidation could
 * never reach a binding that would not be evaluated again.
 *
 * The failure that produced: an admin edits ref_year or min_deals_per_year and
 * presses "apply changes". The pipeline scripts are FRESH PROCESSES, so they
 * pick the new value up and rebuild the aggregates under it — while the
 * long-running Next.js server keeps filtering and labelling with the old one.
 * The database and the served page disagree, silently, until someone restarts
 * the server. In dev this is masked by module reloading; under `next start` it
 * persists indefinitely.
 *
 * Called inside functions, these hit the 5-second rule cache in systemRules.ts,
 * so the cost is negligible and changes land within seconds.
 */
export function priceRefYear(): number {
  return getRuleNum("ref_year");
}

function minN(): number {
  return getRuleNum("min_deals_per_year");
}

/** Reference year first, then one year back — a city's collection can lag. */
function fallbackYears(): [number, number] {
  const y = priceRefYear();
  return [y, y - 1];
}

export interface CityTransactionPrices {
  cityName: string;
  /** the year the price levels are quoted for (per city, after fallback) */
  priceYear: number | null;
  avgAllSqm: number | null;
  medianAllSqm: number | null;
  avgShSqm: number | null;
  medianShSqm: number | null;
  /** deals behind the quoted year (scope=all) */
  nPriceYear: number;
  /** coverage — everything ever collected for the city */
  totalDeals: number;
  shDeals: number;
  yearMin: number | null;
  yearMax: number | null;
  distinctYears: number;
  /** thin = no year passed MIN_N — show an explicit "בהשלמה" warning, not numbers */
  thin: boolean;
}

interface StatRow { city_name: string; year: number; scope: string; avg_sqm: number | null; median_sqm: number | null; n: number }
interface CovRow { city_name: string; total: number; sh: number; ymin: number; ymax: number; yrs: number }

export async function loadCityTransactionPrices(): Promise<Map<string, CityTransactionPrices>> {
  // Resolved once per call, not once per process — see the note on these helpers.
  const years = fallbackYears();
  const threshold = minN();
  const [stats, cov] = await Promise.all([
    prisma.$queryRawUnsafe<StatRow[]>(
      `SELECT city_name, year, scope, avg_sqm, median_sqm, n
       FROM nadlan_year_room_stats
       WHERE room_bucket='all' AND scope IN ('all','secondhand') AND year IN (?, ?)`,
      years[0], years[1]
    ),
    prisma.$queryRawUnsafe<CovRow[]>(
      `SELECT city_name, COUNT(*) total, SUM(is_secondhand) sh,
              MIN(deal_year) ymin, MAX(deal_year) ymax, COUNT(DISTINCT deal_year) yrs
       FROM nadlan_transactions WHERE COALESCE(excluded,0)=0 GROUP BY city_name`
    ),
  ]);

  const byCity = new Map<string, Map<string, Map<number, StatRow>>>();
  for (const r of stats) {
    const c = byCity.get(r.city_name) ?? new Map();
    if (!byCity.has(r.city_name)) byCity.set(r.city_name, c);
    const s = c.get(r.scope) ?? new Map();
    if (!c.has(r.scope)) c.set(r.scope, s);
    s.set(Number(r.year), r);
  }

  const out = new Map<string, CityTransactionPrices>();
  for (const c of cov) {
    const scopes = byCity.get(c.city_name);
    // pick the latest fallback year where scope=all clears MIN_N
    let priceYear: number | null = null;
    for (const y of years) {
      const cell = scopes?.get("all")?.get(y);
      if (cell && Number(cell.n) >= threshold) { priceYear = y; break; }
    }
    const allCell = priceYear != null ? scopes?.get("all")?.get(priceYear) : undefined;
    const shCell = priceYear != null ? scopes?.get("secondhand")?.get(priceYear) : undefined;
    const shOk = shCell && Number(shCell.n) >= threshold;

    out.set(c.city_name, {
      cityName: c.city_name,
      priceYear,
      avgAllSqm: allCell?.avg_sqm != null ? Math.round(Number(allCell.avg_sqm)) : null,
      medianAllSqm: allCell?.median_sqm != null ? Math.round(Number(allCell.median_sqm)) : null,
      avgShSqm: shOk && shCell!.avg_sqm != null ? Math.round(Number(shCell!.avg_sqm)) : null,
      medianShSqm: shOk && shCell!.median_sqm != null ? Math.round(Number(shCell!.median_sqm)) : null,
      nPriceYear: allCell ? Number(allCell.n) : 0,
      totalDeals: Number(c.total),
      shDeals: Number(c.sh ?? 0),
      yearMin: c.ymin != null ? Number(c.ymin) : null,
      yearMax: c.ymax != null ? Number(c.ymax) : null,
      distinctYears: Number(c.yrs),
      thin: priceYear == null,
    });
  }
  return out;
}

/**
 * Active (non-excluded) deals per city, last 10 years — one number per city,
 * both sources, each deal counted once. Basis for the city_min_total_deals
 * thin-sample rule (yellow rows + ranking exclusion) and the "עסקאות במאגר"
 * column, so the tint and the displayed count always agree.
 */
export async function loadActiveDealCounts(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ city_name: string; n: bigint }>>(
    `SELECT city_name, COUNT(*) n FROM nadlan_transactions
     WHERE COALESCE(excluded,0)=0 AND deal_year >= ${new Date().getFullYear() - 10}
     GROUP BY city_name`
  );
  return new Map(rows.map((r) => [r.city_name, Number(r.n)]));
}

/** Cities under the city_min_total_deals rule (default 150 active deals/10y). */
export async function loadThinSampleCities(): Promise<Set<string>> {
  const minTotal = getRuleNum("city_min_total_deals", 150);
  const counts = await loadActiveDealCounts();
  const thin = new Set<string>();
  for (const [city, n] of counts) if (n < minTotal) thin.add(city);
  return thin;
}

/**
 * Ranking eligibility (user normalization rules): a city may appear in ranking
 * tables ONLY if it has at least minN deals of EVERY type (all / secondhand /
 * new) in a recent full year — a village with 1-5 deals showing +100% must
 * never top a national ranking — AND at least city_min_total_deals active
 * deals over the decade (thin-sample cities are yellow in tables + excluded).
 */
export async function loadRankingEligibleCities(minPerScope = getRuleNum("ranking_min_per_scope")): Promise<Set<string>> {
  const thin = await loadThinSampleCities();
  if (!getRuleBool("ranking_normalization_on", true)) {
    const all = await prisma.$queryRawUnsafe<Array<{ city_name: string }>>(
      "SELECT DISTINCT city_name FROM nadlan_year_room_stats");
    return new Set(all.map((r) => r.city_name).filter((c) => !thin.has(c)));
  }
  const rows = await prisma.$queryRawUnsafe<Array<{ city_name: string }>>(
    `SELECT city_name FROM nadlan_year_room_stats
     WHERE room_bucket='all' AND scope IN ('all','secondhand','new')
       AND year IN (?, ?) AND n >= ?
     GROUP BY city_name HAVING COUNT(DISTINCT scope) = 3`,
    priceRefYear(), priceRefYear() - 1, minPerScope
  );
  return new Set(rows.map((r) => r.city_name).filter((c) => !thin.has(c)));
}

/**
 * A function, for the same reason as the helpers at the top of this file: as a
 * module-level `const` the template string was interpolated once at import
 * time, so this user-facing sentence quoted whatever the thresholds were when
 * the server booted. An admin could raise ranking_min_per_scope, watch the
 * rankings change, and still read the old number in the explanation directly
 * beneath them.
 */
export function rankingEligibilityNote(): string {
  return `בדירוג נכללות רק ערים עם ${getRuleNum("ranking_min_per_scope")}+ עסקאות מכל סוג (כללי, יד-2, חדשות) בשנה מלאה אחרונה, ועם ${getRuleNum("city_min_total_deals")}+ עסקאות פעילות ב-10 שנים (עריך בדשבורד) — נרמול נגד עיוותי מדגם קטן`;
}

/** Caption for any consumer (memory rule: source • period • update). */
export const TX_PRICE_PROVENANCE = `מאגר העסקאות הפנימי (רשות המסים) · ₪/מ"ר · שנה מלאה אחרונה עם 10+ עסקאות`;
