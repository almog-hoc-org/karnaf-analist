"use client";

import { useState } from "react";
import { FromTo, YearRange } from "@/components/FromTo";
import NumberCaption from "./NumberCaption";
import type { CityPriceChanges } from "@/lib/price-changes";
import Icon from "@/components/Icon";

/**
 * 3y / 5y price-change panel. The window lives in local state only.
 *
 * IT USED TO WRITE `?window=3y|5y` TO THE URL. That was removed, because
 * reading the param server-side made /city/[slug] a request-time render — ~25
 * DB queries per visitor on the page the public actually lands on — and the
 * round-trip bought nothing:
 *
 *   - `initialWindow` only ever seeded useState, and React ignores that
 *     argument after the first render, so the value the server recomputed on
 *     the replace() was already being discarded.
 *   - `changes` carries BOTH change3y and change5y, so switching is a pick
 *     between two objects already in memory — no server round-trip needed.
 *   - The old doc comment claimed sibling components read the same param to
 *     stay in sync. No such component exists; this was the only reader.
 *
 * Cost of the removal: `?window=3y` is no longer deep-linkable, and window
 * changes no longer appear in browser history.
 *
 * The active window's badge is rendered full-size; the inactive window is
 * dimmed and shown smaller for context. An expandable "<Icon name="idea" size="1em" /> איך חישבנו" panel
 * explains provenance + the median-masks-variation caveat.
 */
export default function PriceChangePanel({
  changes,
  initialWindow,
  cityName,
}: {
  changes: CityPriceChanges | null;
  initialWindow: "3y" | "5y";
  cityName: string;
}) {
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [active, setActive] = useState<"3y" | "5y">(initialWindow);

  function chooseWindow(w: "3y" | "5y") {
    if (w === active) return;
    setActive(w);
  }

  const activeChange = active === "3y" ? changes?.change3y : changes?.change5y;
  const contextChange = active === "3y" ? changes?.change5y : changes?.change3y;
  const contextLabel = active === "3y" ? "5 שנים" : "3 שנים";

  return (
    <section className="glass-card p-5 mb-6">
      {/* Header row — title + toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-slate-900">שינוי מחיר חציוני בעיר</h3>
          <p className="mt-0.5 truncate text-2xs text-slate-500" title="מקור: nadlan.gov.il · חציון רבעוני, ממוצע שנתי">
            מקור: nadlan.gov.il
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5" role="tablist">
          <button
            type="button"
            onClick={() => chooseWindow("3y")}
            aria-pressed={active === "3y"}
            className={`control-pill ${active === "3y" ? "control-pill-active" : ""}`}
          >
            3 שנים
          </button>
          <button
            type="button"
            onClick={() => chooseWindow("5y")}
            aria-pressed={active === "5y"}
            className={`control-pill ${active === "5y" ? "control-pill-active" : ""}`}
          >
            5 שנים
          </button>
        </div>
      </div>

      {/* Active window — big hero.
          The dim-while-pending state is gone with the URL round-trip: the swap
          is now a local state update, so there is no in-flight moment to signal. */}
      <div className="rounded-2xl border p-5 transition-all bg-indigo-50/40 border-indigo-100">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-2xs font-bold text-slate-500 uppercase tracking-wide">
              {active === "3y" ? "3 שנים" : "5 שנים"}
            </div>
            {activeChange ? (
              <>
                <div className={`text-4xl sm:text-5xl font-black tabular-nums leading-none mt-1 ${
                  activeChange.pct >= 0 ? "text-emerald-700" : "text-red-700"
                }`}>
                  {activeChange.pct >= 0 ? "▲ +" : "▼ "}{activeChange.pct.toFixed(1)}%
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-slate-600">
                  <YearRange from={activeChange.fromY} to={activeChange.toY} />
                  <span aria-hidden className="text-slate-300">•</span>
                  <FromTo
                    from={`₪${Math.round(activeChange.fromAvg).toLocaleString("he-IL")}`}
                    to={`₪${Math.round(activeChange.toAvg).toLocaleString("he-IL")}`}
                    size="xs"
                  />
                </div>
              </>
            ) : (
              <div className="text-2xl font-bold text-slate-400 mt-2">— אין נתונים מספיקים</div>
            )}
          </div>

          {/* Context (the inactive window, smaller) */}
          {contextChange && (
            <div className="opacity-50 text-right">
              <div className="text-2xs font-bold text-slate-500 uppercase tracking-wide">
                לעומת {contextLabel}
              </div>
              <div className={`text-2xl font-bold tabular-nums ${
                contextChange.pct >= 0 ? "text-emerald-700" : "text-red-700"
              }`}>
                {contextChange.pct >= 0 ? "+" : ""}{contextChange.pct.toFixed(1)}%
              </div>
              <div className="text-2xs text-slate-500">
                <YearRange from={contextChange.fromY} to={contextChange.toY} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Explainer toggle */}
      <button
        type="button"
        onClick={() => setExplainerOpen((x) => !x)}
        className="mt-3 text-2xs font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1"
      >
        <Icon name="idea" size="1em" /> איך חישבנו (ומה המספר הזה לא אומר)
        <span className="text-slate-400">{explainerOpen ? "▲" : "▼"}</span>
      </button>

      {explainerOpen && (
        <div className="mt-2 rounded-xl bg-indigo-50/50 border border-indigo-100 p-4 text-xs text-slate-700 leading-relaxed">
          <p className="mb-2">
            <strong>השיטה:</strong> אנחנו לוקחים את <strong>חציון</strong> המחירים של כל עסקאות הדירות בעיר{" "}
            <em>{cityName}</em> בכל רבעון, מחשבים ממוצע שנתי, ומשווים בין שנת הבסיס לשנה האחרונה הזמינה.
          </p>
          <p className="mb-2">
            <strong>המקור:</strong>{" "}
            <a
              href="https://www.nadlan.gov.il"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-700 font-semibold hover:underline"
            >
              nadlan.gov.il
            </a>{" "}
            (רשות המסים) — מאגר רשמי של כל עסקאות הנדל&quot;ן בישראל.
          </p>
          <p className="mb-1">
            <strong>למה זה לפעמים מטעה:</strong> חציון עירוני <em>מסתיר וריאציה בין שכונות</em>. בתל אביב לדוגמה,
            המדיאן עלה ב-+29% ב-5 שנים — אבל פלורנטין ירדה תוך כדי, וצפון ת&quot;א זינקה. הסתכל על
            <strong> סקציית השכונות</strong> למטה כדי לראות איפה היה גידול ואיפה הייתה ירידה.
          </p>
          <p className="text-2xs text-slate-500 mt-2">
            <Icon name="warning" size="1em" /> הערה: שנת הסיום היא לפעמים <em>חלקית</em> (למשל 2025 כולל רק רבעון 1 לעיתים) — מה שמשקלל את המספר
            כלפי תחילת השנה.
          </p>
        </div>
      )}

      <div className="mt-4">
        <NumberCaption
          source="nadlan.gov.il"
          sourceHref="https://www.nadlan.gov.il"
          period={
            activeChange
              ? `${activeChange.fromY}-${activeChange.toY}`
              : changes?.change5y
              ? `${changes.change5y.fromY}-${changes.change5y.toY}`
              : "—"
          }
          method="חציון רבעוני • ממוצע שנתי"
        />
      </div>
    </section>
  );
}
