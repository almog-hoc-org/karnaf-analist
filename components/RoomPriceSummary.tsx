"use client";

import { useMemo, useState } from "react";
import InfoTip from "@/components/InfoTip";
import TrendValue from "@/components/TrendValue";
import { MIN_N_HIDE, pickWindow, gradeTrend, type TrendConfidence } from "@/lib/confidence";
import type { CityGraphData, StatPoint } from "@/lib/nadlanTransactionSeries";

/**
 * מחירים לפי גודל דירה — ONE ORDERLY TABLE (operator, 8/2026: "בטבלה מסודרת
 * עם חלוקה ברורה לפי גודל חדרים ושינויי המחיר").
 *
 * This replaces a 3-card grid that stacked three scope blocks inside each
 * card — nine little boxes nobody could compare across. Now: one scope
 * selector on top (יד שנייה / חדשות / כללי), one row per apartment size, and
 * the change over 3 / 5 / 10 years as columns, so "did 4-room flats rise more
 * than 3-room" is a glance along a row and "which size rose most" a glance
 * down a column.
 *
 * Three correctness upgrades over the old component:
 *   · MEDIANS, not averages, headline the levels — they were already loaded
 *     and thrown away. The average remains in the cell's title.
 *   · The change windows go through pickWindow + gradeTrend
 *     (lib/confidence.ts) — the site's ONE window policy (slide the start
 *     forward at most 2 years, never slide the end, n-floors 10/30, ±80%
 *     outlier brake) instead of a private change() that slid silently up to
 *     a decade.
 *   · The trend chip is the shared TrendValue — real minus sign, shared
 *     palette — replacing a local reimplementation that drifted.
 *
 * Client component, zero network: everything below derives from the
 * CityGraphData the page already ships for the charts.
 */

type ScopeKey = "secondhand" | "new" | "all";
const SCOPE_LABEL: Record<ScopeKey, string> = { secondhand: "יד שנייה", new: "חדשות", all: "כללי" };
const SCOPES: ScopeKey[] = ["secondhand", "new", "all"];
const BUCKETS = [
  { key: "all" as const, label: "כל הגדלים" },
  { key: "3" as const, label: "3 חדרים" },
  { key: "4" as const, label: "4 חדרים" },
  { key: "5" as const, label: "5+ חדרים" },
];
const WINDOWS = [3, 5, 10] as const;

const nis = (v: number | null) => (v == null ? "—" : `₪${Math.round(v).toLocaleString("he-IL")}`);
const nisM = (v: number | null) => (v == null ? "—" : `₪${(v / 1_000_000).toFixed(2)}M`);

interface BucketRow {
  key: string;
  label: string;
  end: StatPoint;
  changes: Record<number, TrendConfidence>;
}

/** All usable rows of one scope — null end-year cell drops the row. */
function buildRows(data: CityGraphData, scope: ScopeKey, endYear: number): BucketRow[] {
  const out: BucketRow[] = [];
  for (const b of BUCKETS) {
    const points = data.nadlan[scope]?.[b.key] ?? [];
    const end = points.find((p) => p.year === endYear);
    if (!end || end.n < MIN_N_HIDE || (end.medianSqm == null && end.avgSqm == null)) continue;
    const changes: Record<number, TrendConfidence> = {};
    for (const win of WINDOWS) {
      const { from, to } = pickWindow(points, win, endYear);
      changes[win] = gradeTrend({
        from: from ? from.medianSqm ?? from.avgSqm : null,
        to: to ? to.medianSqm ?? to.avgSqm : null,
        fromYear: from?.year, toYear: to?.year, fromN: from?.n, toN: to?.n,
      });
    }
    out.push({ key: b.key, label: b.label, end, changes });
  }
  return out;
}

function ChangeCell({ c }: { c: TrendConfidence }) {
  if (!c.displayable || c.value == null) return <span className="text-slate-300">—</span>;
  return (
    <span className="inline-flex items-center justify-center gap-0.5 whitespace-nowrap">
      <TrendValue pct={c.value} from={c.fromYear} to={c.toYear} />
      {c.warnings.length > 0 && (
        <InfoTip label="הסתייגות על המספר" text={`${c.warnings.join(" · ")} (${c.fromN ?? "?"}/${c.toN ?? "?"} עסקאות בקצוות)`} />
      )}
    </span>
  );
}

