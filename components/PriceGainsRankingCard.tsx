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
 * The server ships the compact per-city yearly series (n≥10 cells only) and
 * everything recomputes instantly client-side. Every value carries its window.
 */

/** city → scope → year → [avgSqm, medianSqm] (n≥10 cells only) */
export type GainSeries = Record<string, Record<string, Record<number, [number, number]>>>;

const SCOPES = [
  { key: "secondhand", label: "יד שנייה" },
  { key: "new", label: "חדשות" },
  { key: "all", label: "הכל" },
] as const;

export default function PriceGainsRankingCard({ series, minYear, maxYear }: {
  series: GainSeries;
  minYear: number;
  maxYear: number;
}) {
  const [scope, setScope] = useState<string>("secondhand");
  const [metric, setMetric] = useState<0 | 1>(0); // 0=avg, 1=median
  const [fromY, setFromY] = useState(Math.max(minYear, maxYear - 3));
  const [toY, setToY] = useState(maxYear);

  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = minYear; y <= maxYear; y++) out.push(y);
    return out;
  }, [minYear, maxYear]);

  const items = useMemo(() => {
    const out: { city: string; pct: number }[] = [];
    for (const [city, scopes] of Object.entries(series)) {
      const from = scopes[scope]?.[fromY]?.[metric];
      const to = scopes[scope]?.[toY]?.[metric];
      if (!from || !to || from <= 0) continue;
      const pct = (to / from - 1) * 100;
      if (!Number.isFinite(pct) || Math.abs(pct) > 120) continue;
      out.push({ city, pct });
    }
    return out.sort((a, b) => b.pct - a.pct).slice(0, 5);
  }, [series, scope, metric, fromY, toY]);

  return (
    <div className="glass-card relative flex h-full flex-col overflow-hidden p-5">
      <div className="mb-3">
        <div className="mb-2.5 min-w-0">
          <span className="block break-words text-2xs font-black uppercase leading-snug tracking-wide text-slate-400"><Icon name="trend-up" size="1em" /> שינויי מחיר — לבחירתך</span>
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
            {years.filter((y) => y < toY).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="text-slate-400">←</span>
          <select value={toY} onChange={(e) => setToY(Number(e.target.value))}
            className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-bold tabular-nums">
            {years.filter((y) => y > fromY).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="text-2xs text-slate-400">10+ עסקאות בכל שנה</span>
        </div>
      </div>

      <ul className="space-y-1.5">
        {items.length === 0 && (
          <li className="text-xs text-slate-500 italic py-2 text-center">אין ערים עם דאטה מספק בטווח שנבחר</li>
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
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <Link href="/rankings/highest-gain" className="whitespace-nowrap text-2xs text-slate-400 hover:text-indigo-700 transition-colors">
          כל הדירוג →
        </Link>
        <span className="min-w-0 break-words text-2xs text-slate-400"><Icon name="source-own" size="1em" /> מאגר העסקאות · {fromY}→{toY}</span>
      </div>
    </div>
  );
}
