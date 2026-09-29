"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import TrendValue from "@/components/TrendValue";
import Icon from "@/components/Icon";
import { YearRange } from "@/components/FromTo";
import InfoTip from "@/components/InfoTip";
// The selection lives in lib/ so that the deploy-time probe and the unit tests
// exercise the SAME code this renders from. A check that re-implements the
// component's logic verifies the check, not the component.
import {
  selectMovers, explainEmpty, defaultMoversQuery, EMPTY_TEXT,
  type GainSeries as MoversSeries,
} from "@/lib/moversBoard";

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
export type GainSeries = MoversSeries;

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
  // One definition of "what a visitor sees on arrival", shared with the probe.
  const initial = defaultMoversQuery(maxYear, partialYear);
  const [scope, setScope] = useState<string>(initial.scope);
  const [metric, setMetric] = useState<0 | 1>(initial.metric);
  const [dir, setDir] = useState<"up" | "down">(initial.dir);
  const [fromY, setFromY] = useState(Math.max(minYear, initial.fromY));
  const [toY, setToY] = useState(initial.toY);

  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = minYear; y <= maxYear; y++) out.push(y);
    return out;
  }, [minYear, maxYear]);

  const yearLabel = (y: number) => (y === partialYear ? `${y} (חלקית)` : String(y));

  const items = useMemo(
    () => selectMovers(series, { scope, metric, fromY, toY, dir, subsidized }),
    [series, scope, metric, fromY, toY, dir, subsidized]
  );

  const anyFlagged = items.some((i) => i.subsidizedYear != null);

  const emptyReason = useMemo(
    () => explainEmpty(series, { scope, fromY, toY }, items.length),
    [items, series, scope, fromY, toY]
  );
  const emptyText = EMPTY_TEXT(
    { scope, fromY, toY },
    SCOPES.find((x) => x.key === scope)?.label ?? scope
  );

  return (
    <div className="glass-card relative flex h-full flex-col overflow-hidden p-5">
      {/* On wide screens the card spans a full row — controls sit in a fixed
          side column and the list fills the rest in two columns, so the width
          is used instead of stretching five rows across an empty card. */}
      <div className="lg:grid lg:grid-cols-[290px_minmax(0,1fr)] lg:gap-8">
        <div className="mb-3 lg:mb-0">
          <div className="mb-2.5 flex min-w-0 items-center gap-1">
            <span className="min-w-0 break-words text-2xs font-black uppercase leading-snug tracking-wide text-slate-400"><Icon name="trend-up" size="1em" /> שינויי מחיר — לבחירתך</span>
            {/* This used to be a three-line paragraph sitting under the
                controls. It is the tallest thing in this column, the column is
                one half of a CSS grid row, and a grid row is as tall as its
                tallest cell — so those three lines were what stretched the card
                far past the six rows beside them and left the empty area the
                operator marked. Behind a disclosure it costs nothing until it
                is asked for, and nothing was deleted. */}
            <InfoTip
              label="מה מוצג כאן"
              text={`מוצג: ${SCOPES.find((x) => x.key === scope)?.label} · ${metric === 0 ? "ממוצע" : "חציון"} ₪ למ״ר · כל גדלי הדירות. אותו מספר בדיוק מופיע בגרף של כל עיר תחת אותה בחירה — שים לב שברירת המחדל שם ליד-שנייה היא הסדרה מתוקננת-ההרכב, שהיא חישוב אחר במכוון.`}
            />
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
        </div>

        {/* A TABLE, not a list of flex rows (operator, 8/2026).
            The rows used to be `flex flex-wrap` with the percentage pushed to
            ms-auto, so a long city name shoved its number left and a short one
            left a gap — the percentages never lined up with each other and the
            column could not be read down. Table cells align by construction,
            which is the entire reason the reader is looking at six cities at
            once. Every cell is centred, per the same request. */}
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full table-auto text-center text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-2xs text-slate-500">
                <th scope="col" className="px-2 py-1.5 font-bold">#</th>
                <th scope="col" className="px-2 py-1.5 font-bold">עיר</th>
                <th scope="col" className="px-2 py-1.5 font-bold">שינוי</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-xs italic leading-relaxed text-slate-500">
                    {emptyReason ? emptyText[emptyReason] : "אין ערים להצגה"}
                  </td>
                </tr>
              )}
              {items.map((it, i) => (
                <tr key={it.city} className={i === 0 ? "bg-indigo-50/60" : "hover:bg-slate-50"}>
                  <td className="px-2 py-1.5 align-middle">
                    <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-2xs font-black ${
                      i === 0 ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"
                    }`}>
                      {i + 1}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 align-middle">
                    <Link
                      href={`/city/${encodeURIComponent(it.city)}`}
                      className={`break-words font-bold leading-tight text-slate-900 hover:text-indigo-700 hover:underline ${i === 0 ? "text-sm" : ""}`}
                    >
                      {it.city}
                    </Link>
                    {/* The administered-price mark sits UNDER the name rather
                        than beside the number: as a sibling of the percentage
                        it widened the value column for every other row too. */}
                    {it.subsidizedYear && (
                      <span
                        className="mt-0.5 block text-[10px] font-bold text-amber-700"
                        title={`ב-${it.subsidizedYear} חלק ניכר מהעסקאות בדירות חדשות בעיר נסגרו במחיר מנהלי (מחיר למשתכן), ולכן השינוי משקף גם שינוי בתמהיל`}
                      >
                        מחיר למשתכן {it.subsidizedYear}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 align-middle">
                    <TrendValue pct={it.pct} className={i === 0 ? "!text-base font-black" : "font-bold"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* The two conditional warnings stay — they appear only when they apply,
          so deleting them would remove a caveat exactly when it is needed. They
          are one compact line under the table instead of two paragraphs inside
          the controls column, which is what made that column tall. */}
      {(toY === partialYear || anyFlagged) && (
        <p className="mt-2 text-2xs leading-relaxed text-amber-700">
          {toY === partialYear && <>⚠ {partialYear} היא שנה חלקית — ההשוואה עד העסקאות שנקלטו עד כה. </>}
          {anyFlagged && <>⚠ ערים המסומנות <b>מחיר למשתכן</b>: באחת משנות הקצה נמכרו שם דירות חדשות במחיר מנהלי, ולכן השינוי משקף גם את סיום התוכנית.</>}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <Link href="/rankings/highest-gain" className="whitespace-nowrap text-2xs text-slate-400 hover:text-indigo-700 transition-colors">
          כל הדירוג →
        </Link>
        <span className="min-w-0 break-words text-2xs text-slate-400"><Icon name="source-own" size="1em" /> מאגר העסקאות · <YearRange from={fromY} to={toY} />{toY === partialYear ? " (חלקית)" : ""}</span>
      </div>
    </div>
  );
}
