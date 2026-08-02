"use client";

import { useMemo, useState } from "react";

/** Shape written by scripts/audit-data-reliability.ts → data/data-reliability.json */
export interface ReliabilityReport {
  generatedAt: string;
  thresholds: Record<string, number>;
  summary: { duplicates: number; cellsChecked: number; flagged: number; errors: number; warnings: number; citiesWithFlags: number };
  cities: { city: string; ok: number; warn: number; error: number; flagged: number }[];
  flags: Record<string, { level: "OK" | "WARN" | "ERROR"; reasons: string[] }>;
}

/** Shape written by scripts/verify-anomalies.ts → data/anomaly-verification.json */
export interface AnomalyVerification {
  generatedAt: string;
  params: Record<string, number>;
  national: { active: number; flagged: number; flag_rate_pct: number; violations_group: number; violations_city_net: number; pass: boolean };
  worst_flag_rates: { city: string; flag_rate_pct: number; active: number; flagged: number }[];
  cities_with_violations: { city: string; violations_group: number; violations_city_net: number }[];
}

/** Shape written by scripts/verify-cleaning-rules.ts → data/cleaning-verification.json */
export interface CleaningVerification {
  generatedAt: string;
  scanned: number;
  duplicates: { on: boolean; windowDays: number; sameBuildingMax: number; violations: number; samples: string[] };
  luxury: { on: boolean; minPrice: number; premiumPct: number; flaggedActive: number; violations: number; samples: string[] };
  reconciliation: { ok: boolean; total: number; active: number; excluded: number; merged: number; dupe: number; anomaly: number; sanity: number };
}

