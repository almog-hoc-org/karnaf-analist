/**
 * The "שינויי מחיר — לבחירתך" selection, as a pure function.
 *
 * WHY IT LEFT THE COMPONENT (operator-reported bug, 8/2026)
 * The board went blank on the live site while the database was demonstrably
 * full. Diagnosing it meant answering "what would the card show right now",
 * and the only place that logic existed was inside a React component — so
 * every check written to answer that question re-implemented it, and a check
 * that re-implements the thing it verifies proves nothing about the thing.
 *
 * Now the component, scripts/verify-movers-board.ts and the unit tests all
 * call THIS. If it drifts, it drifts for all three at once.
 *
 * No React, no database, no Next — a plain function over the same compact
 * series the home page ships to the browser.
 */

/** city → scope → year → [avgSqm, medianSqm] (n≥10 cells only) */
export type GainSeries = Record<string, Record<string, Record<number, [number, number]>>>;

export interface MoverRow {
  city: string;
  pct: number;
  /** the window edge whose new-build prices were administered (מחיר למשתכן) */
  subsidizedYear: number | null;
}

export interface MoversQuery {
  scope: string;
  /** 0 = average ₪/m², 1 = median ₪/m² */
  metric: 0 | 1;
  fromY: number;
  toY: number;
  dir: "up" | "down";
  limit?: number;
  /** city → years flagged as administered-price */
  subsidized?: Record<string, number[]>;
}

/**
 * Beyond this the number is a data error, not a market move. Kept here rather
 * than in the component so the verification script rejects the same rows the
 * reader never sees.
 */
export const MAX_ABS_CHANGE_PCT = 120;

export function selectMovers(series: GainSeries, q: MoversQuery): MoverRow[] {
  const { scope, metric, fromY, toY, dir, limit = 6, subsidized = {} } = q;
  const out: MoverRow[] = [];

  for (const [city, scopes] of Object.entries(series)) {
    const from = scopes[scope]?.[fromY]?.[metric];
    const to = scopes[scope]?.[toY]?.[metric];
    if (!from || !to || from <= 0) continue;
    const pct = (to / from - 1) * 100;
    if (!Number.isFinite(pct) || Math.abs(pct) > MAX_ABS_CHANGE_PCT) continue;
    // Only the WINDOW EDGES can distort the percentage.
    const flagged = subsidized[city] ?? [];
    out.push({ city, pct, subsidizedYear: flagged.find((y) => y === fromY || y === toY) ?? null });
  }

  out.sort((a, b) => (dir === "up" ? b.pct - a.pct : a.pct - b.pct));
  return out.slice(0, limit);
}

/**
 * Why the list is empty, when it is.
 *
 * One sentence used to cover four causes, and it named the one the reader
 * controls — "no cities with enough data in the range you picked" — even when
 * the real cause was that the server shipped an empty series. Being told your
 * year choice is wrong when it is not is worse than being told nothing,
 * because it sends you off to change something that was fine.
 *
 * `server` is the one that matters operationally: it is the only value that
 * says the fault is ours, and it is what the deploy-time probe greps for.
 */
export type EmptyReason = "server" | "scope" | "years" | "filtered" | null;

export function explainEmpty(
  series: GainSeries,
  q: Pick<MoversQuery, "scope" | "fromY" | "toY">,
  rowCount: number
): EmptyReason {
  if (rowCount > 0) return null;
  const cities = Object.keys(series);
  if (cities.length === 0) return "server";
  if (!cities.some((c) => series[c][q.scope])) return "scope";
  const hasFrom = cities.some((c) => series[c][q.scope]?.[q.fromY]);
  const hasTo = cities.some((c) => series[c][q.scope]?.[q.toY]);
  if (!hasFrom || !hasTo) return "years";
  return "filtered";
}

/**
 * The card's opening state, in one place.
 *
 * The probe has to ask "what does a visitor see on arrival", which is only
 * answerable if the defaults are not buried in three useState calls.
 */
export function defaultMoversQuery(maxYear: number, partialYear: number | null | undefined): MoversQuery {
  // The window ends at the last FULL year; the partial year is opt-in.
  const toY = partialYear && maxYear === partialYear ? maxYear - 1 : maxYear;
  return { scope: "secondhand", metric: 0, fromY: toY - 3, toY, dir: "up" };
}

/** The exact sentence the deploy probe looks for. Shared so it cannot drift. */
export const SERVER_FAULT_TEXT =
  "לא הגיעו נתוני ערים לכרטיס — תקלה בצד השרת, לא בבחירה שלך. שווה לרענן; אם זה נמשך, זה באג.";

export const EMPTY_TEXT = (
  q: Pick<MoversQuery, "scope" | "fromY" | "toY">,
  scopeLabel: string
): Record<Exclude<EmptyReason, null>, string> => ({
  server: SERVER_FAULT_TEXT,
  scope: `אין עדיין סדרת "${scopeLabel}" באף עיר — נסה סוג עסקה אחר.`,
  years: `אין ערים עם נתונים בשתי השנים ${q.fromY} ו-${q.toY}. נסה טווח קרוב יותר להווה.`,
  filtered: `כל הערים בטווח הזה הראו שינוי חריג מ-${MAX_ABS_CHANGE_PCT}% והוסתרו כחשודות בשגיאת נתונים.`,
});
