import { prisma } from "./db";
import { cachedMarket } from "./cache";
import { getRuleText } from "./systemRules";
import { refYear } from "./refYear";
import { loadCitiesChangeMetrics, loadSecondhandChanges } from "./cityChangeMetrics";
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
  /** second-hand ₪/m² by year, oldest first — the sparkline. */
  trend: Array<{ year: number; value: number }>;
  /** % change across the window actually used (may be shorter than 3y). */
  changePct: number | null;
  changeFromYear: number | null;
  changeToYear: number | null;
  /** second-hand deals in the reference year — "how many people bought here". */
  secondhandBuyers: number | null;
  /** the third, operator-selectable figure */
  extra: { label: string; value: string } | null;
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
async function loadExtra(
  metric: string,
  cities: string[],
  year: number
): Promise<Map<string, { label: string; value: string }>> {
  const out = new Map<string, { label: string; value: string }>();
  if (!cities.length) return out;

  if (metric === "population") {
    const rows = await prisma.city.findMany({
      where: { city_name: { in: cities } },
      select: { city_name: true, population_2026: true, population_2024: true },
    });
    for (const r of rows) {
      const p = r.population_2026 ?? r.population_2024;
      if (p != null) out.set(r.city_name, { label: "תושבים", value: p.toLocaleString("he-IL") });
    }
    return out;
  }

  // Everything else comes out of the same per-year stats table the whole site
  // prices from, so the card can never disagree with the city page it links to.
  const bucket = metric === "rooms4" ? "4" : "all";
  const scope = metric === "new" ? "new" : "secondhand";
  const rows = await prisma.nadlan_year_room_stats.findMany({
    where: { city_name: { in: cities }, room_bucket: bucket, scope, year },
    select: { city_name: true, avg_price: true, avg_sqm: true, n: true },
  });
  for (const r of rows) {
    // Same n>=10 floor the price series uses everywhere else. A "typical
    // 4-room price" off six deals is a number with no population behind it.
    if (r.n < 10) continue;
    if (metric === "rooms4" && r.avg_price != null) {
      out.set(r.city_name, { label: "דירת 4 חדרים", value: formatShekel(r.avg_price) });
    } else if (metric === "sqm" && r.avg_sqm != null) {
      out.set(r.city_name, { label: "מחיר למ״ר יד-2", value: formatShekel(r.avg_sqm) });
    } else if (metric === "new") {
      out.set(r.city_name, { label: "עסקאות מקבלן", value: r.n.toLocaleString("he-IL") });
    }
  }
  return out;
}

async function loadHotCitiesUncached(names: string[], metric: string): Promise<HotCity[]> {
  const year = refYear();
  const wanted = names.map(canonicalCityName);

  // Only cities that actually exist — a typo in the rule must degrade to one
  // card fewer, never to a link into a 404.
  const existing = await prisma.city.findMany({
    where: { city_name: { in: wanted } },
    select: { city_name: true },
  });
  const present = wanted.filter((n) => existing.some((e) => e.city_name === n));
  if (!present.length) return [];

  const [metrics, changes, extras] = await Promise.all([
    loadCitiesChangeMetrics(),
    loadSecondhandChanges(TREND_YEARS),
    loadExtra(metric, present, year),
  ]);

  const buyerRows = await prisma.nadlan_year_room_stats.findMany({
    where: { city_name: { in: present }, room_bucket: "all", scope: "secondhand", year },
    select: { city_name: true, n: true },
  });
  const buyers = new Map(buyerRows.map((r) => [r.city_name, r.n]));

  return present.map((cityName) => {
    const sh = metrics.get(cityName)?.secondhand ?? {};
    const trend = Object.entries(sh)
      .map(([y, v]) => ({ year: Number(y), value: v }))
      .filter((p) => p.year >= year - TREND_YEARS && p.year <= year)
      .sort((a, b) => a.year - b.year);
    const chg = changes.find((c) => c.city_name === cityName) ?? null;

    return {
      cityName,
      trend,
      changePct: chg?.pct ?? null,
      changeFromYear: chg?.fromY ?? null,
      changeToYear: chg?.toY ?? null,
      secondhandBuyers: buyers.get(cityName) ?? null,
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
