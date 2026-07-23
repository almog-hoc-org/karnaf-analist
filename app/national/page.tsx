import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  DISTRICT_TARGETS_2021_2030,
  NATIONAL_TARGETS,
  NON_JEWISH_SHORTFALL_2006_2022,
  HEADLINE_FINDINGS,
  ANNUAL_DEMAND_FORECAST,
} from "@/lib/housing-committee";
import NationalConstructionChart from "@/components/NationalConstructionChart";
import DistrictTargetsChart from "@/components/DistrictTargetsChart";
import ShortfallBarChart from "@/components/ShortfallBarChart";
import PlanVsActualChart from "@/components/PlanVsActualChart";
import SourceBadge from "@/components/SourceBadge";

export const metadata = { title: 'דשבורד לאומי | קרנף אנליסט' };

function fmtK(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)} אלף`;
  return n.toLocaleString("he-IL");
}
function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Math.round(n).toLocaleString("he-IL");
}

export default async function NationalDashboard() {
  // ─── National construction series (already in DB) ───
  const nat = await prisma.national_construction.findMany({ orderBy: { year: "asc" } });

  // ─── Population (from cities table — sum of latest pop_2026 estimates) ───
  const cities = await prisma.city.findMany({
    select: { population_2021: true, population_2026: true, population_growth_abs: true },
  });
  const totalPop2026 = cities.reduce((s, c) => s + (c.population_2026 ?? 0), 0);
  const totalGrowth = cities.reduce((s, c) => s + (c.population_growth_abs ?? 0), 0);

  // ─── Decade totals from national_construction ───
  const last10 = nat.filter((r) => r.year >= 2016 && r.year <= 2025);
  const sum = (k: "permits" | "starts" | "completions") =>
    last10.reduce((s, r) => s + (r[k] ?? 0), 0);
  const totals10y = {
    permits: sum("permits"),
    starts: sum("starts"),
    completions: sum("completions"),
  };

  // ─── Annual averages (last 4 years for comparison to committee targets) ───
  const last4 = nat.filter((r) => r.year >= 2021 && r.year <= 2024);
  const avgAnnualCompletions = last4.length > 0
    ? Math.round(last4.reduce((s, r) => s + (r.completions ?? 0), 0) / last4.length)
    : 0;
  const targetAnnual2125 = NATIONAL_TARGETS.total_annual_2021_2025 * 1000;
  const actualVsTargetPct = ((avgAnnualCompletions - targetAnnual2125) / targetAnnual2125) * 100;
  const annualShortfall = avgAnnualCompletions - targetAnnual2125;

  // ─── Plan-vs-Actual: Committee 2021-2025 חומש (5y) vs actual from DB ───
  const period2125 = nat.filter((r) => r.year >= 2021 && r.year <= 2025);
  const actual2125 = {
    completions: period2125.reduce((s, r) => s + (r.completions ?? 0), 0),
    starts:      period2125.reduce((s, r) => s + (r.starts ?? 0), 0),
    permits:     period2125.reduce((s, r) => s + (r.permits ?? 0), 0),
  };
  const target2125Cumulative = targetAnnual2125 * 5; // 299,000
  const completionsGap2125 = actual2125.completions - target2125Cumulative;
  const startsGap2125 = actual2125.starts - target2125Cumulative;
  const permitsGap2125 = actual2125.permits - target2125Cumulative;

  // Cumulative chart data — committee target plot vs running sum of each metric
  const cumulativeData = (() => {
    let cumPerm = 0, cumStart = 0, cumComp = 0;
    return period2125.map((r, idx) => {
      cumPerm += r.permits ?? 0;
      cumStart += r.starts ?? 0;
      cumComp += r.completions ?? 0;
      return {
        year: r.year,
        permitsCumulative: cumPerm,
        startsCumulative: cumStart,
        completionsCumulative: cumComp,
        targetCumulative: targetAnnual2125 * (idx + 1),
      };
    });
  })();

  return (
    <main className="min-h-screen px-4 py-8 max-w-7xl mx-auto">
      {/* ─── Header ─── */}
      <header className="mb-8">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0 bg-indigo-50 text-indigo-700">
            🇮🇱
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1 text-indigo-700">National Overview</p>
            <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight leading-tight flex items-center gap-3 flex-wrap">
              שוק הדיור בישראל — מבט לאומי <SourceBadge kind="external" name='למ"ס + משרד האוצר' />
            </h1>
            <p className="text-slate-600 text-base mt-1">
              נתוני מאקרו 2016-2025 מהלמ&quot;ס • יעדי <strong>הוועדה לפתרון משבר הדיור</strong> (התוכנית האסטרטגית לדיור 2017-2040, מעקב 2021) • פערים בפועל
            </p>
          </div>
        </div>
      </header>

      {/* ─── Mega KPIs ─── */}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-10">
        <div className="kpi-card glow-indigo">
          <div className="stat-label">אוכלוסייה 2026</div>
          <div className="stat-large text-slate-900 mt-2 tabular-nums">{fmtK(totalPop2026)}</div>
          <div className="text-[10px] text-slate-500 mt-1">סכום {cities.length} הערים ב-DB</div>
        </div>
        <div className="kpi-card glow-indigo">
          <div className="stat-label">היתרי בנייה 10 שנים</div>
          <div className="stat-large text-slate-900 mt-2 tabular-nums">{fmtK(totals10y.permits)}</div>
          <div className="text-[10px] text-slate-500 mt-1">2016-2025</div>
        </div>
        <div className="kpi-card glow-indigo">
          <div className="stat-label">התחלות בנייה 10 שנים</div>
          <div className="stat-large text-slate-900 mt-2 tabular-nums">{fmtK(totals10y.starts)}</div>
          <div className="text-[10px] text-slate-500 mt-1">2016-2025</div>
        </div>
        <div className="kpi-card glow-indigo">
          <div className="stat-label">גמר בנייה 10 שנים</div>
          <div className="stat-large text-slate-900 mt-2 tabular-nums">{fmtK(totals10y.completions)}</div>
          <div className="text-[10px] text-slate-500 mt-1">2016-2025</div>
        </div>
        <div className={`kpi-card ${annualShortfall < 0 ? "glow-red" : "glow-emerald"}`}>
          <div className="stat-label">פער שנתי מול יעד הוועדה</div>
          <div className={`stat-large mt-2 tabular-nums ${annualShortfall < 0 ? "text-red-600" : "text-emerald-700"}`}>
            {annualShortfall >= 0 ? "+" : ""}{fmtK(annualShortfall)}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            {fmt(avgAnnualCompletions)} בפועל / {fmt(targetAnnual2125)} יעד ({actualVsTargetPct >= 0 ? "+" : ""}{actualVsTargetPct.toFixed(0)}%)
          </div>
        </div>
      </section>

      {/* ─── National construction 10y chart ─── */}
      <section className="glass-card overflow-hidden mb-10">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">בנייה ארצית 2016-2025</h2>
            <p className="text-xs text-slate-500">היתרים → התחלות → גמר • קו עם נקודות = יעד שנתי של הוועדה ({fmt(targetAnnual2125)} יח&quot;ד)</p>
          </div>
          <Link href="/sources/cbs-national-construction" className="text-[11px] text-indigo-700 hover:underline">מקור: למ&quot;ס →</Link>
        </div>
        <div className="p-4">
          <NationalConstructionChart
            data={nat.map((r) => ({
              year: r.year,
              permits: r.permits ?? null,
              starts: r.starts ?? null,
              completions: r.completions ?? null,
              target: targetAnnual2125,
            }))}
          />
        </div>
      </section>

      {/* ─── Committee Report — Background banner ─── */}
      <section className="rounded-2xl bg-indigo-50/50 border border-indigo-100 p-6 mb-6">
        <div className="flex items-start gap-3 mb-3">
          <span className="text-3xl">📋</span>
          <div className="flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1 text-indigo-700">דוח הוועדה לפתרון משבר הדיור</p>
            <h2 className="text-xl font-bold text-slate-900">התוכנית האסטרטגית לדיור 2017-2040 — מעקב יוני 2021</h2>
            <p className="text-sm text-slate-700 mt-1">
              המועצה הלאומית לכלכלה • אגף תכנון אסטרטגי • <Link href="/sources/internal-research" className="text-indigo-700 hover:underline">קישור למסמך המלא</Link>
            </p>
          </div>
        </div>
      </section>

      {/* ─── Headline findings cards ─── */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-10">
        {HEADLINE_FINDINGS.map((f, i) => {
          const chipCls =
            f.severity === "red" ? "trend-pill trend-down" :
            f.severity === "amber" ? "trend-pill trend-flat" :
            "trend-pill trend-up";
          const chipLabel =
            f.severity === "red" ? "חמור" :
            f.severity === "amber" ? "דורש מעקב" :
            "חיובי";
          const icon =
            f.severity === "red" ? "🚨" :
            f.severity === "amber" ? "⚠️" :
            "💡";
          return (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start gap-2 mb-2">
                <span className="text-2xl flex-shrink-0">{icon}</span>
                <h3 className="text-sm font-bold text-slate-900 leading-tight flex-1">{f.title}</h3>
                <span className={`${chipCls} flex-shrink-0`}>{chipLabel}</span>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed">{f.text}</p>
              <p className="text-[10px] text-slate-500 mt-2">דוח עמוד {f.page}</p>
            </div>
          );
        })}
      </section>

      {/* ═══════════════════════════════════════════════════════════
          PLAN vs. ACTUAL — Committee 2021-2025 חומש target vs DB
          ═══════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 bg-indigo-50 text-indigo-700">
            🎯
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-slate-900">תוכנית הוועדה מול ביצוע בפועל — חומש 2021-2025</h2>
            <p className="text-sm text-slate-600 mt-0.5">
              יעד הוועדה: {fmt(targetAnnual2125)} יח&quot;ד בשנה × 5 = <strong>{fmt(target2125Cumulative)}</strong> יח&quot;ד מצטבר • נתונים בפועל מ-<Link href="/sources/cbs-national-construction" className="text-indigo-700 hover:underline">סדרת הלמ&quot;ס לבנייה ארצית</Link>
            </p>
          </div>
        </div>

        {/* 3 plan-vs-actual KPI cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          {/* Completions — the "real" supply that should equal the committee target */}
          <div className={`rounded-xl p-4 border-2 ${completionsGap2125 < 0 ? "bg-red-50 border-red-300" : "bg-emerald-50 border-emerald-300"}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">גמר בנייה (האמת)</span>
              <span className="text-2xl">{completionsGap2125 < 0 ? "📉" : "📈"}</span>
            </div>
            <div className="text-2xl font-extrabold text-slate-900 tabular-nums">{fmt(actual2125.completions)}</div>
            <div className="text-xs text-slate-600 mt-1">מתוך יעד {fmt(target2125Cumulative)}</div>
            <div className={`text-sm font-bold mt-2 tabular-nums ${completionsGap2125 < 0 ? "text-red-700" : "text-emerald-700"}`}>
              {completionsGap2125 >= 0 ? "+" : ""}{fmt(completionsGap2125)} ({completionsGap2125 >= 0 ? "+" : ""}{((completionsGap2125 / target2125Cumulative) * 100).toFixed(1)}%)
            </div>
            <p className="text-[10px] text-slate-500 mt-2 leading-tight">
              ההיצע <strong>שהגיע לשוק</strong> בפועל. כאן הוועדה ביקשה את היעד.
            </p>
          </div>

          {/* Starts — pipeline 2-3y out */}
          <div className={`rounded-xl p-4 border-2 ${startsGap2125 < 0 ? "bg-slate-50 border-slate-300" : "bg-emerald-50 border-emerald-300"}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">התחלות בנייה (צינור)</span>
              <span className="text-2xl">{startsGap2125 < 0 ? "🔧" : "🚧"}</span>
            </div>
            <div className="text-2xl font-extrabold text-slate-900 tabular-nums">{fmt(actual2125.starts)}</div>
            <div className="text-xs text-slate-600 mt-1">מתוך יעד {fmt(target2125Cumulative)}</div>
            <div className={`text-sm font-bold mt-2 tabular-nums ${startsGap2125 < 0 ? "text-red-600" : "text-emerald-700"}`}>
              {startsGap2125 >= 0 ? "+" : ""}{fmt(startsGap2125)} ({startsGap2125 >= 0 ? "+" : ""}{((startsGap2125 / target2125Cumulative) * 100).toFixed(1)}%)
            </div>
            <p className="text-[10px] text-slate-500 mt-2 leading-tight">
              ההיצע <strong>שעוד יגיע</strong> בעוד 2-3 שנים. מצביע על מגמת החומש הבא.
            </p>
          </div>

          {/* Permits — upstream pipeline */}
          <div className={`rounded-xl p-4 border-2 ${permitsGap2125 < 0 ? "bg-slate-50 border-slate-300" : "bg-emerald-50 border-emerald-300"}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">היתרי בנייה (תכנון)</span>
              <span className="text-2xl">📋</span>
            </div>
            <div className="text-2xl font-extrabold text-slate-900 tabular-nums">{fmt(actual2125.permits)}</div>
            <div className="text-xs text-slate-600 mt-1">מתוך יעד {fmt(target2125Cumulative)}</div>
            <div className={`text-sm font-bold mt-2 tabular-nums ${permitsGap2125 < 0 ? "text-red-600" : "text-emerald-700"}`}>
              {permitsGap2125 >= 0 ? "+" : ""}{fmt(permitsGap2125)} ({permitsGap2125 >= 0 ? "+" : ""}{((permitsGap2125 / target2125Cumulative) * 100).toFixed(1)}%)
            </div>
            <p className="text-[10px] text-slate-500 mt-2 leading-tight">
              היתרים שניתנו, גם אם לא כולם יתממשו. הצינור הרחוק ביותר.
            </p>
          </div>
        </div>

        {/* Narrative — what the comparison teaches us */}
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 mb-5 text-sm text-slate-800 leading-relaxed">
          <p className="font-bold text-slate-900 mb-2">💡 מה זה אומר?</p>
          <ul className="space-y-1.5 list-disc pr-5">
            <li>
              ישראל <strong>פיגרה ביעד הגמר ב-{fmt(Math.abs(completionsGap2125))} יחידות</strong> ({((completionsGap2125 / target2125Cumulative) * 100).toFixed(1)}%) — לא נבנו מספיק דירות שהגיעו לשוק.
            </li>
            <li>
              עם זאת, <strong>התחלות הבנייה עברו את היעד ב-{fmt(Math.abs(startsGap2125))} יחידות</strong> ({((startsGap2125 / target2125Cumulative) * 100).toFixed(0)}%) — הצינור מלא, היעד הזה צפוי להתממש בשנים 2026-2028 (זמן הבנייה הממוצע).
            </li>
            <li>
              <strong>היתרי הבנייה חרגו ב-{fmt(Math.abs(permitsGap2125))} יחידות</strong> ({((permitsGap2125 / target2125Cumulative) * 100).toFixed(0)}%) — תכנון רב-שנתי קיים. הבעיה היא ב-<strong>זמן המעבר מהיתר לאכלוס</strong>, לא בכמות התכנון.
            </li>
            <li className="text-slate-600 pt-1 border-t border-slate-200 mt-2">
              <strong>מסקנה לוועדה:</strong> המודל "להגדיל תכנון" עבד. המודל "להאיץ ביצוע" עדיין מפגר — צריך פתרונות לזמני בנייה ארוכים, תשתיות תומכות ותקיעות מימוש.
            </li>
          </ul>
        </div>

        {/* Cumulative comparison chart */}
        <div className="glass-card overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">סכום מצטבר 2021-2025 — יעד הוועדה מול בפועל</h3>
            <p className="text-xs text-slate-500">הקו האדום המקווקו = יעד מצטבר. שלוש העקומות = מה שקרה בפועל. בריא = העקומות חוצות מעל הקו.</p>
          </div>
          <div className="p-4">
            <PlanVsActualChart data={cumulativeData} />
          </div>
        </div>
      </section>

      {/* ─── District targets chart ─── */}
      <section className="glass-card overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">יעדי סיומי בנייה שנתיים לפי מחוז (טבלה 6 בדוח, עמ&apos; 21)</h2>
          <p className="text-xs text-slate-500">השוואת חומש 2021-2025 לחומש 2026-2030 • יישובים יהודיים/מעורבים מול יישובים הומוגניים לא-יהודיים • יח&quot;ד באלפים</p>
        </div>
        <div className="p-4">
          <DistrictTargetsChart targets={[...DISTRICT_TARGETS_2021_2030]} />
        </div>
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="text-slate-500">יעד יהודי שנתי 21-25</div>
            <div className="text-base font-bold text-slate-900 tabular-nums">{NATIONAL_TARGETS.total_jewish_annual_2021_2025} אלף יח&quot;ד</div>
          </div>
          <div>
            <div className="text-slate-500">יעד לא-יהודי שנתי 21-25</div>
            <div className="text-base font-bold text-slate-900 tabular-nums">{NATIONAL_TARGETS.total_non_jewish_annual_2021_2025} אלף יח&quot;ד</div>
          </div>
          <div>
            <div className="text-slate-500">יעד כולל 21-25</div>
            <div className="text-base font-bold text-slate-900 tabular-nums">{NATIONAL_TARGETS.total_annual_2021_2025} אלף יח&quot;ד</div>
          </div>
          <div>
            <div className="text-slate-500">יעד כולל 26-30</div>
            <div className="text-base font-bold text-slate-900 tabular-nums">{NATIONAL_TARGETS.total_annual_2026_2030} אלף יח&quot;ד</div>
          </div>
        </div>
      </section>

      {/* ─── Non-Jewish shortfall ─── */}
      <section className="glass-card overflow-hidden mb-10">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">פערי בנייה ביישובי החברה הלא-יהודית 2006-2022 (טבלה 5 בדוח, עמ&apos; 20)</h2>
          <p className="text-xs text-slate-500">סיומי בנייה בפועל מול צורכי הדיור המחושבים • 50% מחסור ארצי = פער מצטבר של 99 אלף יח&quot;ד</p>
        </div>
        <div className="p-4">
          <ShortfallBarChart data={[...NON_JEWISH_SHORTFALL_2006_2022]} />
        </div>
      </section>

      {/* ─── Forecast block ─── */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
        <div className="kpi-card glow-indigo">
          <div className="stat-label">תחזית ביקוש שנתי 2021-2025</div>
          <div className="stat-large text-slate-900 mt-2 tabular-nums">{fmt(ANNUAL_DEMAND_FORECAST["2021-2025"])}</div>
          <div className="text-xs text-slate-500 mt-2">יח&quot;ד בשנה לפי תחזית המועצה הלאומית לכלכלה</div>
        </div>
        <div className="kpi-card glow-indigo">
          <div className="stat-label">תחזית ביקוש שנתי 2026-2030</div>
          <div className="stat-large text-slate-900 mt-2 tabular-nums">{fmt(ANNUAL_DEMAND_FORECAST["2026-2030"])}</div>
          <div className="text-xs text-slate-500 mt-2">צמיחה של 10% מהחומש הקודם — בעיקר בשל הגירה לאזורי באר שבע ואשקלון</div>
        </div>
      </section>

    </main>
  );
}
