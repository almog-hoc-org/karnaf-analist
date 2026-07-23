"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import NumberCaption from "./NumberCaption";
import type { CityPriceChanges } from "@/lib/price-changes";

/**
 * 3y / 5y price-change panel with URL-param toggle.
 *
 * Selecting a window writes `?window=3y|5y` to the URL so the user can deep-link
 * to a specific view and so sibling components (e.g. CityNeighborhoods) can
 * read the same param and stay in sync.
 *
 * The active window's badge is rendered full-size; the inactive window is
 * dimmed and shown smaller for context. An expandable "💡 איך חישבנו" panel
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
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [explainerOpen, setExplainerOpen] = useState(false);

  // We track the window in local state too so the UI flips instantly while the
  // URL update is in transit.
  const [active, setActive] = useState<"3y" | "5y">(initialWindow);

  function chooseWindow(w: "3y" | "5y") {
    if (w === active) return;
    setActive(w);
    const params = new URLSearchParams(sp);
    params.set("window", w);
    startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
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
          <p className="text-[11px] text-slate-500 mt-0.5">
            מקור: nadlan.gov.il • חציון רבעוני, ממוצע שנתי
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

      {/* Active window — big hero */}
      <div
        className={`rounded-2xl border p-5 transition-all bg-indigo-50/40 border-indigo-100 ${
          isPending ? "opacity-60" : "opacity-100"
        }`}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
              {active === "3y" ? "3 שנים" : "5 שנים"}
            </div>
            {activeChange ? (
              <>
                <div className={`text-5xl font-black tabular-nums leading-none mt-1 ${
                  activeChange.pct >= 0 ? "text-emerald-700" : "text-red-700"
                }`}>
                  {activeChange.pct >= 0 ? "▲ +" : "▼ "}{activeChange.pct.toFixed(1)}%
                </div>
                <div className="text-xs text-slate-600 mt-2">
                  {activeChange.fromY} → {activeChange.toY} •{" "}
                  ₪{Math.round(activeChange.fromAvg).toLocaleString("he-IL")} → ₪
                  {Math.round(activeChange.toAvg).toLocaleString("he-IL")}
                </div>
              </>
            ) : (
              <div className="text-2xl font-bold text-slate-400 mt-2">— אין נתונים מספיקים</div>
            )}
          </div>

          {/* Context (the inactive window, smaller) */}
          {contextChange && (
            <div className="opacity-50 text-right">
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">
                לעומת {contextLabel}
              </div>
              <div className={`text-2xl font-bold tabular-nums ${
                contextChange.pct >= 0 ? "text-emerald-700" : "text-red-700"
              }`}>
                {contextChange.pct >= 0 ? "+" : ""}{contextChange.pct.toFixed(1)}%
              </div>
              <div className="text-[10px] text-slate-500">
                {contextChange.fromY}→{contextChange.toY}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Explainer toggle */}
      <button
        type="button"
        onClick={() => setExplainerOpen((x) => !x)}
        className="mt-3 text-[11px] font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1"
      >
        💡 איך חישבנו (ומה המספר הזה לא אומר)
        <span className="text-slate-400">{explainerOpen ? "▲" : "▼"}</span>
      </button>

      {explainerOpen && (
        <div className="mt-2 rounded-xl bg-indigo-50/50 border border-indigo-100 p-4 text-[12px] text-slate-700 leading-relaxed">
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
          <p className="text-[11px] text-slate-500 mt-2">
            ⚠ הערה: שנת הסיום היא לפעמים <em>חלקית</em> (למשל 2025 כולל רק רבעון 1 לעיתים) — מה שמשקלל את המספר
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
