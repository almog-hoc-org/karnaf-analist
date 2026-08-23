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
import { cachedMap, cachedSet, TAGS, TTL } from "./cache";
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

/**
 * Reference year first, then progressively older years — a city's collection
 * can lag by more than one year.
 *
 * WHY FOUR YEARS AND NOT TWO: with a [y, y-1] window, any city whose archive
 * ends in 2023 (Beer Sheva, Bat Yam, Kfar Saba — major cities mid-backfill)
 * rendered a blank price column while sitting on thousands of perfectly good
 * deals. A 2023 median labelled "(2023)" — the year ALREADY renders next to
 * every price — beats a dash that reads as "we know nothing about Beer Sheva".
 * The `thin` flag and reliability audit still gate what qualifies.
 */
function fallbackYears(): number[] {
  const y = priceRefYear();
  return [y, y - 1, y - 2, y - 3];
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
  /** price levels come from the govmap-only series (city has no nadlan
   *  coverage) — display with a "מקור חלופי" disclosure, and never compare
   *  the LEVEL against nadlan-priced cities. */
  govmapSource: boolean;
}

interface StatRow { city_name: string; year: number; scope: string; avg_sqm: number | null; median_sqm: number | null; n: number }
interface CovRow { city_name: string; total: number; sh: number; ymin: number; ymax: number; yrs: number }

