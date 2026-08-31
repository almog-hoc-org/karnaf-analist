"use client";

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
 *   · Nothing is ranked "best" or "up and coming". The table sorts by price and
 *     shows the change beside it; the reader draws the conclusion.
 *   · NOTHING SCROLLS. Beside the map this table is one column of a two-column
 *     row, and a table that scrolls sideways inside a column nobody scrolls is
 *     data the reader never finds. The row height and the truncated name are
 *     what buy that: at py-1/text-xs a row is ~28px, so a full Tel Aviv list
 *     of 18 fits inside the square map beside it.
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
  /* No scrollIntoView here on purpose. It existed only because the table sat
     in a max-height scroll box; without that box its nearest scrollable
     ancestor is the DOCUMENT, so hovering a shape on the map would scroll the
     whole page out from under the reader. Every row is visible now anyway. */
  if (!rows.length) return null;

  const fmt = (v: number) => `₪${Math.round(v).toLocaleString("he-IL")}`;
  /* Beside the map the row budget is arithmetic, not taste: 18 rows have to
     land inside a square map of the same width as its column. */
  const padY = compact ? "py-1" : "py-2.5";
  const padX = compact ? "px-2.5" : "px-2.5 md:px-4";
  /* Standalone, the table used to stretch across the full 1120px page with a
     giant name column — centered at a readable width instead (operator,
     8/2026: "יפה וממורכזת גם בדסקטופ"). Compact (beside the map) the column
     is already the width budget. */
  const box = compact ? "" : "mx-auto w-full max-w-3xl";
  const top = rows[0], bottom = rows[rows.length - 1];
  const spread = bottom.sqm > 0 ? top.sqm / bottom.sqm : null;

  return (
    <section className={compact ? "" : "mb-10"}>
      {!compact && (
      <div className={`${box} mb-4 flex items-start gap-3`}>
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
        <p className={`${box} mb-3 rounded-2xl border border-indigo-200 bg-indigo-50/60 px-4 py-2.5 text-sm text-slate-700`}>
          הפער בתוך העיר: <b>{top.neighborhood}</b> יקרה פי {spread.toFixed(1)} מ־<b>{bottom.neighborhood}</b>
          {" "}({fmt(top.sqm)} מול {fmt(bottom.sqm)} למ״ר).
        </p>
      )}

      {/* No overflow-x-auto and no min-width: a forced 520px inside a 438px
          column is a horizontal scrollbar guaranteed by the CSS, whatever the
          content says.

          THE MOBILE WIDTHS ARE THE BUG FIX (operator, 8/2026: "בכלל לא רואים
          את השמות"). The desktop column widths summed to 384px of FIXED
          columns; a 375px phone offers the section 343px, so under table-fixed
          the auto-width NAME column got the leftover — negative, i.e. zero
          pixels — and truncate erased the names entirely, without even an
          ellipsis. Mobile now fixes only ~212px of numbers and the name keeps
          ~130px of real width. */}
      <div className={`${box} rounded-2xl border border-slate-200 bg-white`}>
        <table className={`w-full table-fixed ${compact ? "text-xs" : "text-sm"}`}>
          {/* change column shrank from w-40 to w-24: the year range now stacks
              under the value inside TrendValue instead of stretching beside it */}
          <colgroup>
            <col />
            <col className={compact ? "w-[5.5rem]" : "w-24 md:w-32"} />
            <col className={compact ? "w-16" : "w-[4.5rem] md:w-24"} />
            <col className={compact ? "w-14" : "w-11 md:w-24"} />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-2xs uppercase tracking-wide text-slate-500">
              <th scope="col" className={`${padX} ${padY} text-right font-bold`}>שכונה</th>
              <th scope="col" className={`px-1 md:px-2 ${padY} text-center font-bold`}>₪ למ״ר</th>
              <th scope="col" className={`px-1 md:px-2 ${padY} text-center font-bold`}>שינוי</th>
              <th scope="col" className={`px-1 md:px-2 ${padY} text-center font-bold`}>עסקאות</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.neighborhood}
                onMouseEnter={() => onHover?.(r.neighborhood)}
                onMouseLeave={() => onHover?.(null)}
                onClick={() => onPin?.(r.neighborhood)}
                className={`border-b border-slate-100 last:border-0 transition-colors ${
                  active === r.neighborhood ? "bg-sky-100" : onHover ? "cursor-pointer hover:bg-sky-50" : ""
                }`}
              >
                {/* Beside the map: truncate + title — a wrapped name doubles
                    its row and blows the table past the map. STANDALONE (the
                    only mode a phone ever sees): the name WRAPS — the names
                    are the whole point of the table, and a long one on two
                    lines beats an invisible one.
                    The name links to the neighbourhood's own page — it is the
                    Tax Authority spelling, which is exactly what that page's
                    URL is keyed on. stopPropagation so following the link does
                    not also fire the row's map-pin click. */}
                <th scope="row" className={`${padX} ${padY} ${compact ? "truncate" : "break-words"} text-right font-bold leading-snug text-slate-900`} title={r.neighborhood}>
                  <Link
                    href={`/city/${encodeURIComponent(cityName)}/neighborhood/${encodeURIComponent(r.neighborhood)}`}
                    className="hover:text-indigo-700 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.neighborhood}
                  </Link>
                </th>
                <td className={`px-1 md:px-2 ${padY} text-center font-bold tabular-nums text-slate-800`}>{fmt(r.sqm)}</td>
                <td className={`px-1 md:px-2 ${padY} text-center tabular-nums`}>
                  {r.changePct == null ? (
                    <span className="text-2xs text-slate-400">אין בסיס</span>
                  ) : (
                    /* years stacked under the value by TrendValue itself —
                       the site-wide pattern; the column narrows to the width
                       of the percentage */
                    <TrendValue pct={r.changePct} from={r.fromYear} to={year ?? undefined} />
                  )}
                </td>
                <td className={`px-1 md:px-2 ${padY} text-center tabular-nums text-slate-500`}>{r.n.toLocaleString("he-IL")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!compact && (
      <p className={`${box} mt-2 text-2xs leading-relaxed text-slate-400`}>
        <Icon name="source-own" size="1em" /> מחושב מהעסקאות שנאספו ונוקו — שם השכונה כפי שדווח לרשות המסים.
        עסקה ללא שכונה רשומה נכללת במספרי העיר ולא בטבלה הזו, ולכן ממוצע העיר שבכותרת מחושב מאותן עסקאות-שכונה בלבד.
        {" "}<Link href="/methodology" className="underline hover:text-indigo-700">מתודולוגיה →</Link>
      </p>
      )}
    </section>
  );
}
