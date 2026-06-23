import { prisma } from "@/lib/db";
import RankingCard from "@/components/RankingCard";
import NationalConstructionChart from "@/components/NationalConstructionChart";
import CityConstructionMiniChart from "@/components/CityConstructionMiniChart";
import HomeSearch from "@/components/HomeSearch";
import Link from "next/link";
import RecentReportsSection from "@/components/RecentReportsSection";
import NumberCaption, { CbsPricesCaption, CbsConstructionCaption, CbsTransactionsCaption } from "@/components/NumberCaption";

function formatPrice(value: number | null): string {
  if (value === null) return "—";
  return `₪${Math.round(value).toLocaleString("he-IL")}`;
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatNumber(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("he-IL");
}

function formatShortMoney(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1_000_000) return `₪${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `₪${(value / 1_000).toFixed(1)}K`;
  return `₪${value}`;
}

export default async function HomePage() {
  let cityCount = 0;
  let lastUpdated: Date | null = null;

  try {
    cityCount = await prisma.city.count();
    if (cityCount > 0) {
      const latest = await prisma.city.findFirst({
        orderBy: { last_updated: "desc" },
        select: { last_updated: true },
      });
      lastUpdated = latest?.last_updated ?? null;
    }
  } catch {
    // DB not ready
  }

  let nationalConstruction: Array<{ year: number; permits: number | null; starts: number | null; completions: number | null }> = [];
  try {
    nationalConstruction = await prisma.national_construction.findMany({
      orderBy: { year: "asc" },
      select: { year: true, permits: true, starts: true, completions: true },
    });
  } catch {
    // empty
  }

  if (cityCount === 0) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="text-center space-y-4">
          <div className="text-5xl mb-6">🏗️</div>
          <h1 className="text-2xl font-bold text-slate-900">אין נתונים במערכת</h1>
          <p className="text-slate-600 text-lg">נא להריץ את סקריפט הייבוא.</p>
          <code className="block mt-4 px-4 py-2 bg-slate-100 border border-slate-200 rounded-lg text-cyan-700 text-sm">
            npx tsx src/lib/import.ts
          </code>
        </div>
      </main>
    );
  }

  // Load all cities for client-side search
  const allCities = await prisma.city.findMany({
    orderBy: { city_name: "asc" },
    select: {
      id: true,
      city_name: true,
      price_change_pct: true,
      population_2024: true,
      population_2022: true,
      population_2026: true,
    },
  });

  // ── Hero aggregate stats ─────────────────────────────────────────
  const aggregates = await prisma.city.aggregate({
    _avg: { price_per_sqm_2026: true, price_change_pct: true, population_growth_pct: true },
    _max: { price_per_sqm_2026: true, price_change_pct: true },
    _sum: { population_2026: true, apartments_required: true },
    where: { price_per_sqm_2026: { not: null } },
  });

  const latestNational = nationalConstruction[nationalConstruction.length - 1];
  const prevNational = nationalConstruction[nationalConstruction.length - 2];
  const startsTrend =
    latestNational?.starts && prevNational?.starts
      ? ((latestNational.starts - prevNational.starts) / prevNational.starts) * 100
      : null;

  const avgPricePerSqm = aggregates._avg.price_per_sqm_2026;
  const avgPriceChange = aggregates._avg.price_change_pct;
  const totalPopulation = aggregates._sum.population_2026;
  const totalApartmentsNeeded = aggregates._sum.apartments_required;

  // ── Rankings ─────────────────────────────────────────────────────
  const [mostExpensive, highestGain, highestSurplus, highestInventory] = await Promise.all([
    prisma.nadlan_price_trends.findMany({
      where: { quarter: 1, median_price: { not: null }, year: 2025 },
      orderBy: { median_price: "desc" },
      take: 5,
      select: { city_name: true, median_price: true },
    }),
    prisma.city.findMany({
      where: { price_change_pct: { not: null } },
      orderBy: { price_change_pct: "desc" },
      take: 5,
      select: { city_name: true, price_change_pct: true },
    }),
    // Replaced the legacy "golden_pct" ranking (produced absurd values like
    // +1207% for tiny cities). The new ranking surfaces the cities with the
    // highest absolute construction-starts in 2025 — a concrete fact.
    prisma.construction_starts.findMany({
      where: {
        year: 2025,
        starts: { gt: 0 },
        // Exclude the national aggregate row — we want cities only.
        NOT: { city_name: { in: ["ארצי", "סך הכל ארצי", "סך הכל"] } },
      },
      orderBy: { starts: "desc" },
      take: 5,
      select: { city_name: true, starts: true },
    }),
    prisma.citySales.findMany({
      where: { unsold_inventory_2025: { not: null } },
      orderBy: { unsold_inventory_2025: "desc" },
      take: 5,
      select: { city_name: true, unsold_inventory_2025: true },
    }),
  ]);

  // ── Per-city construction data ──────────────────────────────────
  const topCitiesForConstruction = ["ירושלים", "תל אביב -יפו", "חיפה", "באר שבע", "ראשון לציון", "פתח תקווה"];
  const cityConstructionData = await Promise.all(
    topCitiesForConstruction.map(async (cityName) => {
      const [permits, starts, popByYear, cityData] = await Promise.all([
        prisma.buildingPermit.findMany({
          where: { city_name: cityName },
          orderBy: { year: "asc" },
          select: { year: true, permits: true },
        }),
        prisma.construction_starts.findMany({
          where: { city_name: cityName },
          orderBy: { year: "asc" },
          select: { year: true, starts: true },
        }),
        prisma.population_by_year.findMany({
          where: { city_name: cityName },
          orderBy: { year: "asc" },
          select: { year: true, population: true },
        }),
        prisma.city.findUnique({
          where: { city_name: cityName },
          select: { people_per_apartment: true, avgHouseholdSize2022: true },
        }),
      ]);

      const ppa = cityData?.people_per_apartment ?? cityData?.avgHouseholdSize2022 ?? 3.3;
      const years = Array.from({ length: 10 }, (_, i) => 2016 + i);
      const data = years.map((year) => {
        const popThis = popByYear.find((p) => p.year === year)?.population;
        const popPrev = popByYear.find((p) => p.year === year - 1)?.population;
        const popGrowth = popThis && popPrev ? popThis - popPrev : null;
        const housingNeed = popGrowth && ppa > 0 ? Math.round(popGrowth / ppa) : null;
        return {
          year,
          permits: permits.find((p) => p.year === year)?.permits ?? null,
          starts: starts.find((s) => s.year === year)?.starts ?? null,
          completions: null as number | null,
          housingNeed: housingNeed && housingNeed > 0 ? housingNeed : null,
        };
      });
      return { cityName, data };
    })
  );

  const rankings = [
    {
      title: "מחיר חציוני גבוה ביותר",
      accent: "amber" as const,
      icon: "👑",
      detailHref: "/rankings/most-expensive",
      items: mostExpensive.map((c, i) => ({
        rank: i + 1,
        city: c.city_name,
        value: formatPrice(c.median_price),
        href: `/city/${encodeURIComponent(c.city_name)}`,
      })),
    },
    {
      title: "עליית מחיר גבוהה ביותר",
      accent: "rose" as const,
      icon: "📈",
      detailHref: "/rankings/highest-gain",
      items: highestGain.map((c, i) => ({
        rank: i + 1,
        city: c.city_name,
        value: formatPct(c.price_change_pct),
        href: `/city/${encodeURIComponent(c.city_name)}`,
      })),
    },
    {
      title: "התחלות בנייה 2025 (לפי עיר)",
      accent: "emerald" as const,
      icon: "🏗️",
      detailHref: "/stats/national-construction",
      items: highestSurplus.map((c, i) => ({
        rank: i + 1,
        city: c.city_name,
        value: (c as { starts?: number }).starts !== undefined
          ? `${(c as { starts: number }).starts.toLocaleString("he-IL")} יח׳`
          : "—",
        href: `/city/${encodeURIComponent(c.city_name)}`,
      })),
    },
    {
      title: "מלאי דירות לא מכורות",
      accent: "cyan" as const,
      icon: "🏘️",
      detailHref: "/rankings/highest-inventory",
      items: highestInventory.map((c, i) => ({
        rank: i + 1,
        city: c.city_name,
        value: formatNumber(c.unsold_inventory_2025),
        href: `/city/${encodeURIComponent(c.city_name)}`,
      })),
    },
  ];

  const lastUpdatedFormatted = lastUpdated
    ? lastUpdated.toLocaleDateString("he-IL", { year: "numeric", month: "long", day: "numeric" })
    : "לא ידוע";

  // ── Date stamp for hero (current month/year in Hebrew) ──────────
  const heroDate = new Date().toLocaleDateString("he-IL", { month: "long", year: "numeric" });

  return (
    <main className="min-h-screen px-4 py-8 max-w-7xl mx-auto">
      {/* ── HERO — Compact, screenshot-optimized ───────────────── */}
      <header className="text-center pt-2 pb-1 animate-fade-up">
        <div className="flex items-center justify-center gap-2 flex-wrap mb-4">
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-cyan-50 border border-cyan-200">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-500 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-600"></span>
            </span>
            <p className="text-[10px] font-bold tracking-[0.2em] text-cyan-700 uppercase">
              Real Estate Intelligence
            </p>
          </div>
          <span className="brand-stamp">
            <span>📅</span>
            <span>{heroDate}</span>
          </span>
        </div>

        <h1 className="text-4xl md:text-6xl font-black leading-[0.9] tracking-tight text-balance">
          <span className="text-gradient-hero">מחקר נדל&quot;ן ישראל</span>
        </h1>
        <p className="text-slate-500 text-sm md:text-base font-medium max-w-xl mx-auto mt-3 leading-relaxed">
          תמונת מצב של שוק הדיור — מחירים, אוכלוסייה ובנייה
        </p>

        <div className="max-w-xl mx-auto mt-5">
          <HomeSearch cities={allCities} />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 mt-5 text-sm">
          <span className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-700 tabular-nums shadow-sm text-[13px]">
            <span className="font-bold text-cyan-700">{cityCount}</span>
            <span className="text-slate-500 mr-1.5">ערים במאגר</span>
          </span>
          <Link
            href="/cities"
            className="px-3.5 py-1.5 rounded-full bg-cyan-600 text-white hover:bg-cyan-700 transition-all font-semibold shadow-sm shadow-cyan-600/30 text-[13px]"
          >
            טבלת נתונים מלאה ←
          </Link>
          <Link
            href="/national"
            className="px-3.5 py-1.5 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-all font-semibold shadow-sm shadow-blue-600/30 text-[13px]"
          >
            🇮🇱 דשבורד לאומי
          </Link>
          <Link
            href="/sources"
            className="px-3.5 py-1.5 rounded-full bg-white border border-slate-300 text-slate-700 hover:border-cyan-400 hover:text-cyan-700 transition-all font-semibold shadow-sm text-[13px]"
          >
            📚 מקורות מידע
          </Link>
        </div>
      </header>

      {/* ── HERO KPIs — All-fresh, sourced from latest CBS PDFs ───────
          Replaces the old "דירות נדרשות 235K" which was a stale theoretical
          cumulative — now every tile shows a number the consultant can act on. */}
      <section className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Latest CBS price pulse — from 150/2026 */}
        <Link href="/sources/cbs-price-change-monthly" className="hero-kpi hero-emerald group cursor-pointer block">
          <div className="flex items-start justify-between mb-3">
            <div className="stat-label">מדד מחירי דירות (טרי)</div>
            <span className="text-xl">📈</span>
          </div>
          <div className="stat-mega text-gradient-emerald">+0.3%</div>
          <div className="mt-3 flex items-center gap-2">
            <span className="trend-pill trend-up">▲ MoM</span>
            <span className="text-xs text-slate-500">היפוך מגמה</span>
          </div>
          <CbsPricesCaption insideLink />
        </Link>

        {/* Latest construction year — from 089/2026 */}
        <Link href="/stats/national-construction" className="hero-kpi hero-cyan group cursor-pointer block">
          <div className="flex items-start justify-between mb-3">
            <div className="stat-label">התחלות בנייה 2025</div>
            <span className="text-xl">🏗️</span>
          </div>
          <div className="stat-mega text-gradient-cyan">
            {latestNational?.starts ? `${(latestNational.starts / 1000).toFixed(1)}K` : "80K"}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="trend-pill trend-up">▲ +14.6%</span>
            <span className="text-xs text-slate-500">שיא 15 שנה</span>
          </div>
          <CbsConstructionCaption insideLink />
        </Link>

        {/* Latest transactions — from 047/2026 */}
        <Link href="/sources/cbs-transactions-apartments" className="hero-kpi hero-amber group cursor-pointer block">
          <div className="flex items-start justify-between mb-3">
            <div className="stat-label">עסקאות דירות 2025</div>
            <span className="text-xl">🤝</span>
          </div>
          <div className="stat-mega text-gradient-amber">90.7K</div>
          <div className="mt-3 flex items-center gap-2">
            <span className="trend-pill trend-down">▼ -11.9%</span>
            <span className="text-xs text-slate-500">34K חדשות / 57K יד2</span>
          </div>
          <CbsTransactionsCaption insideLink />
        </Link>

        {/* Cities at-a-glance — fast city lookup */}
        <Link href="/cities" className="hero-kpi hero-purple group cursor-pointer block">
          <div className="flex items-start justify-between mb-3">
            <div className="stat-label">בסיס נתונים</div>
            <span className="text-xl">🏘️</span>
          </div>
          <div className="stat-mega text-gradient-purple">{cityCount}</div>
          <div className="mt-3 flex items-center gap-2">
            <span className="trend-pill trend-flat">ערים</span>
            <span className="text-xs text-slate-500">
              {totalPopulation ? `${(totalPopulation / 1_000_000).toFixed(1)}M תושבים` : "—"}
            </span>
          </div>
          <NumberCaption
            source="מאגר פנימי"
            period="מפקד 2022 + תחזית 2026"
            method='למ"ס + הרחבות'
            insideLink
          />
        </Link>
      </section>

      {/* ── Recent CBS / MoF Reports ───────────────────────────── */}
      <RecentReportsSection />

      {/* ── Rankings ─────────────────────────────────────────────── */}
      <section className="mt-12">
        <div className="section-header mb-6">
          <div className="section-header-icon bg-rose-100 text-rose-600">🏆</div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">דירוגים מובילים</h2>
            <p className="text-xs text-slate-500 mt-0.5">חמש הערים המובילות בכל קטגוריה</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {rankings.map((ranking) => (
            <RankingCard
              key={ranking.title}
              title={ranking.title}
              items={ranking.items}
              accent={ranking.accent}
              icon={ranking.icon}
              detailHref={ranking.detailHref}
            />
          ))}
        </div>
      </section>

      {/* ── Per-City Construction Supply vs Demand ───────────── */}
      {cityConstructionData.length > 0 && (
        <section className="mt-14">
          <div className="section-header mb-6">
            <div className="section-header-icon bg-red-100 text-red-600">⚖️</div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">היתרים, התחלות בנייה ודירות נדרשות — לפי עיר</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                גידול אוכלוסייה / נפשות לדירה — לפי נתוני למ&quot;ס
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {cityConstructionData
              .filter((c) => c.data.some((d) => d.permits || d.starts || d.housingNeed))
              .map((c) => (
                <Link
                  key={c.cityName}
                  href={`/city/${encodeURIComponent(c.cityName)}`}
                  className="glass-card p-5 hover:border-cyan-300 transition-all duration-200 group"
                >
                  <h3 className="text-sm font-bold text-slate-900 group-hover:text-cyan-700 transition-colors mb-3">
                    {c.cityName}
                  </h3>
                  <CityConstructionMiniChart data={c.data} cityName={c.cityName} />
                </Link>
              ))}
          </div>
          <p className="text-[10px] text-slate-500 mt-3">
            מקור: למ&quot;ס היתרי בנייה + התחלות בנייה | דירות נדרשות = גידול אוכלוסייה שנתי /
            נפשות לדירה
          </p>
        </section>
      )}

      {/* ── National Construction ───────────────────────────── */}
      {nationalConstruction.length > 0 && (
        <section className="mt-14">
          <div className="glass-card p-6">
            <div className="section-header mb-6">
              <div className="section-header-icon bg-amber-100 text-amber-700">🏗️</div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-slate-900">בנייה למגורים בישראל — נתונים ארציים</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  היתרי בנייה, התחלות בנייה וגמר בנייה —{" "}
                  {nationalConstruction[0]?.year}-
                  {nationalConstruction[nationalConstruction.length - 1]?.year}
                  <span className="text-slate-400"> | מקור: למ&quot;ס</span>
                </p>
              </div>
            </div>

            <NationalConstructionChart data={nationalConstruction} />

            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-sm tabular-nums" dir="rtl">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="py-3 px-3 text-right text-slate-600 font-semibold">שנה</th>
                    <th className="py-3 px-3 text-center text-amber-700 font-semibold">היתרי בנייה</th>
                    <th className="py-3 px-3 text-center text-slate-400 font-medium text-xs">שינוי</th>
                    <th className="py-3 px-3 text-center text-emerald-700 font-semibold">התחלות בנייה</th>
                    <th className="py-3 px-3 text-center text-slate-400 font-medium text-xs">שינוי</th>
                    <th className="py-3 px-3 text-center text-cyan-700 font-semibold">גמר בנייה</th>
                    <th className="py-3 px-3 text-center text-slate-400 font-medium text-xs">שינוי</th>
                  </tr>
                </thead>
                <tbody>
                  {nationalConstruction.map((row, idx) => {
                    const prev = idx > 0 ? nationalConstruction[idx - 1] : null;
                    const pctPermits =
                      prev?.permits && row.permits ? ((row.permits - prev.permits) / prev.permits) * 100 : null;
                    const pctStarts =
                      prev?.starts && row.starts ? ((row.starts - prev.starts) / prev.starts) * 100 : null;
                    const pctComp =
                      prev?.completions && row.completions
                        ? ((row.completions - prev.completions) / prev.completions) * 100
                        : null;
                    const isLatest = idx === nationalConstruction.length - 1;
                    return (
                      <tr
                        key={row.year}
                        className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                          isLatest ? "bg-cyan-50/60" : ""
                        }`}
                      >
                        <td className="py-3 px-3 text-right font-bold text-slate-900">{row.year}</td>
                        <td className="py-3 px-3 text-center text-amber-700 font-semibold">
                          {row.permits ? row.permits.toLocaleString("he-IL") : "—"}
                        </td>
                        <td className="py-3 px-3 text-center text-xs">
                          {pctPermits !== null ? (
                            <span className={pctPermits >= 0 ? "text-emerald-600" : "text-rose-600"}>
                              {pctPermits >= 0 ? "+" : ""}
                              {pctPermits.toFixed(1)}%
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-3 px-3 text-center text-emerald-700 font-semibold">
                          {row.starts ? row.starts.toLocaleString("he-IL") : "—"}
                        </td>
                        <td className="py-3 px-3 text-center text-xs">
                          {pctStarts !== null ? (
                            <span className={pctStarts >= 0 ? "text-emerald-600" : "text-rose-600"}>
                              {pctStarts >= 0 ? "+" : ""}
                              {pctStarts.toFixed(1)}%
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-3 px-3 text-center text-cyan-700 font-semibold">
                          {row.completions ? row.completions.toLocaleString("he-IL") : "—"}
                        </td>
                        <td className="py-3 px-3 text-center text-xs">
                          {pctComp !== null ? (
                            <span className={pctComp >= 0 ? "text-emerald-600" : "text-rose-600"}>
                              {pctComp >= 0 ? "+" : ""}
                              {pctComp.toFixed(1)}%
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <footer className="mt-20 pt-8 border-t border-slate-200 text-center">
        <p className="text-slate-500 text-sm">
          מקור: קובץ מחקר פנימי | עודכן לאחרונה:{" "}
          <span className="text-slate-700 font-medium">{lastUpdatedFormatted}</span>
        </p>
      </footer>
    </main>
  );
}
