import { prisma } from "./db";
import { cachedMarket } from "./cache";
import { getRuleText } from "./systemRules";
import { loadCitiesChangeMetrics } from "./cityChangeMetrics";
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
 * Second-hand buyers this year against the same stretch of last year.
 *
 * THE WINDOW IS NOT "UP TO TODAY", AND THAT IS THE WHOLE POINT.
 * Deals reach the tax authority weeks after they close, so the most recent
 * month or two in this database is always partially reported. Comparing
 * January-to-today against January-to-today-last-year would therefore show a
 * decline in every city, every day of the year — a number that is always
 * wrong in the same direction is worse than no number, because it reads as a
 * finding.
 *
 * So the cutoff comes from the data: the latest deal_date on record, backed off
 * one whole month to clear the partially-reported tail, and applied IDENTICALLY
 * to both years. The label names the window, because a trend without its window
 * is not interpretable.
 */
async function loadBuyerTrend(
  cities: string[]
): Promise<Map<string, { pct: number | null; current: number; previous: number; windowLabel: string }>> {
  const out = new Map<string, { pct: number | null; current: number; previous: number; windowLabel: string }>();
  if (!cities.length) return out;

  const [maxRow] = await prisma.$queryRawUnsafe<Array<{ d: string | null }>>(
    "SELECT MAX(deal_date) d FROM nadlan_transactions WHERE COALESCE(excluded,0)=0"
  );
  if (!maxRow?.d) return out;

  const maxDate = new Date(`${maxRow.d}T00:00:00Z`);
  if (Number.isNaN(maxDate.getTime())) return out;
  // one whole month of safety margin against the reporting lag
  const cutoff = new Date(Date.UTC(maxDate.getUTCFullYear(), maxDate.getUTCMonth() - 1, 1));
  const endMonth = cutoff.getUTCMonth(); // 0-based; the window ends with this month
  const year = cutoff.getUTCFullYear();
  const lastDay = new Date(Date.UTC(year, endMonth + 1, 0)).getUTCDate();
  const mm = String(endMonth + 1).padStart(2, "0");
  const dd = String(lastDay).padStart(2, "0");
  const windowLabel = `ינו׳–${HE_MONTHS[endMonth]}`;

  const rows = await prisma.$queryRawUnsafe<Array<{ city_name: string; y: number; n: bigint }>>(
    `SELECT city_name, deal_year y, COUNT(*) n
       FROM nadlan_transactions
      WHERE COALESCE(excluded,0)=0 AND is_secondhand = 1
        AND deal_year IN (?, ?)
        AND substr(deal_date, 6) <= ?
      GROUP BY city_name, deal_year`,
    year, year - 1, `${mm}-${dd}`
  );

  const byCity = new Map<string, { cur: number; prev: number }>();
  for (const r of rows) {
    const e = byCity.get(r.city_name) ?? { cur: 0, prev: 0 };
    if (Number(r.y) === year) e.cur = Number(r.n);
    else e.prev = Number(r.n);
    byCity.set(r.city_name, e);
  }

  for (const city of cities) {
    const e = byCity.get(city);
    if (!e) continue;
    // A percentage off a handful of deals swings on one family moving house.
    const pct = e.prev >= 10 ? (e.cur / e.prev - 1) * 100 : null;
    out.set(city, { pct, current: e.cur, previous: e.prev, windowLabel });
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
