import { prisma } from "./db";
import { cachedMarket } from "./cache";
import { getRuleText } from "./systemRules";
import { loadCitiesChangeMetrics } from "./cityChangeMetrics";
import { loadFourRoomPrices } from "./cityTransactionPrices";
import { canonicalCityName, sameCity } from "./cityAliases";
import { topSearchedCities } from "./events";

/**
 * "ערים חמות" — the three cities the home page opens with.
 *
 * WHY THIS EXISTS
 * The home page used to hand a first-time visitor a search box and nothing to
 * search for. Someone who does not yet have a city in mind had no first move,
 * and the analytics said so: the fold was a dead end. Three cities with real
 * numbers on them turn "what is this site" into "click here".
 *
 * WHICH THREE — AND THE HONESTY RULE THAT SHAPES IT
 * The `hot_cities` rule holds a comma-separated list the operator controls, or
 * the literal `auto`, which ranks by what visitors actually searched.
 *
 * The two modes are NOT interchangeable in what the page may claim. A fixed
 * list is an editorial pick and gets an editorial caption; only `auto` earns
 * the sentence "the most-searched cities", because only then is it measured.
 * A data site that decorates a hand-picked list with a fake measurement spends
 * trust it needs for every other number on the page — so the caption travels
 * with the mode, in `source` below, and the component cannot get it wrong.
 *
 * The auto ranking leans on `search_select` (the visitor searched AND chose),
 * whose subject is already a canonical city name — unlike a raw search term,
 * which is free text. Below a floor of evidence it falls back to the manual
 * list rather than crowning a city on four clicks.
 */

/** How many searches must exist in the window before `auto` may speak. */
const AUTO_MIN_SELECTS = 25;
const AUTO_WINDOW_DAYS = 30;

export type HotCitySource = "manual" | "searched";

export interface HotCity {
  cityName: string;
  /** second-hand ₪/m² by year, oldest first — the chart. */
  trend: Array<{ year: number; value: number }>;
  /**
   * % change across the window ACTUALLY DRAWN.
   *
   * Computed from `trend` itself rather than from loadSecondhandChanges. The
   * two used to agree by coincidence: both ended at ref_year. The moment the
   * line was allowed to reach the running year, a headline frozen at ref_year
   * would have contradicted the line directly above it, on the same card.
   */
  changePct: number | null;
  changeFromYear: number | null;
  changeToYear: number | null;
  /** true when the last drawn year is the running calendar year */
  partial: boolean;
  /**
   * Second-hand buyers as a TREND against the same window a year earlier —
   * not a raw count (operator, 8/2026). See loadBuyerTrend for why the window
   * is not "up to today".
   */
  buyers: { pct: number | null; current: number; previous: number; windowLabel: string } | null;
  /** the third, operator-selectable figure, with the year it belongs to */
  extra: { label: string; value: string; year: number | null } | null;
}

export interface HotCitiesResult {
  cities: HotCity[];
  source: HotCitySource;
}

/** The window the sparkline draws. Three years = four year-points. */
const TREND_YEARS = 3;

function formatShekel(v: number): string {
  return `₪${Math.round(v).toLocaleString("he-IL")}`;
}

/**
 * The third metric. Kept as a rule because the operator asked for "whatever
 * visitors actually use on a city page" — a question only production usage
 * data can answer, and it answers it weeks after this ships. A rule means the
 * answer costs a click instead of a deploy.
 */
type Extra = { label: string; value: string; year: number | null };

