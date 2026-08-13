/**
 * The ONE trend contract — every percent change on the site speaks this type.
 *
 * WHY THIS EXISTS
 * A QA deep-dive (2026-08-12) found percent changes computed nine different
 * ways with three different window policies and wildly different sample
 * gating: the cities table showed Δ for scopes with NO minimum sample, the
 * city page showed two different "median price change" numbers computed from
 * different windows of the same table, and a city could be ranking-eligible
 * yet silently absent from the homepage because one loader demanded an exact
 * (ry-3, ry) pair while another slid its window. Users saw ±40% "trends"
 * built on four transactions.
 *
 * The contract: a trend is not a number, it is a number PLUS the evidence —
 * which years it actually compares, how many deals sit under each endpoint,
 * and a verdict the UI must honor. Displaying `value` without honoring
 * `level` is a bug.
 *
 * Thresholds (QA spec 2026-08-13):
 *   n < 10        → hidden   (not enough evidence to show a trend at all)
 *   10 ≤ n < 30   → warn     (shown with a "מדגם דל" label)
 *   n ≥ 30        → trusted
 *   |Δ| > 80%     → needs_review (shown as "חריג — דורש בדיקה", not as a trend)
 *
 * Classification (new/second-hand split):
 *   rate < 20%    → hidden   (the split would describe a fifth of the market)
 *   20% ≤ r < 35% → warn
 *   r ≥ 35%       → ok
 */

export type ConfidenceLevel = "trusted" | "warn" | "needs_review" | "hidden";

export interface TrendConfidence {
  /** The percent change itself. null when it must not be computed. */
  value: number | null;
  /** The years ACTUALLY compared — display these, not the nominal window. */
  fromYear: number | null;
  toYear: number | null;
  /** Sample size under each endpoint. */
  fromN: number | null;
  toN: number | null;
  level: ConfidenceLevel;
  /** Hebrew, ready to render next to the value. Empty when trusted. */
  warnings: string[];
  /** Convenience: level !== "hidden". */
  displayable: boolean;
}

export const MIN_N_HIDE = 10;
export const MIN_N_TRUST = 30;
export const MAX_ABS_CHANGE = 80;

export const CLASS_RATE_HIDE = 0.2;
export const CLASS_RATE_WARN = 0.35;

const HIDDEN: TrendConfidence = {
  value: null, fromYear: null, toYear: null, fromN: null, toN: null,
  level: "hidden", warnings: [], displayable: false,
};

/**
 * Grade a two-endpoint percent change. Pass null for a missing endpoint —
 * a missing endpoint yields `hidden`, never a value computed from a
 * different year than claimed.
 */
export function gradeTrend(input: {
  from: number | null | undefined;
  to: number | null | undefined;
  fromYear?: number | null;
  toYear?: number | null;
  fromN?: number | null;
  toN?: number | null;
}): TrendConfidence {
  const { from, to } = input;
  if (from == null || to == null || from <= 0) return HIDDEN;

  const pct = (to / from - 1) * 100;
  if (!Number.isFinite(pct)) return HIDDEN;

  const fromN = input.fromN ?? null;
  const toN = input.toN ?? null;
  const minN = Math.min(fromN ?? Infinity, toN ?? Infinity);

  const base = {
    value: pct,
    fromYear: input.fromYear ?? null,
    toYear: input.toYear ?? null,
    fromN, toN,
  };

  // An endpoint with a known-too-small sample is not evidence.
  if (minN < MIN_N_HIDE) return HIDDEN;

  if (Math.abs(pct) > MAX_ABS_CHANGE) {
    return { ...base, level: "needs_review", displayable: true,
      warnings: ["שינוי חריג — דורש בדיקת הרכב מדגם"] };
  }
  if (minN < MIN_N_TRUST) {
    return { ...base, level: "warn", displayable: true, warnings: ["מדגם דל"] };
  }
  return { ...base, level: "trusted", displayable: true, warnings: [] };
}

/**
 * ONE window policy for the whole site: prefer the exact (end-win, end)
 * pair; when the start year is missing/thin, slide the start FORWARD up to
 * `slack` years (default 2). The years actually used are in the result —
 * display them. Never slide the end.
 */
export function pickWindow<T extends { year: number; n?: number | null }>(
  cells: T[],
  win: number,
  endYear: number,
  opts: { minN?: number; slack?: number } = {}
): { from: T | null; to: T | null } {
  const minN = opts.minN ?? MIN_N_HIDE;
  const slack = opts.slack ?? 2;
  const usable = (c: T | undefined) => (c && (c.n == null || c.n >= minN) ? c : null);
  const byYear = new Map(cells.map((c) => [c.year, c]));

  const to = usable(byYear.get(endYear));
  if (!to) return { from: null, to: null };

  for (let y = endYear - win; y <= endYear - win + slack && y < endYear; y++) {
    const from = usable(byYear.get(y));
    if (from) return { from, to };
  }
  return { from: null, to };
}

/** Grade the new/second-hand classification coverage of a city. */
export function gradeClassification(rate: number | null | undefined): {
  level: "ok" | "warn" | "hidden";
  warning: string | null;
} {
  if (rate == null) return { level: "hidden", warning: "שיעור סיווג לא ידוע" };
  if (rate < CLASS_RATE_HIDE) {
    return { level: "hidden", warning: `רק ${Math.round(rate * 100)}% מהעסקאות מסווגות — הפילוח אינו מייצג` };
  }
  if (rate < CLASS_RATE_WARN) {
    return { level: "warn", warning: `${Math.round(rate * 100)}% מהעסקאות מסווגות — פילוח חלקי` };
  }
  return { level: "ok", warning: null };
}
