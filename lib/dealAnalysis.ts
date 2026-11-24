/**
 * One deal, judged against the deals that were really comparable to it.
 *
 * WHY. Every number on the site was about a place — a neighbourhood's ₪/m²,
 * a street's median. A reader holding one sale ("my neighbour sold the
 * 4-room for 2.1M, was that cheap?") had nowhere to ask, and /check compared
 * a typed flat with five years of deals, unadjusted, and gave a verdict from
 * a single comparable. This module is the one engine both use.
 *
 * The rules, all pure and pinned in tests/pure.test.ts:
 *  - A comparable is a sale of the same kind (second-hand vs new), not a
 *    luxury sale, not the deal itself, the same room count (±¼) and an area
 *    within ±20% when both are known — within COMP_WINDOW_MONTHS of the deal.
 *  - Geography ladder building → street → neighbourhood → city: the first
 *    rung with COMP_MIN comparables wins. Fewer than that anywhere is "few
 *    comparables", never a verdict.
 *  - A comparable from another year is moved to the deal's year by the
 *    area's own yearly series (the neighbourhood's, else the city's) — a sale
 *    eleven months earlier in a rising market is not the same price.
 *  - The verdict thresholds (±5%, ±15%) are the ones /check always used,
 *    now in one place.
 */
import { MIN_N_HIDE, MIN_N_TRUST } from "./confidence";

export const COMP_MIN = 5;
export const COMP_WINDOW_MONTHS = 12;
export const COMP_AREA_PCT = 20;
export const COMP_ROOM_TOLERANCE = 0.25;

export type CompRung = "building" | "street" | "neighborhood" | "city";
export const RUNG_ORDER: CompRung[] = ["building", "street", "neighborhood", "city"];

export interface DealLike {
  id: number;
  dealDate: string;
  dealYear: number;
  rooms: number | null;
  area: number | null;
  priceSqm: number | null;
  isSecondHand: boolean;
  luxury: boolean;
}

/** Whole months between two ISO dates (absolute, day-of-month ignored). */
export function monthsApart(a: string, b: string): number {
  const [ya, ma] = a.slice(0, 7).split("-").map(Number);
  const [yb, mb] = b.slice(0, 7).split("-").map(Number);
  return Math.abs((ya * 12 + ma) - (yb * 12 + mb));
}

/** Is `c` a comparable for `target`? */
export function isComparable(target: DealLike, c: DealLike, windowMonths = COMP_WINDOW_MONTHS): boolean {
  if (c.id === target.id || c.luxury) return false;
  if (!(c.priceSqm != null && c.priceSqm > 0)) return false;
  if (c.isSecondHand !== target.isSecondHand) return false;
  if (monthsApart(c.dealDate, target.dealDate) > windowMonths) return false;
  if (target.rooms != null && target.rooms > 0) {
    if (c.rooms == null || Math.abs(c.rooms - target.rooms) > COMP_ROOM_TOLERANCE) return false;
  }
  if (target.area != null && target.area > 0 && c.area != null && c.area > 0) {
    const pct = COMP_AREA_PCT / 100;
    if (c.area < target.area * (1 - pct) || c.area > target.area * (1 + pct)) return false;
  }
  return true;
}

export interface CompPick<T> {
  rung: CompRung;
  comps: T[];
  /** false = the widest rung still had fewer than `minN` — show no verdict */
  enough: boolean;
}

/**
 * The first rung with at least `minN` comparables. When none has enough,
 * the widest rung that has any, flagged not enough; null when none has any.
 */
export function pickComps<T extends DealLike>(
  target: DealLike,
  rungs: Array<{ rung: CompRung; rows: T[] }>,
  minN = COMP_MIN,
): CompPick<T> | null {
  const ordered = [...rungs].sort((a, b) => RUNG_ORDER.indexOf(a.rung) - RUNG_ORDER.indexOf(b.rung));
  let widest: CompPick<T> | null = null;
  for (const { rung, rows } of ordered) {
    const seen = new Set<number>();
    const comps = rows.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return isComparable(target, r);
    });
    if (comps.length >= minN) return { rung, comps, enough: true };
    if (comps.length) widest = { rung, comps, enough: false };
  }
  return widest;
}

