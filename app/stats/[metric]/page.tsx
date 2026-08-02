import { prisma } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import NationalConstructionChart from "@/components/NationalConstructionChart";
import { getCbsNationalSeries } from "@/lib/cbsNationalSeries";

interface PageProps {
  params: { metric: string };
}

type Metric =
  | "national-construction"
  | "avg-price-per-sqm"
  | "total-population"
  | "apartments-needed"
  | "construction-cost-index"
  | "national-hpi";

const METRIC_CONFIG: Record<
  Metric,
  {
    title: string;
    subtitle: string;
    icon: string;
    accent: "cyan" | "emerald" | "amber" | "purple";
    source: string;
  }
> = {
  "national-construction": {
    title: "בנייה למגורים בישראל — היסטוריה ארצית",
    subtitle: "היתרי בנייה, התחלות בנייה וגמרי בנייה — לאורך השנים",
    icon: "🏗️",
    accent: "emerald",
    source: 'הלשכה המרכזית לסטטיסטיקה (למ"ס)',
  },
  "avg-price-per-sqm": {
    title: "מחיר ממוצע למ\"ר — לאורך השנים",
    subtitle: "מחיר ממוצע למטר רבוע בכל הערים במאגר",
    icon: "💰",
    accent: "cyan",
    source: "nadlan.gov.il + מחקר פנימי",
  },
  "total-population": {
    title: "אוכלוסיית הערים — לאורך השנים",
    subtitle: "סך האוכלוסייה בכל 168 הערים במאגר",
    icon: "👥",
    accent: "purple",
    source: 'הלשכה המרכזית לסטטיסטיקה (למ"ס)',
  },
  "apartments-needed": {
    title: "דירות נדרשות — חישוב לפי שנה",
    subtitle: "מספר הדירות הנדרשות לפי גידול אוכלוסייה מחולק בנפשות לדירה",
    icon: "🏠",
    accent: "amber",
    source: 'חישוב מקומי על בסיס נתוני למ"ס',
  },
  "construction-cost-index": {
    title: 'מדד מחירי תשומה בבנייה למגורים',
    subtitle: "עלויות בנייה (חומרי גלם, עבודה, ציוד) — 10 שנים אחורה",
    icon: "🧱",
    accent: "amber",
    source: 'הלשכה המרכזית לסטטיסטיקה (למ"ס)',
  },
  "national-hpi": {
    title: 'מדד מחירי דירות — לאומי',
    subtitle: 'שינויים שנתיים וחודשיים במחירי דירות — נתוני למ"ס',
    icon: "📈",
    accent: "cyan",
    source: 'הלשכה המרכזית לסטטיסטיקה (למ"ס)',
  },
};

// Unified brand accent — all metric pages share the same indigo chrome.
const INDIGO_ACCENT = { icon: "bg-indigo-50 text-indigo-700", bar: "from-indigo-500 to-indigo-600", text: "text-indigo-700" };
const accentClasses = {
  cyan: INDIGO_ACCENT,
  emerald: INDIGO_ACCENT,
  amber: INDIGO_ACCENT,
  purple: INDIGO_ACCENT,
};

export async function generateStaticParams() {
  return Object.keys(METRIC_CONFIG).map((metric) => ({ metric }));
}

export async function generateMetadata({ params }: PageProps) {
  const cfg = METRIC_CONFIG[params.metric as Metric];
  return { title: cfg ? `${cfg.title} | קרנף אנליסט` : "נתון" };
}

function fmt(n: number | null, suffix = ""): string {
  if (n === null || n === undefined) return "—";
  return Math.round(n).toLocaleString("he-IL") + suffix;
}

