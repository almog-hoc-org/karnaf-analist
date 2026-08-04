import Link from "next/link";
import { computeAllCityGaps, describeSupplySource } from "@/lib/gap-analysis";
import Icon from "@/components/Icon";

export const metadata = { title: 'כיסוי נתוני היצע ופער ביקוש לכל הערים | קרנף אנליסט' };

function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return Math.round(v).toLocaleString("he-IL");
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(0)}%`;
}

export default async function SupplyCoveragePage() {
  const gaps = await computeAllCityGaps({ windowStart: 2020, windowEnd: 2024 });

  // Aggregate counters
  let withCompletions = 0;
  let withStarts = 0;
  let withPermits = 0;
  let noSupply = 0;
  let withDemand = 0;
  for (const g of gaps) {
    if (g.totals.chosenSource === "completions") withCompletions++;
    else if (g.totals.chosenSource === "starts") withStarts++;
    else if (g.totals.chosenSource === "permits") withPermits++;
    else noSupply++;
    if (g.totals.demand !== null) withDemand++;
  }

  // Sort by abs gap descending — most extreme imbalances first
  const sorted = [...gaps].sort((a, b) => {
    const ag = Math.abs(a.totals.gap ?? 0);
    const bg = Math.abs(b.totals.gap ?? 0);
    return bg - ag;
  });

  return (
    <main className="min-h-screen page-wrap-wide py-8">
      <header className="mb-8">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 bg-indigo-50 text-indigo-700"><Icon name="scale" size="1em" /></div>
          <div className="flex-1">
            <p className="text-2xs font-bold uppercase tracking-wider mb-1 text-indigo-700">היצע מול ביקוש</p>
            <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight leading-tight">פער היצע-ביקוש לפי עיר</h1>
            <p className="text-slate-600 text-base mt-1">
              חישוב הפער עם סולם פולבק: <strong>גמר בנייה ← התחלות בנייה ← היתרי בנייה</strong>.
              חלון: 2020-2024. {gaps.length} ערים בסה&quot;כ.
            </p>
          </div>
        </div>
      </header>

      {/* Counters */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8 [&>*:nth-child(5)]:col-span-2 md:[&>*:nth-child(5)]:col-span-1">
        <div className="kpi-card glow-indigo">
          <div className="stat-label">היצע מגמר בנייה</div>
          <div className="stat-large text-slate-900 mt-2 tabular-nums">{withCompletions}</div>
          <div className="text-2xs text-slate-500 mt-1">ערים עם גמר זמין</div>
        </div>
        <div className="kpi-card glow-indigo">
          <div className="stat-label">היצע מהתחלות</div>
          <div className="stat-large text-slate-900 mt-2 tabular-nums">{withStarts}</div>
          <div className="text-2xs text-slate-500 mt-1">פולבק שני</div>
        </div>
        <div className="kpi-card glow-indigo">
          <div className="stat-label">היצע מהיתרים</div>
          <div className="stat-large text-slate-900 mt-2 tabular-nums">{withPermits}</div>
          <div className="text-2xs text-slate-500 mt-1">פולבק שלישי</div>
        </div>
        <div className="kpi-card glow-slate">
          <div className="stat-label">ללא נתוני היצע</div>
          <div className="stat-large text-slate-500 mt-2 tabular-nums">{noSupply}</div>
          <div className="text-2xs text-slate-500 mt-1">חסר לגמרי</div>
        </div>
        <div className="kpi-card glow-indigo">
          <div className="stat-label">עם חישוב ביקוש</div>
          <div className="stat-large text-slate-900 mt-2 tabular-nums">{withDemand}</div>
          <div className="text-2xs text-slate-500 mt-1">מתוך {gaps.length}</div>
        </div>
      </section>

      {/* Coverage matrix */}
      <div className="glass-card overflow-hidden">
        <div className="h-1 bg-gradient-to-l from-indigo-500 to-indigo-600" />
        <div className="px-3 py-2 text-2xs text-slate-500 bg-slate-50 border-b border-slate-100">
          💡 הטבלה ממוינת לפי גודל הפער המוחלט (הכי קיצוני בראש). כל עיר היא קישור לעמוד המלא שלה.
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums" dir="rtl">
            <thead className="bg-slate-50 sticky top-0">
              <tr className="border-b border-slate-200">
                <th className="py-3 px-3 text-right text-xs text-slate-500 font-semibold sticky right-0 bg-slate-50">עיר</th>
                <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">נפשות/בית</th>
                <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">גידול אוכלוסייה</th>
                <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">דירות נדרשות</th>
                <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">היתרים<br /><span className="text-2xs text-slate-400">שנים</span></th>
                <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">התחלות<br /><span className="text-2xs text-slate-400">שנים</span></th>
                <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">גמר<br /><span className="text-2xs text-slate-400">שנים</span></th>
                <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">בסיס</th>
                <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">פער</th>
                <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">פער %</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((g) => {
                const meta = describeSupplySource(g.totals.chosenSource);
                const gapClass = g.totals.gap === null ? "text-slate-400"
                  : g.totals.gap >= 0 ? "text-emerald-700 font-bold"
                  : "text-red-600 font-bold";
                return (
                  <tr key={g.cityName} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-3 text-right sticky right-0 bg-white hover:bg-slate-50">
                      <Link href={`/city/${encodeURIComponent(g.cityName)}`} className="font-semibold text-slate-900 hover:text-indigo-700">
                        {g.cityName}
                      </Link>
                    </td>
                    <td className="py-2 px-3 text-center text-slate-700">{g.personsPerHousehold.toFixed(1)}</td>
                    <td className="py-2 px-3 text-center text-slate-500">{fmt(g.totals.popGrowth)}</td>
                    <td className="py-2 px-3 text-center text-slate-700 font-semibold">{fmt(g.totals.demand)}</td>
                    <td className="py-2 px-3 text-center text-slate-700">
                      {fmt(g.totals.permits)} <span className="text-2xs text-slate-400">({g.coverage.yearsWithPermits})</span>
                    </td>
                    <td className="py-2 px-3 text-center text-slate-700">
                      {fmt(g.totals.starts)} <span className="text-2xs text-slate-400">({g.coverage.yearsWithStarts})</span>
                    </td>
                    <td className="py-2 px-3 text-center text-slate-700">
                      {fmt(g.totals.completions)} <span className="text-2xs text-slate-400">({g.coverage.yearsWithCompletions})</span>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span className={`inline-block px-1.5 py-0.5 text-2xs font-bold rounded border ${meta.cls}`}>{meta.he}</span>
                    </td>
                    <td className={`py-2 px-3 text-center ${gapClass}`}>
                      {g.totals.gap !== null ? `${g.totals.gap >= 0 ? "+" : ""}${fmt(g.totals.gap)}` : "—"}
                    </td>
                    <td className={`py-2 px-3 text-center text-xs ${gapClass}`}>
                      {fmtPct(g.totals.gapPctOfDemand)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 leading-relaxed">
        <h3 className="font-bold text-slate-900 mb-2 text-sm">📋 שיטת החישוב</h3>
        <ul className="space-y-1 list-disc pr-5">
          <li><strong>דירות נדרשות (ביקוש)</strong> = גידול אוכלוסייה בחלון ÷ נפשות למשק בית. נפשות נלקח לפי עדיפות: יד2 (2026) ← מפקד 2022 (למ&quot;ס) ← ממוצע ארצי 3.27. קובץ המחקר הפנימי אינו משמש עוד לאמדן אוכלוסייה.</li>
          <li><strong>היצע</strong> נבחר פר שנה לפי סולם פולבק: <strong>גמר בנייה</strong> (איכותי ביותר) ← <strong>התחלות בנייה</strong> ← <strong>היתרי בנייה</strong>. הטבלה מציגה את כל שלושת המקורות כדי לראות שקיפות.</li>
          <li><strong>פער = היצע − ביקוש</strong>. מספר חיובי (ירוק) = עודף בנייה. מספר שלילי (אדום) = גרעון בנייה.</li>
          <li>החלון הנוכחי הוא 2020-2024. נתוני היתרי בנייה זמינים עד 2024, התחלות עד 2025, גמר בנייה — חסר ברוב הערים (חוזרים לחישוב על התחלות).</li>
        </ul>
      </div>
    </main>
  );
}