/** Linear-interpolated quantile, q in [0,1]. */
export function quantile(values: number[], q: number): number | null {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** [25th, 75th] percentile — the middle half of the comparables. */
export function iqr(values: number[]): [number, number] | null {
  const a = quantile(values, 0.25), b = quantile(values, 0.75);
  return a == null || b == null ? null : [a, b];
}

/** Where `value` sits among `values`, 0–100 (ties count half). */
export function percentileOf(value: number, values: number[]): number | null {
  const s = values.filter((v) => Number.isFinite(v));
  if (!s.length || !Number.isFinite(value)) return null;
  let below = 0, equal = 0;
  for (const v of s) { if (v < value) below++; else if (v === value) equal++; }
  return Math.round(((below + equal / 2) / s.length) * 100);
}

/**
 * `value` (₪/m² in `fromYear`) in `toYear` money, by the area's yearly
 * series. Same value when the years match; null when either end is missing.
 */
export function timeAdjust(value: number, fromYear: number, toYear: number, series: Map<number, number>): number | null {
  if (fromYear === toYear) return value;
  const a = series.get(fromYear), b = series.get(toYear);
  if (!a || !b) return null;
  return value * (b / a);
}

/**
 * `timeAdjust` by the first series that has both years — the neighbourhood's
 * own, then the city's. Each move uses ONE series end to end, never a ratio
 * of two different ones.
 */
export function timeAdjustAny(value: number, fromYear: number, toYear: number, seriesList: Array<Map<number, number>>): number | null {
  for (const s of seriesList) {
    const v = timeAdjust(value, fromYear, toYear, s);
    if (v != null) return v;
  }
  return null;
}

export type VerdictKey = "in" | "above" | "below";
export interface Verdict { key: VerdictKey; strong: boolean; text: string }

/** ±5% is the market; beyond ±15% is far from it. */
export function verdict(deltaPct: number | null): Verdict | null {
  if (deltaPct == null || !Number.isFinite(deltaPct)) return null;
  const abs = Math.abs(deltaPct);
  if (abs < 5) return { key: "in", strong: false, text: "בטווח השוק" };
  const r = abs.toFixed(0);
  return deltaPct > 0
    ? { key: "above", strong: abs >= 15, text: `${r}% מעל השוק` }
    : { key: "below", strong: abs >= 15, text: `${r}% מתחת לשוק` };
}

/** The badge colours /check has always used, by verdict. */
export function verdictTone(v: Verdict): string {
  if (v.key === "in") return "bg-slate-100 text-slate-700 border-slate-200";
  if (v.key === "above") return v.strong ? "bg-rose-100 text-rose-800 border-rose-200" : "bg-amber-100 text-amber-800 border-amber-200";
  return v.strong ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-teal-100 text-teal-800 border-teal-200";
}

export type CompConfidence = "high" | "medium" | "low";
/** The site's sample thresholds (lib/confidence.ts), applied to a comparable set. */
export function compConfidence(n: number): CompConfidence {
  return n >= MIN_N_TRUST ? "high" : n >= MIN_N_HIDE ? "medium" : "low";
}
export const CONFIDENCE_LABEL: Record<CompConfidence, string> = {
  high: "ביטחון גבוה", medium: "ביטחון בינוני", low: "מדגם קטן",
};

export const RUNG_LABEL: Record<CompRung, string> = {
  building: "באותו בניין", street: "באותו רחוב", neighborhood: "באותה שכונה", city: "בעיר",
};

export interface CompStats {
  n: number;
  medianSqm: number | null;
  spread: [number, number] | null;
  /** comparables from another year that no series could move — left out */
  unadjusted: number;
}

/**
 * The comparables' ₪/m², each moved to `toYear`; comparables that cannot be
 * moved are left out (counted) rather than mixed in raw.
 */
export function compStats(comps: DealLike[], toYear: number, seriesList: Array<Map<number, number>>): CompStats & { values: number[] } {
  const values: number[] = [];
  let unadjusted = 0;
  for (const c of comps) {
    const v = c.priceSqm ? timeAdjustAny(c.priceSqm, c.dealYear, toYear, seriesList) : null;
    if (v == null) unadjusted++; else values.push(v);
  }
  return { n: values.length, medianSqm: quantile(values, 0.5), spread: iqr(values), unadjusted, values };
}
