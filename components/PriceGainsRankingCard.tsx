"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import TrendValue from "@/components/TrendValue";
import Icon from "@/components/Icon";

/**
 * "שינויי מחיר" ranking card with FULL user control (user spec):
 *   - any from→to year range (2015+), not just 3y/5y presets
 *   - deal type: יד-2 | חדשות | הכל
 *   - metric: ממוצע | חציון ₪/מ"ר
 *   - direction: top RISERS or top FALLERS (operator request 8/2026)
 * The server ships the compact per-city yearly series (n≥10 cells only) and
 * everything recomputes instantly client-side. Every value carries its window.
 *
 * The current calendar year is offered as a range endpoint but ALWAYS labeled
 * "חלקית" — an honest partial-year comparison the user opts into, never a
 * silent default (the default `to` stays the last FULL year).
 */

/** city → scope → year → [avgSqm, medianSqm] (n≥10 cells only) */
export type GainSeries = Record<string, Record<string, Record<number, [number, number]>>>;

const SCOPES = [
  { key: "secondhand", label: "יד שנייה" },
  { key: "new", label: "חדשות" },
  { key: "all", label: "הכל" },
] as const;

export default function PriceGainsRankingCard({ series, minYear, maxYear, partialYear, subsidized = {} }: {
  series: GainSeries;
  minYear: number;
  maxYear: number;
  /** A year offered in the pickers but not yet complete (labeled "חלקית"). */
  partialYear?: number | null;
  /**
   * city → years whose new-build prices were administered (מחיר למשתכן).
   * A riser board is exactly where this distortion surfaces: measured live,
   * three of the six cities at the top of this list were sitting on such a
   * baseline year, so the board was ranking programme changes as market moves.
   */
  subsidized?: Record<string, number[]>;
}) {
  const [scope, setScope] = useState<string>("secondhand");
  const [metric, setMetric] = useState<0 | 1>(0); // 0=avg, 1=median
  const [dir, setDir] = useState<"up" | "down">("up");
  // Default window ends at the last FULL year; the partial year is opt-in.
  const defaultTo = partialYear && maxYear === partialYear ? maxYear - 1 : maxYear;
  const [fromY, setFromY] = useState(Math.max(minYear, defaultTo - 3));
  const [toY, setToY] = useState(defaultTo);

  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = minYear; y <= maxYear; y++) out.push(y);
    return out;
  }, [minYear, maxYear]);

  const yearLabel = (y: number) => (y === partialYear ? `${y} (חלקית)` : String(y));

  const items = useMemo(() => {
    const out: { city: string; pct: number; subsidizedYear: number | null }[] = [];
    for (const [city, scopes] of Object.entries(series)) {
      const from = scopes[scope]?.[fromY]?.[metric];
      const to = scopes[scope]?.[toY]?.[metric];
      if (!from || !to || from <= 0) continue;
      const pct = (to / from - 1) * 100;
      if (!Number.isFinite(pct) || Math.abs(pct) > 120) continue;
      // Only the WINDOW EDGES can distort the percentage.
      const flagged = subsidized[city] ?? [];
      out.push({ city, pct, subsidizedYear: flagged.find((y) => y === fromY || y === toY) ?? null });
    }
    out.sort((a, b) => (dir === "up" ? b.pct - a.pct : a.pct - b.pct));
    return out.slice(0, 6);
  }, [series, scope, metric, fromY, toY, dir, subsidized]);

  const anyFlagged = items.some((i) => i.subsidizedYear != null);

  return (
    <div className="glass-card relative flex h-full flex-col overflow-hidden p-5">
      {/* On wide screens the card spans a full row — controls sit in a fixed
          side column and the list fills the rest in two columns, so the width
          is used instead of stretching five rows across an empty card. */}
      <div className="lg:grid lg:grid-cols-[290px_minmax(0,1fr)] lg:gap-8">
        <div className="mb-3 lg:mb-0">
          <div className="mb-2.5 min-w-0">
            <span className="block break-words text-2xs font-black uppercase leading-snug tracking-wide text-slate-400"><Icon name="trend-up" size="1em" /> שינויי מחיר — לבחירתך</span>
          </div>
          {/* direction: top risers / top fallers */}
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-2xs font-bold">
            <button type="button" onClick={() => setDir("up")}
              className={`px-2 py-1 rounded-full border transition-colors ${
                dir === "up" ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-500 hover:border-indigo-300"
              }`}>
              ▲ העולות ביותר
            </button>
            <button type="button" onClick={() => setDir("down")}
              className={`px-2 py-1 rounded-full border transition-colors ${
                dir === "down" ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-500 hover:border-indigo-300"
              }`}>
              ▼ היורדות ביותר
            </button>
          </div>
          {/* controls: scope pills + metric + year range */}
          <div className="flex flex-wrap items-center gap-1.5 text-2xs font-bold">
            {SCOPES.map((s) => (
              <button key={s.key} type="button" onClick={() => setScope(s.key)}
                className={`px-2 py-1 rounded-full border transition-colors ${
                  scope === s.key ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-500 hover:border-indigo-300"
                }`}>
                {s.label}
              </button>
            ))}
            <span className="mx-0.5 text-slate-300">|</span>
            <button type="button" onClick={() => setMetric(metric === 0 ? 1 : 0)}
              className="px-2 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-600 hover:border-indigo-300">
              {metric === 0 ? "ממוצע ₪/מ״ר" : "חציון ₪/מ״ר"} ⇄
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-2xs">
            <select value={fromY} onChange={(e) => setFromY(Number(e.target.value))}
              className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-bold tabular-nums">
              {years.filter((y) => y < toY).map((y) => <option key={y} value={y}>{yearLabel(y)}</option>)}
            </select>
            <span className="text-slate-400">←</span>
            <select value={toY} onChange={(e) => setToY(Number(e.target.value))}
              className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-bold tabular-nums">
              {years.filter((y) => y > fromY).map((y) => <option key={y} value={y}>{yearLabel(y)}</option>)}
            </select>
            <span className="text-2xs text-slate-400">10+ עסקאות בכל שנה</span>
          </div>
          {toY === partialYear && (
            <p className="mt-1.5 text-2xs font-semibold text-amber-600">
              ⚠ {partialYear} היא שנה חלקית — ההשוואה עד העסקאות שנקלטו עד כה, לא שנה מלאה
            </p>
          )}
          {anyFlagged && (
            <p className="mt-1.5 text-2xs leading-relaxed text-amber-700">
              ⚠ ערים המסומנות <b>מחיר למשתכן</b>: באחת משנות הקצה נמכרו שם דירות חדשות במחיר מנהלי,
              נמוך בהרבה משוק חופשי. העלייה המוצגת משקפת גם את סיום התוכנית, לא רק את השוק.
            </p>
          )}
        </div>

        <ul className="space-y-1.5 lg:grid lg:grid-cols-2 lg:content-start lg:gap-x-8 lg:gap-y-2 lg:space-y-0">
          {items.length === 0 && (
            <li className="text-xs text-slate-500 italic py-2 text-center lg:col-span-2">אין ערים עם דאטה מספק בטווח שנבחר</li>
          )}
          {items.map((it, i) => (
            <li key={it.city} className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-0.5 text-xs">
              <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-2xs font-black ${
                i === 0 ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"
              }`}>
                {i + 1}
              </span>
              <Link href={`/city/${encodeURIComponent(it.city)}`}
                className={`min-w-0 flex-1 break-words font-bold leading-tight text-slate-900 hover:text-indigo-700 hover:underline ${i === 0 ? "text-sm" : ""}`}>
                {it.city}
              </Link>
              <TrendValue pct={it.pct} className={`shrink-0 ${i === 0 ? "!text-base font-black" : "font-bold"}`} />
              {it.subsidizedYear && (
                <span
                  className="shrink-0 rounded bg-amber-100 px-1.5 py-px text-2xs font-bold text-amber-800"
                  title={`ב-${it.subsidizedYear} חלק ניכר מהעסקאות בדירות חדשות בעיר נסגרו במחיר מנהלי (מחיר למשתכן), ולכן השינוי משקף גם שינוי בתמהיל`}
                >
                  מחיר למשתכן {it.subsidizedYear}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <Link href="/rankings/highest-gain" className="whitespace-nowrap text-2xs text-slate-400 hover:text-indigo-700 transition-colors">
          כל הדירוג →
        </Link>
        <span className="min-w-0 break-words text-2xs text-slate-400"><Icon name="source-own" size="1em" /> מאגר העסקאות · {fromY}→{toY}{toY === partialYear ? " (חלקית)" : ""}</span>
      </div>
    </div>
  );
}