export default function RoomPriceSummary({ data, classificationRate = null }: {
  data: CityGraphData;
  classificationRate?: number | null;
}) {
  const endYear = data.lastUsableYear ?? data.lastFullYear;
  const byScope = useMemo(() => {
    if (endYear == null) return null;
    const m = new Map<ScopeKey, BucketRow[]>();
    for (const s of SCOPES) m.set(s, buildRows(data, s, endYear));
    return m;
  }, [data, endYear]);
  // Default to the scope people actually mean by "מחירי דירות" — second-hand —
  // falling forward to the first scope that has anything to show.
  const firstWithRows = SCOPES.find((s) => (byScope?.get(s)?.length ?? 0) > 0);
  const [scope, setScope] = useState<ScopeKey>(firstWithRows ?? "secondhand");

  if (endYear == null || !byScope || !firstWithRows) return null;
  const rows = (byScope.get(scope)?.length ? byScope.get(scope) : byScope.get(firstWithRows)) ?? [];
  if (!rows.length) return null;

  const endMonths = data.monthsByYear?.[endYear];
  const partialNote =
    data.partialYears?.includes(endYear) && endMonths
      ? ` · ${endYear} חלקית — ${endMonths} חודשים שנקלטו עד כה`
      : "";

  return (
    <section className="mb-10">
      <div className="section-header">
        <div className="section-header-icon">🚪</div>
        <div>
          <h2 className="flex items-center gap-2 flex-wrap">
            מחירים לפי גודל דירה
            <InfoTip text={`מחיר חציוני ל-${endYear} לכל גודל דירה, ושינוי ה-₪/מ״ר החציוני על חלונות של 3, 5 ו-10 שנים (הסוף תמיד השנה השמישה האחרונה; התחלה חסרה מוחלקת קדימה עד שנתיים). אותם ספי מדגם כמו בגרפים: תא מתחת ל-10 עסקאות לא מוצג, קצה מתחת ל-30 מסומן.`} />
          </h2>
          <p>{endYear} · מאגר העסקאות העצמאי{partialNote}</p>
        </div>
      </div>

      {/* scope selector — one choice for the whole table, instead of the old
          nine boxes (3 sizes × 3 scopes) nobody could compare across */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="text-2xs font-bold text-slate-500">סוג עסקה:</span>
        {SCOPES.map((s) => {
          const off = (byScope.get(s)?.length ?? 0) === 0;
          return (
            <button
              key={s}
              type="button"
              disabled={off}
              onClick={() => !off && setScope(s)}
              title={off ? `אין מספיק עסקאות ${SCOPE_LABEL[s]} ב-${endYear}` : undefined}
              className={`control-pill px-2.5 py-1 text-2xs sm:text-xs ${scope === s ? "control-pill-active" : ""} ${off ? "cursor-not-allowed opacity-40" : ""}`}
            >
              {SCOPE_LABEL[s]}
            </button>
          );
        })}
      </div>

      <div className="glass-card overflow-hidden">
        <table className="w-full text-xs sm:text-sm" dir="rtl">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-2xs uppercase tracking-wide text-slate-500">
              <th scope="col" className="px-2.5 py-2.5 text-right font-bold sm:px-4">גודל</th>
              <th scope="col" className="px-1.5 py-2.5 text-center font-bold sm:px-2">₪ למ״ר<span className="hidden font-medium text-slate-400 sm:inline"> · חציוני</span></th>
              <th scope="col" className="px-1.5 py-2.5 text-center font-bold sm:px-2">מחיר דירה<span className="hidden font-medium text-slate-400 sm:inline"> · חציוני</span></th>
              {/* mobile keeps the ONE most useful change window (5y); the rest
                  return at sm — four columns fit 343px, seven do not */}
              <th scope="col" className="hidden px-2 py-2.5 text-center font-medium text-slate-400 sm:table-cell">שינוי 3 שנים</th>
              <th scope="col" className="px-1.5 py-2.5 text-center font-bold sm:px-2 sm:font-medium sm:text-slate-400">שינוי 5 שנים</th>
              <th scope="col" className="hidden px-2 py-2.5 text-center font-medium text-slate-400 sm:table-cell">שינוי 10 שנים</th>
              <th scope="col" className="hidden px-2 py-2.5 text-center font-medium text-slate-400 sm:table-cell">עסקאות {endYear}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                className={`border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 ${r.key === "all" ? "bg-indigo-50/40" : ""}`}
              >
                <th scope="row" className={`px-2.5 py-2 text-right sm:px-4 ${r.key === "all" ? "font-black" : "font-bold"} text-slate-900`}>
                  {r.label}
                </th>
                <td
                  className="px-1.5 py-2 text-center font-bold tabular-nums text-slate-800 sm:px-2"
                  title={r.end.avgSqm != null ? `ממוצע: ${nis(r.end.avgSqm)}` : undefined}
                >
                  {nis(r.end.medianSqm ?? r.end.avgSqm)}
                </td>
                <td
                  className="px-1.5 py-2 text-center font-semibold tabular-nums text-slate-700 sm:px-2"
                  title={r.end.avgPrice != null ? `ממוצע: ${nisM(r.end.avgPrice)}` : undefined}
                >
                  {nisM(r.end.medianPrice ?? r.end.avgPrice)}
                </td>
                <td className="hidden px-2 py-2 text-center sm:table-cell"><ChangeCell c={r.changes[3]} /></td>
                <td className="px-1.5 py-2 text-center sm:px-2"><ChangeCell c={r.changes[5]} /></td>
                <td className="hidden px-2 py-2 text-center sm:table-cell"><ChangeCell c={r.changes[10]} /></td>
                <td className="hidden px-2 py-2 text-center tabular-nums text-slate-500 sm:table-cell">{r.end.n.toLocaleString("he-IL")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* one line on screen, the whole caveat behind the ⓘ */}
      <p className="mt-2 flex items-center gap-1 text-2xs text-slate-400">
        <span className="truncate">חציונים · שינוי לפי ₪/מ״ר חציוני · תא רק עם 10+ עסקאות</span>
        <InfoTip
          label="על מה מבוססים המספרים"
          text={`מחיר חציוני (הממוצע בריחוף על התא) על עסקאות שנאספו ונוקו; שינוי מחושב על ה-₪/מ״ר החציוני בין קצות החלון. תא מתחת ל-10 עסקאות לא מוצג; ⚠ = קצה עם פחות מ-30 עסקאות או שינוי חריג. יד-2/חדשות מחושבים מעסקאות שיש בהן שנת בנייה בלבד${
            classificationRate != null && classificationRate < 0.5
              ? ` (${Math.round(classificationRate * 100)}% מהעסקאות ב${data.cityName})`
              : ""
          }.`}
        />
      </p>
    </section>
  );
}
