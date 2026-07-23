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

export const PRICE_REF_YEAR = 2025;
const MIN_N = 10;
const FALLBACK_YEARS = [PRICE_REF_YEAR, PRICE_REF_YEAR - 1]; // 2025 → 2024

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
  const [stats, cov] = await Promise.all([
    prisma.$queryRawUnsafe<StatRow[]>(
      `SELECT city_name, year, scope, avg_sqm, median_sqm, n
       FROM nadlan_year_room_stats
       WHERE room_bucket='all' AND scope IN ('all','secondhand') AND year IN (?, ?)`,
      FALLBACK_YEARS[0], FALLBACK_YEARS[1]
    ),
    prisma.$queryRawUnsafe<CovRow[]>(
      `SELECT city_name, COUNT(*) total, SUM(is_secondhand) sh,
              MIN(deal_year) ymin, MAX(deal_year) ymax, COUNT(DISTINCT deal_year) yrs
       FROM nadlan_transactions GROUP BY city_name`
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
    for (const y of FALLBACK_YEARS) {
      const cell = scopes?.get("all")?.get(y);
      if (cell && Number(cell.n) >= MIN_N) { priceYear = y; break; }
    }
    const allCell = priceYear != null ? scopes?.get("all")?.get(priceYear) : undefined;
    const shCell = priceYear != null ? scopes?.get("secondhand")?.get(priceYear) : undefined;
    const shOk = shCell && Number(shCell.n) >= MIN_N;

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
 * Ranking eligibility (user normalization rule): a city may appear in ranking
 * tables ONLY if it has at least minN deals of EVERY type (all / secondhand /
 * new) in a recent full year — a village with 1-5 deals showing +100% must
 * never top a national ranking.
 */
export async function loadRankingEligibleCities(minN = 10): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ city_name: string }>>(
    `SELECT city_name FROM nadlan_year_room_stats
     WHERE room_bucket='all' AND scope IN ('all','secondhand','new')
       AND year IN (?, ?) AND n >= ?
     GROUP BY city_name HAVING COUNT(DISTINCT scope) = 3`,
    PRICE_REF_YEAR, PRICE_REF_YEAR - 1, minN
  );
  return new Set(rows.map((r) => r.city_name));
}

export const RANKING_ELIGIBILITY_NOTE =
  "בדירוג נכללות רק ערים עם 10+ עסקאות מכל סוג (כללי, יד-2, חדשות) בשנה מלאה אחרונה — נרמול נגד עיוותי מדגם קטן";

/** Caption for any consumer (memory rule: source • period • update). */
export const TX_PRICE_PROVENANCE = `מאגר העסקאות הפנימי (רשות המסים) · ₪/מ"ר · שנה מלאה אחרונה עם 10+ עסקאות`;
