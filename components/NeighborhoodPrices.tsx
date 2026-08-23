"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import TrendValue from "@/components/TrendValue";
import type { NeighborhoodSummary } from "@/lib/neighborhoods";

/**
 * Intra-city price spread — the most-asked question about any city, answered
 * for the first time from data the aggregation was already computing.
 *
 * Three deliberate restraints:
 *   · Every row shows its own n. A neighbourhood median off nine deals and one
 *     off nine hundred look identical unless the page says otherwise.
 *   · The comparison is against the city level computed FROM THESE SAME CELLS
 *     (lib/neighborhoods), not against the city stats table, which counts deals
 *     that carry no neighbourhood at all.
 *   · Nothing is ranked "best" or "up and coming". The table sorts by price and
 *     shows the change beside it; the reader draws the conclusion.
 */
export default function NeighborhoodPrices({
  cityName, rows, year, citySqm, minDeals, scopeLabel,
  active = null, onHover, onPin, compact = false,
}: {
  cityName: string;
  rows: NeighborhoodSummary[];
  year: number | null;
  citySqm: number | null;
  minDeals: number;
  scopeLabel: string;
  /* Sync with the map beside it. All optional: without them this is exactly
     the standalone table it has always been, which is what a city with no
     collected geometry still renders. */
  active?: string | null;
  onHover?: (name: string | null) => void;
  onPin?: (name: string | null) => void;
  /** inside the map section the heading lives on the section, not here */
  compact?: boolean;
}) {
  /* Hooks before the early return — React requires the same hooks on every
     render, and `rows` can legitimately be empty. */
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  useEffect(() => {
    if (!active) return;
    // Hovering a shape on the map should bring its row into view: with twenty
    // neighbourhoods the matching row is usually below the fold, and a
    // highlight nobody can see is not a highlight. `nearest` so the page does
    // not jump when the row is already visible.
    rowRefs.current[active]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  if (!rows.length) return null;

  const fmt = (v: number) => `₪${Math.round(v).toLocaleString("he-IL")}`;
  const top = rows[0], bottom = rows[rows.length - 1];
  const spread = bottom.sqm > 0 ? top.sqm / bottom.sqm : null;

  return (
    <section className={compact ? "" : "mb-10"}>
      {!compact && (
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-xl text-white shadow">
          <Icon name="building" size="1em" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-extrabold leading-tight text-slate-900 sm:text-2xl">
            שכונות ב{cityName} — מחיר למ״ר
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {scopeLabel} · {year} · רק שכונות עם {minDeals}+ עסקאות באותה שנה
            {citySqm ? ` · ממוצע העיר לפי אותן עסקאות: ${fmt(citySqm)}` : ""}
          </p>
        </div>
      </div>
      )}

      {!compact && spread && spread >= 1.15 && (
        <p className="mb-3 rounded-2xl border border-indigo-200 bg-indigo-50/60 px-4 py-2.5 text-sm text-slate-700">
          הפער בתוך העיר: <b>{top.neighborhood}</b> יקרה פי {spread.toFixed(1)} מ־<b>{bottom.neighborhood}</b>
          {" "}({fmt(top.sqm)} מול {fmt(bottom.sqm)} למ״ר).
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-2xs uppercase tracking-wide text-slate-500">
              <th scope="col" className="px-4 py-2.5 text-right font-bold">שכונה</th>
              <th scope="col" className="px-3 py-2.5 text-right font-bold">₪ למ״ר</th>
              <th scope="col" className="px-3 py-2.5 text-right font-bold">מול העיר</th>
              <th scope="col" className="px-3 py-2.5 text-right font-bold">שינוי</th>
              <th scope="col" className="px-3 py-2.5 text-right font-bold">עסקאות</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.neighborhood}
                ref={(el) => { rowRefs.current[r.neighborhood] = el; }}
                onMouseEnter={() => onHover?.(r.neighborhood)}
                onMouseLeave={() => onHover?.(null)}
                onClick={() => onPin?.(r.neighborhood)}
                className={`border-b border-slate-100 last:border-0 transition-colors ${
                  active === r.neighborhood ? "bg-sky-100" : onHover ? "cursor-pointer hover:bg-sky-50" : ""
                }`}
              >
                <th scope="row" className="px-4 py-2.5 text-right font-bold text-slate-900">{r.neighborhood}</th>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-800">{fmt(r.sqm)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {r.vsCityPct == null ? <span className="text-slate-300">—</span> : <TrendValue pct={r.vsCityPct} />}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {r.changePct == null ? (
                    <span className="text-2xs text-slate-400">אין {r.fromYear ?? "בסיס"} להשוואה</span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <TrendValue pct={r.changePct} />
                      <span className="text-2xs text-slate-400">מ־{r.fromYear}</span>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{r.n.toLocaleString("he-IL")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!compact && (
      <p className="mt-2 text-2xs leading-relaxed text-slate-400">
        <Icon name="source-own" size="1em" /> מחושב מהעסקאות שנאספו ונוקו — שם השכונה כפי שדווח לרשות המסים.
        עסקה ללא שכונה רשומה נכללת במספרי העיר ולא בטבלה הזו, ולכן ״מול העיר״ מושווה לממוצע של אותן עסקאות בלבד.
        {" "}<Link href="/methodology" className="underline hover:text-indigo-700">מתודולוגיה →</Link>
      </p>
      )}
    </section>
  );
}