export default function AdminReliabilityPanel({ report, anomaly, cleaning }: { report: ReliabilityReport | null; anomaly?: AnomalyVerification | null; cleaning?: CleaningVerification | null }) {
  const [q, setQ] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);

  const rowsForCity = useMemo(() => {
    if (!report || !q.trim()) return [];
    return Object.entries(report.flags)
      .filter(([cell]) => cell.startsWith(q.trim() + "|"))
      .filter(([, f]) => !onlyErrors || f.level === "ERROR")
      .map(([cell, f]) => { const [, year, scope] = cell.split("|"); return { year, scope, ...f }; })
      .sort((a, b) => Number(a.year) - Number(b.year));
  }, [report, q, onlyErrors]);

  if (!report) {
    return <div className="glass-card p-5 text-sm text-slate-500">אין דוח אמינות עדיין — ירוץ אוטומטית בלילה, או הרץ <code className="rounded bg-slate-100 px-1">npx tsx scripts/audit-data-reliability.ts</code>.</div>;
  }
  const s = report.summary;

  return (
    <div className="space-y-4">
      {/* anomaly-rule verification (user Priority 2): proves 0 active deals violate the rules */}
      {anomaly && (
        <div className={`glass-card border-2 p-4 ${anomaly.national.pass ? "border-emerald-200" : "border-red-300"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-black text-slate-900">
              {anomaly.national.pass ? "✅" : "❌"} וידוא חוקי-האנומליות — {anomaly.national.pass ? "עובר בכל הערים" : "הפרות!"}
            </h3>
            <span className="text-2xs text-slate-400">עודכן {new Date(anomaly.generatedAt).toLocaleString("he-IL")}</span>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            {anomaly.national.active.toLocaleString("he-IL")} עסקאות בשימוש · {anomaly.national.flagged.toLocaleString("he-IL")} מסומנות אנומליה ({anomaly.national.flag_rate_pct}%) ·
            הפרות-קבוצה (סטייה &gt;{anomaly.params.anomaly_deviation_pct}% מחציון שכונה/עיר×שנה×חדרים×בניין): <b>{anomaly.national.violations_group}</b> ·
            הפרות רשת-ביטחון (&gt;{anomaly.params.anomaly_city_mult}× חציון-עיר): <b>{anomaly.national.violations_city_net}</b>
          </p>
          {anomaly.cities_with_violations.length > 0 && (
            <p className="mt-1 text-2xs font-bold text-red-600">ערים עם הפרות: {anomaly.cities_with_violations.map((c) => c.city).join(" · ")}</p>
          )}
          {anomaly.worst_flag_rates.length > 0 && (
            <p className="mt-1 text-2xs text-slate-400">
              שיעורי-סימון גבוהים: {anomaly.worst_flag_rates.slice(0, 5).map((c) => `${c.city} ${c.flag_rate_pct}%`).join(" · ")}
            </p>
          )}
        </div>
      )}

      {/* duplicate + luxury rule verification — re-derived from scratch every night */}
      {cleaning && (
        <div className={`glass-card border-2 p-4 ${cleaning.duplicates.violations === 0 && cleaning.luxury.violations === 0 && cleaning.reconciliation.ok ? "border-emerald-200" : "border-red-300"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-black text-slate-900">
              {cleaning.duplicates.violations === 0 && cleaning.luxury.violations === 0 ? "✅" : "❌"} וידוא כללי הניקוי — כפילויות דיווח ועסקאות יוקרה
            </h3>
            <span className="text-2xs text-slate-400">עודכן {new Date(cleaning.generatedAt).toLocaleString("he-IL")}</span>
          </div>
          <p className="mt-1 text-2xs text-slate-600" dir="rtl">
            נסרקו {cleaning.scanned.toLocaleString("he-IL")} עסקאות בשימוש ·
            כפילויות (חלון {cleaning.duplicates.windowDays} ימים, עד {cleaning.duplicates.sameBuildingMax} באותו בניין): <b>{cleaning.duplicates.violations}</b> הפרות ·
            יוקרה (מעל ₪{(cleaning.luxury.minPrice / 1e6).toFixed(1)}M וגם +{cleaning.luxury.premiumPct}%): {cleaning.luxury.flaggedActive.toLocaleString("he-IL")} מסומנות, <b>{cleaning.luxury.violations}</b> עדיין נכנסות לממוצע
          </p>
          <p className="mt-1 text-2xs text-slate-500" dir="rtl">
            התאמת ספירות: {cleaning.reconciliation.ok ? "תקינה" : "אי-התאמה"} — {cleaning.reconciliation.total.toLocaleString("he-IL")} = {cleaning.reconciliation.active.toLocaleString("he-IL")} בשימוש + {cleaning.reconciliation.excluded.toLocaleString("he-IL")} מוחרגות
            (מוזג {cleaning.reconciliation.merged.toLocaleString("he-IL")} · כפילות {cleaning.reconciliation.dupe.toLocaleString("he-IL")} · אנומליה {cleaning.reconciliation.anomaly.toLocaleString("he-IL")} · שפיות {cleaning.reconciliation.sanity.toLocaleString("he-IL")})
          </p>
          {(cleaning.duplicates.samples.length > 0 || cleaning.luxury.samples.length > 0) && (
            <ul className="mt-1 list-inside list-disc text-2xs text-red-600">
              {[...cleaning.duplicates.samples, ...cleaning.luxury.samples].slice(0, 4).map((v, i) => <li key={i}>{v}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: "כפילויות", val: s.duplicates, bad: s.duplicates > 0 },
          { label: "תאים שנבדקו", val: s.cellsChecked },
          { label: "שגיאות (מוסתרים)", val: s.errors, bad: s.errors > 0 },
          { label: "אזהרות (תווית)", val: s.warnings, warn: s.warnings > 0 },
          { label: "ערים מסומנות", val: s.citiesWithFlags },
        ].map((c) => (
          <div key={c.label} className="glass-card p-3 text-center">
            <div className={`text-2xl font-black tabular-nums ${c.bad ? "text-red-600" : c.warn ? "text-amber-600" : "text-slate-900"}`}>{Number(c.val).toLocaleString("he-IL")}</div>
            <div className="text-2xs text-slate-500">{c.label}</div>
          </div>
        ))}
      </div>
      <p className="text-2xs text-slate-400">
        עודכן {new Date(report.generatedAt).toLocaleString("he-IL")} · ספים: פער-מקורות &gt;{report.thresholds.CROSS_SOURCE_PCT}% · YoY &gt;{report.thresholds.YOY_PCT}% · מדגם מינ׳ {report.thresholds.MIN_N} · שנה חלקית &lt;{report.thresholds.PARTIAL_MIN_MONTHS} ח׳
      </p>

      {/* worst cities */}
      <div className="glass-card p-4">
        <h3 className="mb-2 text-sm font-black text-slate-900">ערים עם הכי הרבה סימונים</h3>
        <div className="flex flex-wrap gap-1.5">
          {report.cities.filter((c) => c.flagged > 0).slice(0, 24).map((c) => (
            <button key={c.city} onClick={() => setQ(c.city)}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-2xs font-bold text-slate-600 hover:border-indigo-300">
              {c.city} <span className="text-red-600">{c.error}</span>/<span className="text-amber-600">{c.warn}</span>
            </button>
          ))}
        </div>
      </div>

      {/* per-city drill-down */}
      <div className="glass-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="עיר (למשל תל אביב-יפו)…"
            className="w-56 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
          <label className="flex items-center gap-1.5 text-2xs text-slate-600">
            <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} className="rounded text-indigo-600" />
            רק שגיאות
          </label>
        </div>
        {q.trim() && rowsForCity.length === 0 && <p className="text-sm text-slate-400">אין סימונים ל"{q}" — הנתונים תקינים 🎉</p>}
        {rowsForCity.length > 0 && (
          <div className="overflow-x-auto">
          <table className="w-full text-2xs" dir="rtl">
            <thead><tr className="border-b border-slate-200 text-right font-bold text-slate-400"><th className="py-1">שנה</th><th>סוג</th><th>רמה</th><th>סיבות</th></tr></thead>
            <tbody>
              {rowsForCity.map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1.5 font-bold tabular-nums">{r.year}</td>
                  <td>{r.scope === "secondhand" ? "יד-2" : r.scope === "new" ? "חדשות" : "הכל"}</td>
                  <td><span className={`rounded px-1.5 py-0.5 font-bold ${r.level === "ERROR" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{r.level}</span></td>
                  <td className="text-slate-600">{r.reasons.join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