async function loadExtra(metric: string, cities: string[]): Promise<Map<string, Extra>> {
  const out = new Map<string, Extra>();
  if (!cities.length) return out;

  if (metric === "population") {
    const rows = await prisma.city.findMany({
      where: { city_name: { in: cities } },
      select: { city_name: true, population_2026: true, population_2024: true },
    });
    for (const r of rows) {
      const p = r.population_2026 ?? r.population_2024;
      if (p != null) {
        out.set(r.city_name, {
          label: "תושבים",
          value: p.toLocaleString("he-IL"),
          year: r.population_2026 != null ? 2026 : 2024,
        });
      }
    }
    return out;
  }

  if (metric === "rooms4") {
    // Shared with the /cities table column (lib/cityTransactionPrices.ts).
    // Two implementations of "latest year with 10+ four-room second-hand deals"
    // is two chances to print a different number for the same city on two
    // pages a reader can have open at once.
    const prices = await loadFourRoomPrices();
    for (const city of cities) {
      const p = prices.get(city);
      if (p) out.set(city, { label: "מחיר ממוצע 4 חד׳", value: formatShekel(p.price), year: p.year });
    }
    return out;
  }

  // Everything else comes out of the same per-year stats table the whole site
  // prices from, so the card can never disagree with the city page it links to.
  const bucket = metric === "rooms4" ? "4" : "all";
  const scope = metric === "new" ? "new" : "secondhand";
  const rows = await prisma.nadlan_year_room_stats.findMany({
    // No year filter: take the LATEST year that clears the sample floor, per
    // city. Pinning this to ref_year meant a card whose chart reached 2026 sat
    // next to a price from 2025 with nothing saying so.
    where: { city_name: { in: cities }, room_bucket: bucket, scope },
    select: { city_name: true, year: true, avg_price: true, avg_sqm: true, n: true },
    orderBy: { year: "desc" },
  });
  for (const r of rows) {
    // Same n>=10 floor the price series uses everywhere else. A "typical
    // 4-room price" off six deals is a number with no population behind it.
    if (r.n < 10) continue;
    if (out.has(r.city_name)) continue; // rows are newest-first, so the first hit wins
    if (metric === "rooms4" && r.avg_price != null) {
      out.set(r.city_name, { label: "מחיר ממוצע 4 חד׳", value: formatShekel(r.avg_price), year: r.year });
    } else if (metric === "sqm" && r.avg_sqm != null) {
      out.set(r.city_name, { label: "מחיר ממוצע למ״ר יד-2", value: formatShekel(r.avg_sqm), year: r.year });
    } else if (metric === "new") {
      out.set(r.city_name, { label: "עסקאות מקבלן", value: r.n.toLocaleString("he-IL"), year: r.year });
    }
  }
  return out;
}

const HE_MONTHS = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];

/**
 * A month counts as fully reported when the country as a whole recorded at
 * least this share of what it recorded in the same month a year earlier.
 *
 * WHY YEAR-OVER-YEAR AND NOT "SHARE OF A TYPICAL MONTH": monthly volume swings
 * enormously with the calendar — October 2025 came in at 1,938 deals against a
 * July of 4,006, because of the holidays, not because the feed broke. Comparing
 * a month to the SAME month a year earlier cancels that out; comparing it to an
 * annual average would have condemned every holiday month as incomplete.
 *
 * WHY NATIONALLY: the national market does not halve in a month. A national
 * year-over-year ratio this low is a reporting fact, not an economic one. The
 * decision is therefore made once, on the whole country, and applied to every
 * city — which is also what keeps it from being circular, since the per-city
 * number this feeds is itself a year-over-year comparison.
 *
 * 0.70 errs toward trimming: dropping a month that was merely weak costs some
 * recency, while keeping a month that was merely late produces a confident
 * −50% on the front page. The first is a smaller mistake.
 */
const MONTH_COMPLETE_RATIO = 0.7;

/** Minimum deals in the BASE window before a percentage may be shown. */
const MIN_BASE_DEALS = 30;

/**
 * Beyond this, a change in transaction COUNT is a coverage change, not demand.
 *
 * Measured, not guessed: with the reporting lag handled, Be'er Sheva still came
 * out at +249% — 1,691 second-hand deals against 484. The monthly profile says
 * why. The city recorded 69 · 52 · 59 · 44 deals in January to April 2025 and
 * then 145 · 140 · 186 · 186 from May onward: a step change mid-year, which is
 * a source starting to report the city properly, not a market that tripled in
 * a month. The base window sits mostly in the under-covered era, so the
 * comparison inherits it.
 *
 * The Israeli market has not moved ±60% in transaction volume in a year even
 * in the sharpest turns of the last decade, so a reading past that is telling
 * us about our own data. It is suppressed to "—", which says "no trustworthy
 * comparison for this city" — the only honest thing to print, and better than
 * a tripling on the front page.
 */
const MAX_ABS_BUYER_CHANGE_PCT = 60;

