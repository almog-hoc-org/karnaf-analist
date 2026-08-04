"use client";

import { useState } from "react";
import Link from "next/link";
import type { MarketInsight } from "@/lib/marketInsights";
import TrendValue from "@/components/TrendValue";
import Icon from "@/components/Icon";

/**
 * "תובנות שוק" — 4 insights at a time from a large tier-mixed pool; the
 * "show more" button rotates to the next 4 (no refetch, pool is server-built).
 */
export default function MarketInsightsSection({ insights }: { insights: MarketInsight[] }) {
  const [page, setPage] = useState(0);
  if (insights.length === 0) return null;

  const pages = Math.max(1, Math.ceil(insights.length / 4));
  const shown = insights.slice((page % pages) * 4, (page % pages) * 4 + 4);

  return (
    <section className="mt-14">
      <div className="section-header mb-6">
        <div className="section-header-icon"><Icon name="idea" size="1em" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-black text-slate-900">תובנות שוק</h2>
          <p className="text-xs text-slate-500 mt-0.5">מחושבות אוטומטית ממאגר העסקאות · לחיצה על תובנה מובילה לעיר</p>
        </div>
        <button
          type="button"
          onClick={() => setPage((p) => p + 1)}
          className="shrink-0 rounded-full border border-indigo-200 bg-white px-4 py-2 text-xs font-bold text-indigo-700 shadow-sm transition-all hover:bg-indigo-50 hover:shadow"
        >
          <Icon name="refresh" size="1em" /> הצג תובנות נוספות
        </button>
      </div>

      <div className="card-grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        {shown.map((ins) => (
          <Link
            key={ins.key}
            href={ins.href}
            className="glass-card group flex h-full flex-col gap-2.5 p-5 transition-transform hover:-translate-y-0.5"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 basis-40 items-center gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-base">
                  <Icon name={ins.icon} size="1em" />
                </span>
                <h3 className="min-w-0 break-words text-sm font-extrabold leading-snug text-slate-900 group-hover:text-indigo-700">
                  {ins.title}
                </h3>
              </div>
              {ins.value != null && (
                <span className="shrink-0">
                  <TrendValue pct={ins.value} chip />
                </span>
              )}
            </div>
            <p className="text-xs leading-relaxed text-slate-600">{ins.body}</p>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-slate-100 pt-2.5">
              <span className="min-w-0 break-words text-2xs font-semibold text-slate-400">{ins.valueLabel}</span>
              <span className="min-w-0 break-words text-2xs text-slate-400">{ins.provenance}</span>
            </div>
          </Link>
        ))}
      </div>
      <div className="mt-2 text-center text-2xs text-slate-400">
        {((page % pages) + 1)} / {pages} · {insights.length} תובנות במאגר
      </div>
    </section>
  );
}