function fmtPct(prev: number | null, curr: number | null): string {
  if (!prev || !curr || prev === 0) return "—";
  const pct = ((curr - prev) / prev) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export default async function StatPage({ params }: PageProps) {
  const metric = params.metric as Metric;
  const cfg = METRIC_CONFIG[metric];
  if (!cfg) notFound();
  const a = accentClasses[cfg.accent];

  // ── National Construction ─────────────────────────────────────
  if (metric === "national-construction") {
    const rows = await prisma.national_construction.findMany({
      orderBy: { year: "asc" },
      select: { year: true, permits: true, starts: true, completions: true },
    });

    return (
      <main className="min-h-screen page-wrap py-8">
        <PageHeader cfg={cfg} a={a} subInfo={`${rows.length} שנים | ${rows[0]?.year}-${rows[rows.length - 1]?.year}`} />

        {/* Chart */}
        <div className="glass-card overflow-hidden mb-6">
          <div className={`h-1 bg-gradient-to-l ${a.bar}`} />
          <div className="p-6">
            <NationalConstructionChart data={rows} />
          </div>
        </div>

        {/* Table */}
        <div className="glass-card overflow-hidden">
          <div className={`h-1 bg-gradient-to-l ${a.bar}`} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" dir="rtl">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="py-3 px-3 text-right text-xs text-slate-500 font-semibold">שנה</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">היתרים</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-400 font-medium">שינוי</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">התחלות</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-400 font-medium">שינוי</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">גמרי בנייה</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-400 font-medium">שינוי</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const prev = idx > 0 ? rows[idx - 1] : null;
                  const isLatest = idx === rows.length - 1;
                  return (
                    <tr
                      key={row.year}
                      className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                        isLatest ? "bg-indigo-50/40" : ""
                      }`}
                    >
                      <td className="py-3 px-3 text-right font-bold text-slate-900">{row.year}</td>
                      <td className="py-3 px-3 text-center text-slate-900 font-semibold">{fmt(row.permits)}</td>
                      <td className="py-3 px-3 text-center text-xs">
                        <TrendCell pct={pctChange(prev?.permits, row.permits)} />
                      </td>
                      <td className="py-3 px-3 text-center text-slate-900 font-semibold">{fmt(row.starts)}</td>
                      <td className="py-3 px-3 text-center text-xs">
                        <TrendCell pct={pctChange(prev?.starts, row.starts)} />
                      </td>
                      <td className="py-3 px-3 text-center text-slate-900 font-semibold">{fmt(row.completions)}</td>
                      <td className="py-3 px-3 text-center text-xs">
                        <TrendCell pct={pctChange(prev?.completions, row.completions)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-2xs text-slate-500 mt-4">
          הערה: היתרים לשנים 2016-2018 חסרים בדוחות הזמינים של למ&quot;ס. תאים ריקים מוצגים כ-&ldquo;—&rdquo;.
        </p>
      </main>
    );
  }

  // ── Median price (per sqm equivalent, /75) — from nadlan_price_trends ─────
  if (metric === "avg-price-per-sqm") {
    // Group nadlan trends by year+quarter, compute median across cities
    const trends = await prisma.nadlan_price_trends.findMany({
      where: { median_price: { not: null } },
      orderBy: [{ year: "asc" }, { quarter: "asc" }],
      select: { city_name: true, year: true, quarter: true, median_price: true },
    });

    // Group by year (using average of quarterly medians across all reporting cities)
    const byYear = new Map<number, number[]>();
    for (const t of trends) {
      if (!byYear.has(t.year)) byYear.set(t.year, []);
      // approximate price/sqm from median_price / 75 sqm average apartment
      byYear.get(t.year)!.push(t.median_price! / 75);
    }

    const yearRows = [...byYear.entries()]
      .sort(([a], [b]) => a - b)
      .map(([year, vals]) => ({
        year,
        avg: vals.reduce((s, v) => s + v, 0) / vals.length,
        count: vals.length,
      }));

    const totalCities = new Set(trends.map((t) => t.city_name)).size;

    return (
      <main className="min-h-screen page-wrap py-8">
        <PageHeader
          cfg={cfg}
          a={a}
          subInfo={`${totalCities} ערים | ${yearRows[0]?.year}-${yearRows[yearRows.length - 1]?.year}`}
        />

        <div className="glass-card overflow-hidden">
          <div className={`h-1 bg-gradient-to-l ${a.bar}`} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" dir="rtl">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="py-3 px-3 text-right text-xs text-slate-500 font-semibold">שנה</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">מחיר ממוצע למ&quot;ר</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-400 font-medium">שינוי משנה קודמת</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-400 font-medium">דגימות (עיר × רבעון)</th>
                </tr>
              </thead>
              <tbody>
                {yearRows.map((row, idx) => {
                  const prev = idx > 0 ? yearRows[idx - 1] : null;
                  const isLatest = idx === yearRows.length - 1;
                  return (
                    <tr
                      key={row.year}
                      className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                        isLatest ? "bg-indigo-50/40" : ""
                      }`}
                    >
                      <td className="py-3 px-3 text-right font-bold text-slate-900">{row.year}</td>
                      <td className="py-3 px-3 text-center text-slate-900 font-bold">
                        ₪{Math.round(row.avg).toLocaleString("he-IL")}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <TrendCell pct={pctChange(prev?.avg ?? null, row.avg)} />
                      </td>
                      <td className="py-3 px-3 text-center text-slate-500 text-xs">{row.count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-2xs text-slate-500 mt-4">
          הערה: מחיר למ&quot;ר חושב מחציון מחיר העסקה ב-nadlan.gov.il חלקי 75 מ&quot;ר ממוצע לדירה.
          ממוצע על פני כל הערים והרבעונים של אותה שנה.
        </p>
      </main>
    );
  }

  // ── Total population ──────────────────────────────────────────
  if (metric === "total-population") {
    const cities = await prisma.city.findMany({
      select: {
        population_2021: true,
        population_2022: true,
        population_2024: true,
        population_2026: true,
      },
    });
    const sums = [2021, 2022, 2024, 2026].map((y) => {
      const key = `population_${y}` as keyof (typeof cities)[number];
      const vals = cities.map((c) => c[key]).filter((v): v is number => v != null);
      return { year: y, total: vals.reduce((s, v) => s + v, 0), count: vals.length };
    });

    return (
      <main className="min-h-screen page-wrap py-8">
        <PageHeader cfg={cfg} a={a} subInfo={`168 ערים במאגר`} />

        <div className="glass-card overflow-hidden">
          <div className={`h-1 bg-gradient-to-l ${a.bar}`} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" dir="rtl">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="py-3 px-3 text-right text-xs text-slate-500 font-semibold">שנה</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">סך אוכלוסייה</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-400 font-medium">שינוי משנה קודמת</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-400 font-medium">ערים עם נתון</th>
                </tr>
              </thead>
              <tbody>
                {sums.map((row, idx) => {
                  const prev = idx > 0 ? sums[idx - 1] : null;
                  const isLatest = idx === sums.length - 1;
                  return (
                    <tr
                      key={row.year}
                      className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                        isLatest ? "bg-indigo-50/40" : ""
                      }`}
                    >
                      <td className="py-3 px-3 text-right font-bold text-slate-900">{row.year}</td>
                      <td className="py-3 px-3 text-center text-slate-900 font-bold">{fmt(row.total)}</td>
                      <td className="py-3 px-3 text-center">
                        <TrendCell pct={pctChange(prev?.total ?? null, row.total)} />
                      </td>
                      <td className="py-3 px-3 text-center text-slate-500 text-xs">{row.count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-2xs text-slate-500 mt-4">
          הערה: בסיס נתונים מהמפקד הרשמי של למ&quot;ס 2022 + תחזיות לפי קצב הצמיחה השנתי.
        </p>
      </main>
    );
  }

  // ── Apartments needed ─────────────────────────────────────────
  if (metric === "apartments-needed") {
    const cities = await prisma.city.findMany({
      where: { apartments_required: { not: null } },
      select: { city_name: true, apartments_required: true, population_growth_abs: true, people_per_apartment: true },
      orderBy: { apartments_required: "desc" },
    });
    const total = cities.reduce((s, c) => s + (c.apartments_required ?? 0), 0);

    return (
      <main className="min-h-screen page-wrap py-8">
        <PageHeader
          cfg={cfg}
          a={a}
          subInfo={`${cities.length} ערים | סה"כ ${Math.round(total / 1000).toLocaleString("he-IL")}K דירות`}
        />

        <div className="glass-card overflow-hidden">
          <div className={`h-1 bg-gradient-to-l ${a.bar}`} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" dir="rtl">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="py-3 px-3 text-right text-xs text-slate-500 font-semibold">עיר</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">דירות נדרשות</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-400 font-medium">גידול אוכלוסייה</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-400 font-medium">נפשות לדירה</th>
                </tr>
              </thead>
              <tbody>
                {cities.map((c, idx) => (
                  <tr key={c.city_name} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-3 text-right">
                      <Link
                        href={`/city/${encodeURIComponent(c.city_name)}`}
                        className="text-sm text-slate-900 font-medium hover:text-indigo-700 transition-colors"
                      >
                        <span className="text-slate-400 text-xs ml-2">{idx + 1}.</span>
                        {c.city_name}
                      </Link>
                    </td>
                    <td className="py-2.5 px-3 text-center text-slate-900 font-bold">
                      {fmt(c.apartments_required)}
                    </td>
                    <td className="py-2.5 px-3 text-center text-slate-700">
                      {fmt(c.population_growth_abs)}
                    </td>
                    <td className="py-2.5 px-3 text-center text-slate-700">
                      {c.people_per_apartment ? c.people_per_apartment.toFixed(2) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-2xs text-slate-500 mt-4">
          חישוב: דירות נדרשות = גידול אוכלוסייה ÷ נפשות לדירה. ערים ללא נתון נפשות לדירה אינן נכללות.
        </p>
      </main>
    );
  }

  // ── Construction cost index ─────────────────────────────────
  if (metric === "construction-cost-index") {
    const series = getCbsNationalSeries().construction_input_index;
    return (
      <main className="min-h-screen page-wrap py-8">
        <PageHeader cfg={cfg} a={a} subInfo={`${series.length} שנים | ${series[0]?.year}-${series[series.length - 1]?.year}`} />

        <div className="glass-card overflow-hidden">
          <div className={`h-1 bg-gradient-to-l ${a.bar}`} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" dir="rtl">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="py-3 px-3 text-right text-xs text-slate-500 font-semibold">שנה</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">מדד מחיר תשומה</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-400 font-medium">שינוי שנתי</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-400 font-medium">מהימנות</th>
                  <th className="py-3 px-3 text-right text-xs text-slate-400 font-medium">הערה</th>
                </tr>
              </thead>
              <tbody>
                {series.map((row, idx) => {
                  const yoy = row.annual_yoy_pct ?? row.annual_yoy_pct_ytd ?? null;
                  const isLatest = idx === series.length - 1;
                  return (
                    <tr key={row.year} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${isLatest ? "bg-indigo-50/40" : ""}`}>
                      <td className="py-3 px-3 text-right font-bold text-slate-900">{row.year}</td>
                      <td className="py-3 px-3 text-center text-slate-900 font-semibold">
                        {row.approx_index !== null ? row.approx_index.toFixed(1) : "—"}
                      </td>
                      <td className="py-3 px-3 text-center text-xs">
                        <TrendCell pct={yoy} />
                      </td>
                      <td className="py-3 px-3 text-center text-2xs">
                        <ConfidencePill c={row.confidence} />
                      </td>
                      <td className="py-3 px-3 text-right text-2xs text-slate-500">{row.note ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-2xs text-slate-500 mt-4">
          מדד מחירי תשומה בבנייה למגורים — מודד את השינוי בעלויות חומרי הגלם, העבודה והציוד בבנייה. מקור: למ&quot;ס.
          ערכים לפני 2019 נאספו ממאגרי מידע משניים — סומנו &quot;medium&quot; מהימנות. ערכים מ-2020 ואילך אומתו ישירות מול הודעות לעיתונות של למ&quot;ס.
        </p>
      </main>
    );
  }

  // ── National Housing Price Index ─────────────────────────────
  if (metric === "national-hpi") {
    const data = getCbsNationalSeries();
    const annual = data.housing_price_index_annual;
    const monthly = data.monthly_price_index_recent;
    return (
      <main className="min-h-screen page-wrap py-8">
        <PageHeader cfg={cfg} a={a} subInfo={`${annual.length} שנות נתונים שנתיים + ${monthly.length} פרסומים אחרונים`} />

        <h3 className="text-lg font-bold text-slate-900 mb-3 mt-4">שינויים חודשיים אחרונים</h3>
        <div className="glass-card overflow-hidden mb-6">
          <div className={`h-1 bg-gradient-to-l ${a.bar}`} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" dir="rtl">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="py-3 px-3 text-right text-xs text-slate-500 font-semibold">תקופה</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">שינוי שנתי (YoY)</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">שינוי חודשי (MoM)</th>
                  <th className="py-3 px-3 text-right text-xs text-slate-400 font-medium">מקור</th>
                </tr>
              </thead>
              <tbody>
                {monthly.slice().reverse().map((row) => (
                  <tr key={row.period} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-3 text-right font-bold text-slate-900">{row.period}</td>
                    <td className="py-3 px-3 text-center"><TrendCell pct={row.national_yoy_pct ?? null} /></td>
                    <td className="py-3 px-3 text-center"><TrendCell pct={row.national_mom_pct ?? null} /></td>
                    <td className="py-3 px-3 text-right text-2xs">
                      {row.source_url ? (
                        <a href={row.source_url} target="_blank" rel="noopener noreferrer" className="text-indigo-700 hover:underline">
                          {row.source_name || "מקור"} ↗
                        </a>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <h3 className="text-lg font-bold text-slate-900 mb-3">שינויים שנתיים</h3>
        <div className="glass-card overflow-hidden">
          <div className={`h-1 bg-gradient-to-l ${a.bar}`} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" dir="rtl">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="py-3 px-3 text-right text-xs text-slate-500 font-semibold">שנה</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">שינוי שנתי</th>
                  <th className="py-3 px-3 text-center text-xs text-slate-400 font-medium">מהימנות</th>
                  <th className="py-3 px-3 text-right text-xs text-slate-400 font-medium">מקור</th>
                </tr>
              </thead>
              <tbody>
                {annual.map((row, idx) => {
                  const isLatest = idx === annual.length - 1;
                  return (
                    <tr key={row.year} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${isLatest ? "bg-indigo-50/40" : ""}`}>
                      <td className="py-3 px-3 text-right font-bold text-slate-900">{row.year}</td>
                      <td className="py-3 px-3 text-center"><TrendCell pct={row.annual_pct_change} /></td>
                      <td className="py-3 px-3 text-center text-2xs"><ConfidencePill c={row.confidence} /></td>
                      <td className="py-3 px-3 text-right text-2xs">
                        {row.source_url ? (
                          <a href={row.source_url} target="_blank" rel="noopener noreferrer" className="text-indigo-700 hover:underline">
                            {row.source_name || "מקור"} ↗
                          </a>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-2xs text-slate-500 mt-4">
          מדד מחירי דירות — שינוי % במחירי דירות יד שנייה לפי מתודולוגיית למ&quot;ס. מקורות: הודעות לעיתונות
          של למ&quot;ס (פרסומים 047/2023-2026, 052/2026 ועוד), אומת מול Calcalist, Ynet, Nadlan Center.
        </p>
      </main>
    );
  }

  return notFound();
}

function ConfidencePill({ c }: { c: "high" | "medium" | "low" }) {
  const map = {
    high: { he: "גבוהה", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
    medium: { he: "בינונית", cls: "bg-slate-100 text-slate-500 border-slate-300" },
    low: { he: "נמוכה", cls: "bg-slate-50 text-slate-600 border-slate-200" },
  } as const;
  const entry = map[c] ?? map.medium;
  return (
    <span className={`inline-block text-2xs font-bold px-2 py-0.5 rounded-full border ${entry.cls}`}>
      {entry.he}
    </span>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function pctChange(prev: number | null | undefined, curr: number | null | undefined): number | null {
  if (!prev || !curr || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function TrendCell({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) {
    return <span className="text-slate-400">—</span>;
  }
  const isPositive = pct >= 0;
  return (
    <span className={isPositive ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
      {isPositive ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

function PageHeader({
  cfg,
  a,
  subInfo,
}: {
  cfg: { title: string; subtitle: string; icon: string; source: string };
  a: { icon: string };
  subInfo: string;
}) {
  return (
    <>
      <header className="mb-8">
        <div className="flex items-start gap-4">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 ${a.icon}`}>
            {cfg.icon}
          </div>
          <div className="flex-1">
            <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight leading-tight">{cfg.title}</h1>
            <p className="text-slate-600 text-base mt-1">{cfg.subtitle}</p>
            <div className="flex flex-wrap gap-3 mt-3 text-sm">
              <span className="px-3 py-1 rounded-full bg-white border border-slate-200 text-slate-700 tabular-nums shadow-sm">
                {subInfo}
              </span>
              <span className="px-3 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-500 text-xs">
                מקור: {cfg.source}
              </span>
            </div>
          </div>
        </div>
      </header>
    </>
  );
}