/**
 * Second-hand buyers over the last twelve fully-reported months, against the
 * twelve months before those.
 *
 * WHAT THIS REPLACED, AND WHY. The first version compared January-to-a-cutoff
 * against the same stretch a year earlier, with the cutoff set one month behind
 * the newest deal on record. One month was not nearly enough. Measured on the
 * live database, the national year-over-year ratio ran 0.86 · 0.92 · 0.78 for
 * January to March and then 0.54 · 0.45 · 0.08 for April to June — deals reach
 * the tax authority over roughly a quarter, not a month. Including those three
 * months printed −49.5% for Haifa on the home page, which was not a market
 * move at all.
 *
 * TWELVE MONTHS RATHER THAN A YEAR-TO-DATE STRETCH, for a second reason found
 * in the same measurement: Be'er Sheva recorded 69 · 52 · 59 deals in early
 * 2025 and 140 · 151 · 127 in early 2026. A three-month window compares against
 * whatever that quarter happened to hold, and produces +132% from a thin base.
 * A full year of deals on each side absorbs that, and "the last twelve months
 * against the twelve before" is still exactly the comparison to last year that
 * was asked for.
 */
async function loadBuyerTrend(
  cities: string[]
): Promise<Map<string, { pct: number | null; current: number; previous: number; windowLabel: string }>> {
  const out = new Map<string, { pct: number | null; current: number; previous: number; windowLabel: string }>();
  if (!cities.length) return out;

  // National monthly volume for the last three years — the completeness test.
  const monthly = await prisma.$queryRawUnsafe<Array<{ ym: string; n: bigint }>>(
    `SELECT substr(deal_date, 1, 7) ym, COUNT(*) n
       FROM nadlan_transactions
      WHERE COALESCE(excluded,0)=0 AND deal_date >= date('now', '-40 months')
      GROUP BY ym ORDER BY ym`
  );
  if (!monthly.length) return out;

  const counts = new Map(monthly.map((r) => [r.ym, Number(r.n)]));
  const months = monthly.map((r) => r.ym);
  const prevYear = (ym: string) => `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`;

  // Walk back from the newest month to the last one that is fully reported.
  let lastComplete: string | null = null;
  for (let i = months.length - 1; i >= 0; i--) {
    const ym = months[i];
    const base = counts.get(prevYear(ym));
    if (!base) continue; // no comparison month — cannot judge, keep walking
    if ((counts.get(ym) ?? 0) / base >= MONTH_COMPLETE_RATIO) { lastComplete = ym; break; }
  }
  if (!lastComplete) return out;

  const [y, m] = lastComplete.split("-").map(Number);
  const endExclusive = `${y}-${String(m).padStart(2, "0")}-32`; // string compare: covers the whole month
  const startCur = new Date(Date.UTC(y, m - 12, 1));
  const startPrev = new Date(Date.UTC(y, m - 24, 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const windowLabel = `12 חודשים עד ${HE_MONTHS[m - 1]} ${y}`;

  const rows = await prisma.$queryRawUnsafe<Array<{ city_name: string; cur: bigint; prev: bigint }>>(
    `SELECT city_name,
            SUM(CASE WHEN deal_date >= ? THEN 1 ELSE 0 END) cur,
            SUM(CASE WHEN deal_date <  ? THEN 1 ELSE 0 END) prev
       FROM nadlan_transactions
      WHERE COALESCE(excluded,0)=0 AND is_secondhand = 1
        AND deal_date >= ? AND deal_date < ?
      GROUP BY city_name`,
    iso(startCur), iso(startCur), iso(startPrev), endExclusive
  );

  for (const r of rows) {
    if (!cities.includes(r.city_name)) continue;
    const cur = Number(r.cur);
    const prev = Number(r.prev);
    const raw = prev >= MIN_BASE_DEALS ? (cur / prev - 1) * 100 : null;
    const pct = raw != null && Math.abs(raw) <= MAX_ABS_BUYER_CHANGE_PCT ? raw : null;
    out.set(r.city_name, { pct, current: cur, previous: prev, windowLabel });
  }
  return out;
}

/** Beyond this a "price change" is a data error, not a market move. */
const MAX_ABS_CHANGE_PCT = 80;

async function loadHotCitiesUncached(names: string[], metric: string): Promise<HotCity[]> {
  const runningYear = new Date().getFullYear();
  const wanted = names.map(canonicalCityName);

  // Only cities that actually exist — a typo in the rule must degrade to one
  // card fewer, never to a link into a 404.
  const existing = await prisma.city.findMany({
    where: { city_name: { in: wanted } },
    select: { city_name: true },
  });
  const present = wanted.filter((n) => existing.some((e) => e.city_name === n));
  if (!present.length) return [];

  const [metrics, extras, buyerTrend] = await Promise.all([
    loadCitiesChangeMetrics(),
    loadExtra(metric, present),
    loadBuyerTrend(present),
  ]);

  return present.map((cityName) => {
    const sh = metrics.get(cityName)?.secondhand ?? {};
    const allYears = Object.entries(sh)
      .map(([y, v]) => ({ year: Number(y), value: v }))
      .filter((p) => p.value > 0 && p.year <= runningYear)
      .sort((a, b) => a.year - b.year);

    // The window ENDS at the last year that actually has a usable cell — which
    // is the running year wherever it already clears the n>=10 floor (operator:
    // "make it go up to 2026"). Anchoring to ref_year instead froze every card
    // a year in the past even where fresher data existed.
    const endYear = allYears.length ? allYears[allYears.length - 1].year : null;
    const trend = endYear == null
      ? []
      : allYears.filter((p) => p.year >= endYear - TREND_YEARS);

    // The headline comes from the drawn line, so the two cannot disagree.
    const first = trend[0];
    const last = trend[trend.length - 1];
    let changePct: number | null = null;
    if (first && last && first !== last && first.value > 0) {
      const pct = (last.value / first.value - 1) * 100;
      if (Number.isFinite(pct) && Math.abs(pct) <= MAX_ABS_CHANGE_PCT) changePct = pct;
    }

    return {
      cityName,
      trend,
      changePct,
      changeFromYear: first?.year ?? null,
      changeToYear: last?.year ?? null,
      partial: last?.year === runningYear,
      buyers: buyerTrend.get(cityName) ?? null,
      extra: extras.get(cityName) ?? null,
    };
  });
}

/**
 * Cached on the market tag: every input is derived from the nightly
 * aggregation, and the pipeline's revalidate ping drops that tag — so a card
 * can never show a figure older than the run that produced it.
 * Keyed on (names, metric), so flipping a rule produces a fresh entry rather
 * than serving the previous rule's answer.
 */
const loadHotCityData = cachedMarket(loadHotCitiesUncached, ["hot-cities"]);

/**
 * Rank cities by how often visitors searched AND picked them.
 *
 * Deliberately NOT exported into the cached loader above: this reads the event
 * log in app.db, which has nothing to do with the nightly aggregation, and
 * caching it on the market tag would freeze the ranking for a whole day.
 */
function searchedCityNames(all: string[], limit: number): string[] {
  const ranked = topSearchedCities(AUTO_WINDOW_DAYS, limit * 3);
  const total = ranked.reduce((s, r) => s + r.n, 0);
  if (total < AUTO_MIN_SELECTS) return [];

  const out: string[] = [];
  for (const r of ranked) {
    const match = all.find((c) => sameCity(c, r.city));
    if (match && !out.includes(match)) out.push(match);
    if (out.length >= limit) break;
  }
  return out;
}

export async function loadHotCities(limit = 3): Promise<HotCitiesResult> {
  const raw = getRuleText("hot_cities", "חיפה,באר שבע,קריית אתא").trim();
  const metric = getRuleText("hot_city_third_metric", "rooms4").trim() || "rooms4";
  const manual = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, limit);

  let names = manual;
  let source: HotCitySource = "manual";

  if (raw.toLowerCase() === "auto") {
    const all = (await prisma.city.findMany({ select: { city_name: true } })).map((c) => c.city_name);
    const ranked = searchedCityNames(all, limit);
    if (ranked.length >= limit) {
      names = ranked;
      source = "searched";
    } else {
      // Not enough evidence yet — fall back to the declared default rather than
      // publishing a "most searched" list built on a handful of clicks.
      names = "חיפה,באר שבע,קריית אתא".split(",").slice(0, limit);
    }
  }

  return { cities: await loadHotCityData(names, metric), source };
}
