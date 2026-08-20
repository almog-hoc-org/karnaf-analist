"use client";

import type { ReactNode } from "react";

/**
 * A ranked list of categories with proportional bars.
 *
 * The shape that appears five times in this dashboard — devices, traffic
 * sources, session lengths, adoption breadth, section reach — and was being
 * rewritten each time with slightly different alignment. A category, a bar, a
 * number, a share.
 *
 * The bar is scaled to the LARGEST ROW, not to the total: with five categories
 * a share-of-total scale leaves every bar short and the differences between
 * them unreadable, which is the opposite of what a ranked list is for. The
 * percentage of the total is printed next to it, so nothing is lost.
 */
export default function BarList({
  rows, emptyText = "אין נתונים בתקופה.", tone = "indigo",
}: {
  rows: Array<{ label: ReactNode; value: number; hint?: string }>;
  emptyText?: string;
  tone?: "indigo" | "emerald" | "amber";
}) {
  if (!rows.length) return <p className="py-2 text-xs text-slate-400">{emptyText}</p>;

  const max = Math.max(...rows.map((r) => r.value), 1);
  const total = rows.reduce((s, r) => s + r.value, 0);
  const fill = tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-indigo-500";

  return (
    <div className="space-y-1">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 text-xs" title={r.hint}>
          <span className="w-28 shrink-0 truncate text-slate-600 sm:w-36">{r.label}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${fill}`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="w-20 shrink-0 text-left tabular-nums text-slate-500">
            {r.value.toLocaleString("he-IL")}
            {total > 0 && <span className="text-slate-400"> · {Math.round((r.value / total) * 100)}%</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
