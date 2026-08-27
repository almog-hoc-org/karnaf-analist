"use client";

import { useState } from "react";
import { FromTo, YearRange } from "@/components/FromTo";
import type { CityPriceChanges } from "@/lib/price-changes";
import InfoTip from "@/components/InfoTip";

/**
 * The city-wide median-price change — a COMPLEMENTARY figure to the ₪/m²
 * graphs above it, and sized like one (operator, 8/2026): one framed row of
 * at most two lines at the bottom of the מגמות מחירים rubric, not a second
 * hero panel. It used to be a full glass-card section — window toggle row,
 * 5xl hero figure, a dimmed context window, an expandable explainer and a
 * NumberCaption — that repeated at full size what the studio's own change box
 * already headlines. Everything it said still exists: the method, the source,
 * the median-masks-variation caveat and the metric difference live in the ⓘ;
 * the thin-sample flag keeps its own ⚠; both windows stay one tap apart.
 *
 * The window lives in local state only — both windows' data ship together,
 * so switching never needs the server (see the removal note in git history:
 * ?window= made the whole city page request-time rendered for nothing).
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
  const [active, setActive] = useState<"3y" | "5y">(initialWindow);
  const activeChange = active === "3y" ? changes?.change3y : changes?.change5y;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-purple-200 bg-purple-50/40 px-3 py-2 sm:px-4">
      <span className="text-xs font-bold text-slate-800">
        שינוי מחיר חציוני בעיר
        <span className="hidden font-semibold text-purple-700 sm:inline"> · מדד משלים — מחיר מלא לדירה</span>
      </span>
      <InfoTip
        label="הסבר: שינוי המחיר החציוני"
        text={`בשונה מהגרפים למעלה (₪ למ״ר), המדד הזה מודד את מחיר העסקה החציוני המלא ב${cityName} — כמה עולה "הדירה האמצעית". השיטה: חציון רבעוני מ-nadlan.gov.il (רשות המסים), ממוצע שנתי, השוואה בין שנת הבסיס לשנה המלאה האחרונה — כדי לא להשוות מול שנה חלקית. חשוב: חציון עירוני מסתיר הבדלים בין שכונות — סקציית השכונות למטה מראה איפה עלה ואיפה ירד.`}
      />
      <span role="tablist" className="inline-flex items-center gap-1">
        {(["3y", "5y"] as const).map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setActive(w)}
            aria-pressed={active === w}
            className={`control-pill px-2 py-0.5 text-2xs ${active === w ? "control-pill-active" : ""}`}
          >
            {w === "3y" ? "3 שנים" : "5 שנים"}
          </button>
        ))}
      </span>
      {activeChange ? (
        <>
          <span
            dir="ltr"
            className={`text-lg font-black tabular-nums leading-none ${
              activeChange.pct >= 0 ? "text-emerald-700" : "text-red-700"
            }`}
          >
            {activeChange.pct >= 0 ? "▲ +" : "▼ "}
            {activeChange.pct.toFixed(1)}%
          </span>
          <span className="text-2xs text-slate-500">
            <YearRange from={activeChange.fromY} to={activeChange.toY} />
          </span>
          <span className="hidden text-2xs text-slate-500 sm:inline">
            <FromTo
              from={`₪${Math.round(activeChange.fromAvg).toLocaleString("he-IL")}`}
              to={`₪${Math.round(activeChange.toAvg).toLocaleString("he-IL")}`}
              size="xs"
            />
          </span>
          {activeChange.thin && (
            <span className="inline-flex items-center gap-0.5 text-2xs font-semibold text-amber-700">
              ⚠ מדגם דל
              <InfoTip
                label="מה זה מדגם דל"
                text="אחת משנות הקצה נשענת על רבעון בודד, או שהחלון הוזז בגלל שנים חסרות — קרא את המספר בזהירות."
              />
            </span>
          )}
        </>
      ) : (
        <span className="text-sm font-bold text-slate-400">— אין נתונים מספיקים</span>
      )}
      <span className="ms-auto text-2xs text-slate-400">מקור: nadlan.gov.il</span>
    </div>
  );
}