async function loadCityTransactionPricesUncached(): Promise<Map<string, CityTransactionPrices>> {
  // Resolved once per call, not once per process — see the note on these helpers.
  const years = fallbackYears();
  const threshold = minN();
  const [stats, cov] = await Promise.all([
    prisma.$queryRawUnsafe<StatRow[]>(
      `SELECT city_name, year, scope, avg_sqm, median_sqm, n
       FROM nadlan_year_room_stats
       WHERE room_bucket='all' AND scope IN ('all','all_govmap','secondhand') AND year IN (${years.map(() => "?").join(",")})`,
      ...years
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
    // pick the latest fallback year where scope=all clears MIN_N; a city whose
    // "all" series lives under all_govmap (no nadlan coverage — pipeline
    // decision, scripts/aggregate-nadlan-transactions.ts) falls through to
    // that series instead of being mislabeled "בהשלמה" while sitting on a
    // decade of perfectly good govmap data.
    let priceYear: number | null = null;
    let govmapSource = false;
    for (const y of years) {
      const cell = scopes?.get("all")?.get(y);
      if (cell && Number(cell.n) >= threshold) { priceYear = y; break; }
    }
    if (priceYear == null) {
      for (const y of years) {
        const cell = scopes?.get("all_govmap")?.get(y);
        if (cell && Number(cell.n) >= threshold) { priceYear = y; govmapSource = true; break; }
      }
    }
    const allCell = priceYear != null ? scopes?.get(govmapSource ? "all_govmap" : "all")?.get(priceYear) : undefined;
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
      govmapSource,
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
async function loadActiveDealCountsUncached(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ city_name: string; n: bigint }>>(
    `SELECT city_name, COUNT(*) n FROM nadlan_transactions
     WHERE COALESCE(excluded,0)=0 AND deal_year >= ${new Date().getFullYear() - 10}
     GROUP BY city_name`
  );
  return new Map(rows.map((r) => [r.city_name, Number(r.n)]));
}

/** Cities under the city_min_total_deals rule (default 150 active deals/10y). */
async function loadThinSampleCitiesUncached(): Promise<Set<string>> {
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
async function loadRankingEligibleCitiesUncached(minPerScope = getRuleNum("ranking_min_per_scope")): Promise<Set<string>> {
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
  const eligible = new Set(rows.map((r) => r.city_name).filter((c) => !thin.has(c)));

  // A gate that excludes EVERY city is a broken gate, not a strict one.
  //
  // Everything downstream treats this set as "the cities allowed in rankings",
  // so an empty one silently blanks the movers board, the gainers list and the
  // yield table at once — and the card then tells the reader "no cities with
  // enough data in the selected range", blaming their year pickers for a
  // server-side fault. That is the worst possible failure mode: wrong, and
  // convincingly attributed to the user.
  //
  // It can empty legitimately-looking ways: ref_year edited to a year the
  // stats have not reached, a run where the "new" scope did not materialise,
  // a thin-sample rule set too high. In every one of them, falling back to
  // "every city that has stats and is not thin" shows real cities with a
  // slightly weaker guarantee, which beats showing nothing.
  if (eligible.size === 0) {
    const all = await prisma.$queryRawUnsafe<Array<{ city_name: string }>>(
      "SELECT DISTINCT city_name FROM nadlan_year_room_stats WHERE room_bucket='all'"
    );
    const fallback = new Set(all.map((r) => r.city_name).filter((c) => !thin.has(c)));
    if (fallback.size > 0) {
      console.warn(
        `[rankings] eligibility gate returned 0 cities for ref_year=${priceRefYear()} ` +
        `(min ${minPerScope}/scope) — falling back to ${fallback.size} cities with stats. ` +
        `Check ref_year against the years the aggregation actually produced.`
      );
    }
    return fallback;
  }
  return eligible;
}

/**
 * Average price of a 4-room SECOND-HAND apartment, per city.
 *
 * WHY IT LIVES HERE AND NOT WHERE IT WAS FIRST WRITTEN
 * The same figure is on the home page's hot-city cards (lib/hotCities.ts) and,
 * from 8/2026, a default column in the /cities table. Two copies of "latest
 * year with at least ten 4-room second-hand deals" is two chances to answer the
 * same question differently for the same city, on two pages a reader can have
 * open side by side. One loader, one answer.
 *
 * SECOND-HAND rather than all deals (operator choice, 8/2026): a city with one
 * large new project has its overall average dragged up by it, which is exactly
 * the distortion a cross-city comparison table must not carry.
 *
 * No year filter in the query — the newest qualifying year WINS PER CITY, so a
 * city whose collection lags shows its own last good year rather than a dash.
 * The year travels with the number so the column can label it.
 */
async function loadFourRoomPricesUncached(): Promise<Map<string, { price: number; year: number }>> {
  const rows = await prisma.nadlan_year_room_stats.findMany({
    where: { room_bucket: "4", scope: "secondhand", n: { gte: 10 } },
    select: { city_name: true, year: true, avg_price: true },
    orderBy: { year: "desc" },
  });
  const out = new Map<string, { price: number; year: number }>();
  for (const r of rows) {
    if (r.avg_price == null || out.has(r.city_name)) continue; // newest-first ⇒ first hit wins
    out.set(r.city_name, { price: r.avg_price, year: r.year });
  }
  return out;
}

/**
 * Ten-year population growth, in percent, per city.
 *
 * The table carried population SNAPSHOTS (2022 / 2024 / 2026) and no growth at
 * all, so comparing two cities meant doing arithmetic in your head across two
 * columns. This is the number that was actually wanted.
 *
 * A city needs BOTH endpoints. Missing one returns nothing rather than a
 * fabricated 0 — a city we have no history for is not a city that did not grow.
 * The window slides to the newest year that has a partner ten years back, so a
 * source that lags by a year degrades to a slightly older window instead of
 * emptying the column.
 */
async function loadPopulationGrowth10yUncached(): Promise<Map<string, number>> {
  const rows = await prisma.population_by_year.findMany({
    where: { population: { gt: 0 } },
    select: { city_name: true, year: true, population: true },
  });

  const byCity = new Map<string, Map<number, number>>();
  for (const r of rows) {
    if (r.population == null) continue;
    let m = byCity.get(r.city_name);
    if (!m) { m = new Map(); byCity.set(r.city_name, m); }
    m.set(r.year, r.population);
  }

  const out = new Map<string, number>();
  for (const [city, series] of byCity) {
    const pct = growthOverSpan(series, 10);
    if (pct !== null) out.set(city, pct);
  }
  return out;
}

/**
 * Percentage growth across `span` years, from the newest year that HAS a
 * partner `span` years earlier.
 *
 * Pulled out as a pure function so it can be tested without a database. The
 * two rules worth pinning: a city missing either endpoint returns null rather
 * than 0 — no history is not no growth — and the window slides backwards to
 * the newest usable pair, so a source that lags by a year degrades to a
 * slightly older window instead of emptying the column.
 */
export function growthOverSpan(series: Map<number, number>, span: number): number | null {
  const years = [...series.keys()].sort((a, b) => b - a);
  for (const to of years) {
    const from = series.get(to - span);
    const toVal = series.get(to);
    if (from && from > 0 && toVal && toVal > 0) return (toVal / from - 1) * 100;
  }
  return null;
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

/* ── caching ──────────────────────────────────────────────────────────────
 * Every one of these scans nadlan_year_room_stats or nadlan_transactions and
 * is called from the home page, /cities, /compare and the rankings — on each
 * render, per visitor. They read only pipeline output, so the market tag's
 * invalidation (fired by the aggregation's revalidate ping) is exactly the
 * right lifetime. loadThinSampleCities is additionally awaited from inside
 * loadSecondhandChanges, which made it the most-repeated query on the site.
 */
/**
 * The `guardEmpty` flag on three of these four is not decoration — it is the
 * fix for a reported bug where the movers board went blank for hours while the
 * database was full (see the long note in lib/cache.ts).
 *
 * For these three, an empty result cannot be true of a working system: there
 * are always cities with price rows, always cities with deals, and the
 * eligibility gate has its own fallback specifically so that it cannot
 * legitimately return nothing. Empty therefore means "the tables were
 * unreadable at that instant", and caching that for six hours turns a blip
 * into an outage.
 *
 * loadThinSampleCities is deliberately NOT guarded: "no city is thin" is a
 * real, healthy answer, and guarding it would re-run the count query on every
 * render of every page for no benefit.
 */
export const loadCityTransactionPrices = cachedMap(loadCityTransactionPricesUncached, ["city-transaction-prices"], TAGS.market, TTL.market, true);
export const loadActiveDealCounts = cachedMap(loadActiveDealCountsUncached, ["active-deal-counts"], TAGS.market, TTL.market, true);
export const loadThinSampleCities = cachedSet(loadThinSampleCitiesUncached, ["thin-sample-cities"]);
export const loadRankingEligibleCities = cachedSet(loadRankingEligibleCitiesUncached, ["ranking-eligible-cities"], TAGS.market, TTL.market, true);
export const loadFourRoomPrices = cachedMap(loadFourRoomPricesUncached, ["four-room-prices"], TAGS.market, TTL.market, true);
// Reference data, not market data: population moves on the CBS's schedule, not
// the nightly aggregation's, so it belongs to the slower invalidation group.
export const loadPopulationGrowth10y = cachedMap(loadPopulationGrowth10yUncached, ["population-growth-10y"], TAGS.reference, TTL.reference, true);
