import { prisma } from "@/lib/db";
import { getCityInsights } from "@/lib/insights";
import { computeCityGap, describeSupplySource } from "@/lib/gap-analysis";
import PriceChart from "@/components/PriceChart";
import SalesChart from "@/components/SalesChart";
import PermitsChart from "@/components/PermitsChart";
import PopulationChart from "@/components/PopulationChart";
import PriceTrendChart from "@/components/PriceTrendChart";
import CorrelationTable from "@/components/CorrelationTable";
import CityDealsComparison from "@/components/CityDealsComparison";
import CityConstructionMiniChart from "@/components/CityConstructionMiniChart";
import ScatteredFactsSection from "@/components/ScatteredFactsSection";
import { getCityScatteredData } from "@/lib/scatteredFacts";
import CityNeighborhoods from "@/components/CityNeighborhoods";
import { loadCityNeighborhoods } from "@/lib/neighborhoods";
import NumberCaption from "@/components/NumberCaption";
import Link from "next/link";

interface PageProps {
  params: { slug: string };
}

function formatPrice(value: number | null): string {
  if (value === null) return "—";
  return `₪${Math.round(value).toLocaleString("he-IL")}`;
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatNumber(value: number | null, decimals = 0): string {
  if (value === null) return "—";
  if (decimals === 0) return Math.round(value).toLocaleString("he-IL");
  return value.toFixed(decimals);
}

export async function generateStaticParams() {
  const cities = await prisma.city.findMany({ select: { city_name: true } });
  return cities.map((c) => ({ slug: encodeURIComponent(c.city_name) }));
}

export async function generateMetadata({ params }: PageProps) {
  const cityName = decodeURIComponent(params.slug);
  return {
    title: `${cityName} | מחקר נדל"ן ישראל`,
  };
}

export default async function CityPage({ params }: PageProps) {
  const cityName = decodeURIComponent(params.slug);

  const [city, salesData, buildingPermits, insights, yad2Data, populationByYear, priceTrends, constructionStarts, completionsData] = await Promise.all([
    prisma.city.findUnique({ where: { city_name: cityName } }),
    prisma.citySales.findUnique({ where: { city_name: cityName } }),
    prisma.buildingPermit.findMany({
      where: { city_name: cityName },
      orderBy: { year: "asc" },
    }),
    getCityInsights(cityName),
    prisma.yad2_market_data.findUnique({ where: { city_name: cityName } }),
    prisma.population_by_year.findMany({
      where: { city_name: cityName },
      orderBy: { year: "asc" },
    }),
    prisma.nadlan_price_trends.findMany({
      where: { city_name: cityName },
      orderBy: [{ year: "asc" }, { quarter: "asc" }],
    }),
    prisma.construction_starts.findMany({
      where: { city_name: cityName },
      orderBy: { year: "asc" },
    }),
    prisma.cbsPressData.findMany({
      where: { city_name: cityName },
      orderBy: [{ year: "asc" }, { quarter: "asc" }],
    }),
  ]);

  // Load scattered facts from CBS/MoF reports (cached file)
  const scattered = getCityScatteredData(cityName);
  const cityNeighborhoods = loadCityNeighborhoods(cityName);

  if (!city) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="text-center space-y-4">
          <p className="text-5xl mb-4">🔍</p>
          <h1 className="text-2xl font-bold text-slate-900">העיר לא נמצאה</h1>
          <p className="text-slate-500">
            לא נמצאו נתונים עבור &ldquo;{cityName}&rdquo;
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-700 hover:border-cyan-400 hover:text-cyan-700 transition-all"
          >
            ← חזרה לדף הבית
          </Link>
        </div>
      </main>
    );
  }

  const permitsData = buildingPermits.map((p) => ({
    year: p.year,
    permits: p.permits,
  }));
  const totalPermits = permitsData.reduce(
    (sum, p) => sum + (p.permits ?? 0),
    0
  );
  const avgPermits =
    permitsData.length > 0 ? Math.round(totalPermits / permitsData.length) : 0;
  const latestPermits =
    permitsData.length > 0
      ? permitsData[permitsData.length - 1].permits ?? 0
      : 0;
  const prevPermits =
    permitsData.length > 1
      ? permitsData[permitsData.length - 2].permits ?? 0
      : 0;
  const permitsTrend =
    prevPermits > 0
      ? ((latestPermits - prevPermits) / prevPermits) * 100
      : null;

  // Aggregate completions by year from quarterly cbs_press_data
  const completionsByYear = new Map<number, number>();
  for (const row of completionsData) {
    if (row.construction_completions) {
      completionsByYear.set(
        row.year,
        (completionsByYear.get(row.year) ?? 0) + row.construction_completions
      );
    }
  }

  // Aggregate starts by year from quarterly cbs_press_data (more granular than construction_starts table)
  const startsByYearFromPress = new Map<number, number>();
  for (const row of completionsData) {
    if (row.construction_starts) {
      startsByYearFromPress.set(
        row.year,
        (startsByYearFromPress.get(row.year) ?? 0) + row.construction_starts
      );
    }
  }

  const insightEntries: { key: string; text: string; icon: string; color: string }[] = [
    insights.priceChange
      ? { key: "price", text: insights.priceChange, icon: "📈", color: "border-emerald-900/50" }
      : null,
    insights.supplyBalance
      ? { key: "supply", text: insights.supplyBalance, icon: "⚖️", color: "border-purple-900/50" }
      : null,
    insights.inventoryClearance
      ? { key: "inventory", text: insights.inventoryClearance, icon: "🏘️", color: "border-amber-900/50" }
      : null,
    insights.peoplePerApartment
      ? { key: "people", text: insights.peoplePerApartment, icon: "👥", color: "border-cyan-900/50" }
      : null,
    insights.buildingPermitsTrend
      ? { key: "permits", text: insights.buildingPermitsTrend, icon: "🏗️", color: "border-orange-900/50" }
      : null,
    insights.populationTrend
      ? { key: "population", text: insights.populationTrend, icon: "📊", color: "border-blue-900/50" }
      : null,
  ].filter(Boolean) as { key: string; text: string; icon: string; color: string }[];

  // Derive price KPIs from nadlan.gov.il trends (Q1 data)
  const q1Prices = priceTrends.filter(p => p.quarter === 1 && p.median_price && p.median_price > 0);
  const earliestQ1 = q1Prices.length > 0 ? q1Prices[0] : null;
  const latestQ1 = q1Prices.length > 0 ? q1Prices[q1Prices.length - 1] : null;
  const latestPrice = latestQ1?.median_price ?? null;
  const earliestPrice = earliestQ1?.median_price ?? null;
  const nadlanPriceChange = (earliestPrice && latestPrice && earliestPrice > 0)
    ? ((latestPrice - earliestPrice) / earliestPrice * 100)
    : null;

  // ── Supply/demand gap (correct formula with fallback ladder) ────────────
  // demand = pop_growth / persons_per_household
  // supply = completions (4y) → starts (4y) → permits (4y) per year
  // gap    = supply − demand  (positive = oversupply, negative = undersupply)
  const gapAnalysis = await computeCityGap(cityName, { windowStart: 2020, windowEnd: 2024 });
  const ppa = gapAnalysis?.personsPerHousehold
    ?? city.people_per_apartment
    ?? city.avgHouseholdSize2022
    ?? 3.3;
  const supplyDemandRows = (gapAnalysis?.rows ?? []).map((r) => ({
    year: r.year,
    popGrowth: r.popGrowth,
    required: r.demand,
    permits: r.permits,
    starts: r.starts,
    completions: r.completions,
    chosenSupply: r.chosenSupply,
    chosenSource: r.chosenSource,
    gap: r.gap,
  }));

  // Totals from the gap analysis (single source of truth)
  const totalRequired = gapAnalysis?.totals.demand ?? null;
  const totalStarts = gapAnalysis?.totals.starts ?? 0;
  const totalCompletions = gapAnalysis?.totals.completions ?? 0;
  const totalChosenSupply = gapAnalysis?.totals.chosenSupply ?? null;
  const chosenSourceMeta = gapAnalysis ? describeSupplySource(gapAnalysis.totals.chosenSource) : null;
  const totalGap = gapAnalysis?.totals.gap ?? null;
  const totalGapPct = gapAnalysis?.totals.gapPctOfDemand ?? null;

  // Build construction chart data (for the CityConstructionMiniChart)
  const chartYears = Array.from({ length: 10 }, (_, i) => 2016 + i);
  const constructionChartData = chartYears.map((year) => {
    const popThis = populationByYear.find(p => p.year === year)?.population;
    const popPrev = populationByYear.find(p => p.year === year - 1)?.population;
    const popGrowth = popThis && popPrev ? popThis - popPrev : null;
    const housingNeed = popGrowth && ppa > 0 ? Math.round(popGrowth / ppa) : null;
    return {
      year,
      permits: buildingPermits.find(p => p.year === year)?.permits ?? null,
      starts: constructionStarts.find(s => s.year === year)?.starts
        ?? (startsByYearFromPress.get(year) ?? null),
      completions: completionsByYear.get(year) ?? null,
      housingNeed: housingNeed && housingNeed > 0 ? housingNeed : null,
    };
  });

  return (
    <main className="min-h-screen px-4 py-8 max-w-6xl mx-auto">
      {/* ── Navigation ─────────────────────────────────────────── */}
      <nav className="flex items-center justify-between mb-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-cyan-700 transition-colors group"
        >
          <span className="group-hover:-translate-x-0.5 transition-transform">←</span>
          חזרה לדף הבית
        </Link>
        <Link
          href="/cities"
          className="text-sm text-slate-500 hover:text-cyan-700 transition-colors"
        >
          טבלת ערים מלאה →
        </Link>
      </nav>

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="mb-10">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <p className="text-[10px] font-semibold tracking-[0.2em] text-cyan-500/80 uppercase mb-3">
              City Intelligence Report
            </p>
            <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 tracking-tight mb-3">
              {city.city_name}
            </h1>
            {city.population_2026 && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-slate-500 text-lg">
                  {formatNumber(city.population_2026)} תושבים
                </span>
                {city.population_growth_pct !== null && (
                  <span className={`text-sm px-2.5 py-0.5 rounded-full font-medium ${
                    city.population_growth_pct >= 0
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-red-50 text-red-600"
                  }`}>
                    {city.population_growth_pct >= 0 ? '+' : ''}{city.population_growth_pct.toFixed(1)}% גידול
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════
          SECTION 1: PRICES
          ═══════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="section-header">
          <div className="section-header-icon bg-cyan-50 text-cyan-700">₪</div>
          <div>
            <h2>מחירים</h2>
            <p>מחיר חציוני לדירה | מקור: nadlan.gov.il</p>
          </div>
        </div>
        {latestPrice ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile
              label={`מחיר חציוני Q1/${earliestQ1?.year ?? ''}`}
              value={formatPrice(earliestPrice)}
              accent="zinc"
            />
            <KpiTile
              label={`מחיר חציוני Q1/${latestQ1?.year ?? ''}`}
              value={formatPrice(latestPrice)}
              accent="cyan"
            />
            <KpiTile
              label={`שינוי מחיר ${earliestQ1?.year ?? ''}–${latestQ1?.year ?? ''}`}
              value={nadlanPriceChange !== null ? `${nadlanPriceChange >= 0 ? '+' : ''}${nadlanPriceChange.toFixed(1)}%` : '—'}
              accent={nadlanPriceChange !== null && nadlanPriceChange >= 0 ? "emerald" : "red"}
              valueClassName={nadlanPriceChange !== null && nadlanPriceChange >= 0 ? "text-emerald-700" : "text-red-600"}
            />
            <KpiTile
              label="נקודות מחיר זמינות"
              value={`${q1Prices.length} רבעונים`}
              accent="purple"
            />
          </div>
        ) : (
          <div className="glass-card p-6 text-center text-slate-500 text-sm">
            אין נתוני מחיר זמינים מ-nadlan.gov.il
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════
          SECTION 1.5: YAD2 MARKET (moved up for visibility)
          ═══════════════════════════════════════════════════════════ */}
      {yad2Data && (
        <section className="mb-10">
          <div className="section-header flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="section-header-icon bg-amber-50 text-amber-700">🏠</div>
              <div>
                <h2>מצב שוק — נתוני יד2</h2>
                <p>מודעות, ימים בשוק, סוג שוק | מקור: yad2 / yadata</p>
              </div>
            </div>
            <Link
              href="/stats/yad2-market-data"
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
            >
              <span>טבלה מלאה — כל הערים</span>
              <span>←</span>
            </Link>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Yad2Card
              label="נכסים חדשים למכירה"
              value={formatNumber(yad2Data.new_properties)}
              yoy={yad2Data.new_properties_yoy}
              color="text-cyan-700"
            />
            <Yad2Card
              label="נכסים יד שנייה"
              value={formatNumber(yad2Data.secondhand_properties)}
              yoy={yad2Data.secondhand_yoy}
              color="text-purple-700"
            />
            <Yad2Card
              label="ימים ממוצע למודעה"
              value={formatNumber(yad2Data.avg_days_on_market)}
              yoy={yad2Data.days_yoy}
              color="text-amber-700"
              invertYoy
            />
            <Yad2Card
              label="קונים שצפו"
              value={formatNumber(yad2Data.buyers_count)}
              yoy={yad2Data.buyers_yoy}
              color="text-emerald-700"
            />
          </div>

          <div className="mt-3 glass-card p-4 flex items-center gap-3">
            <span className="text-xl">
              {yad2Data.market_type === 'sellers' ? '🔥' : yad2Data.market_type === 'buyers' ? '❄️' : '⚖️'}
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">
                {yad2Data.market_type === 'sellers' ? 'שוק של מוכרים' : yad2Data.market_type === 'buyers' ? 'שוק של קונים' : 'שוק מאוזן'}
              </p>
              <p className="text-[10px] text-slate-500">על בסיס יחס קונים-מוכרים וזמן חשיפה</p>
            </div>
            <Link
              href="/stats/yad2-market-data"
              className="md:hidden text-xs text-amber-700 hover:text-amber-900 font-semibold"
            >
              כל הערים ←
            </Link>
          </div>

          {/* Household data from yadata (more current than CBS 2022) */}
          {(yad2Data.households || yad2Data.avg_household_size) && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              {yad2Data.households && (
                <KpiTile
                  label="משקי בית (יד2)"
                  value={formatNumber(yad2Data.households)}
                  accent="purple"
                />
              )}
              {yad2Data.avg_household_size && (
                <KpiTile
                  label="נפשות למשק בית (יד2)"
                  value={formatNumber(yad2Data.avg_household_size, 1)}
                  accent="amber"
                />
              )}
            </div>
          )}
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════
          SECTION 2: DEMOGRAPHICS
          ═══════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="section-header">
          <div className="section-header-icon bg-purple-50 text-purple-700">👥</div>
          <div>
            <h2>דמוגרפיה ודיור</h2>
            <p>מקור: data.gov.il מפקד 2022 | למ&quot;ס מרשם אוכלוסין</p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile label="אוכלוסייה 2021" value={formatNumber(city.population_2021)} accent="zinc" />
          <KpiTile label="אוכלוסייה 2022" value={formatNumber(city.population_2022)} accent="zinc" />
          <KpiTile label="אוכלוסייה 2024" value={formatNumber(city.population_2024)} accent="purple" />
          <KpiTile label="אוכלוסייה 2026" value={formatNumber(city.population_2026)} accent="cyan" href="/stats/total-population" />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          <KpiTile label="משקי בית 2022" value={formatNumber(city.households_2022)} accent="amber" />
          <KpiTile label="גודל משק בית ממוצע" value={formatNumber(city.avgHouseholdSize2022, 2)} accent="amber" />
          <KpiTile label="נפשות לדירה" value={formatNumber(city.people_per_apartment, 1)} accent="amber" />
          <KpiTile label="סך דירות" value={formatNumber(city.total_apartments)} accent="zinc" />
        </div>
        <NumberCaption
          source='למ"ס + מפקד 2022'
          sourceHref="https://www.cbs.gov.il/he/subjects/Pages/Population-Census-2022.aspx"
          period="2021 → 2026 (תחזית)"
          method="data.gov.il + cbs_registry_2025_update"
        />
      </section>

      {/* ═══════════════════════════════════════════════════════════
          SECTION 3: SUPPLY & DEMAND (EXPANDED)
          ═══════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="section-header">
          <div className="section-header-icon bg-red-50 text-red-600">⚖️</div>
          <div>
            <h2>היצע וביקוש — ניתוח מקיף</h2>
            <p>
              חישוב מגידול אוכלוסייה לפי {ppa.toFixed(1)} נפשות/משק בית
              {gapAnalysis ? ` (מקור: ${gapAnalysis.personsPerHouseholdSource === 'yad2' ? 'יד2' : gapAnalysis.personsPerHouseholdSource === 'census2022' ? 'מפקד 2022' : gapAnalysis.personsPerHouseholdSource === 'legacy_ppa' ? 'מחקר אקסל' : 'ממוצע ארצי'})` : ''}
              {' | '}חלון: {gapAnalysis?.windowStart ?? '—'}-{gapAnalysis?.windowEnd ?? '—'}
              {' | '}סולם היצע: גמר ← התחלות ← היתרים
            </p>
          </div>
        </div>

        {/* Supply-source provenance badge */}
        {chosenSourceMeta && (
          <div className={`mb-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold ${chosenSourceMeta.cls}`}>
            <span>📐 בסיס חישוב הפער:</span>
            <span className="font-bold">{chosenSourceMeta.he}</span>
            <span className="text-[10px] font-normal opacity-80">— {chosenSourceMeta.long}</span>
          </div>
        )}

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
          <KpiTile
            label={`דירות נדרשות (${gapAnalysis?.windowStart ?? 2020}-${gapAnalysis?.windowEnd ?? 2024})`}
            value={formatNumber(totalRequired !== null && totalRequired > 0 ? totalRequired : city.apartments_required)}
            accent="red"
          />
          <KpiTile
            label={`סך היתרי בנייה (${gapAnalysis?.coverage.yearsWithPermits ?? 0} שנים)`}
            value={formatNumber(gapAnalysis?.totals.permits ?? totalPermits)}
            accent="amber"
          />
          <KpiTile
            label={`סך התחלות בנייה (${gapAnalysis?.coverage.yearsWithStarts ?? 0} שנים)`}
            value={formatNumber(totalStarts > 0 ? totalStarts : null)}
            accent="emerald"
          />
          <KpiTile
            label={`סך גמר בנייה (${gapAnalysis?.coverage.yearsWithCompletions ?? 0} שנים)`}
            value={formatNumber(totalCompletions > 0 ? totalCompletions : null)}
            accent="cyan"
          />
          <KpiTile
            label={`פער (${chosenSourceMeta?.he ?? '—'} − נדרש)`}
            value={totalGap !== null ? `${totalGap >= 0 ? '+' : ''}${formatNumber(totalGap)}${totalGapPct !== null ? ` (${totalGapPct >= 0 ? '+' : ''}${totalGapPct.toFixed(0)}%)` : ''}` : '—'}
            accent={totalGap !== null && totalGap >= 0 ? "emerald" : "red"}
            valueClassName={totalGap !== null && totalGap >= 0 ? "text-emerald-700" : "text-red-600"}
          />
        </div>

        {/* Yearly breakdown table */}
        <div className="glass-card overflow-hidden mb-5">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-700">פירוט שנתי — דירות נדרשות מול בנייה בפועל</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" dir="rtl">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="py-3 px-4 text-right text-xs text-slate-500 font-medium">שנה</th>
                  <th className="py-3 px-4 text-center text-xs text-slate-500 font-medium">גידול אוכלוסייה</th>
                  <th className="py-3 px-4 text-center text-xs font-medium text-red-600/80">דירות נדרשות</th>
                  <th className="py-3 px-4 text-center text-xs font-medium text-amber-700/80">היתרי בנייה</th>
                  <th className="py-3 px-4 text-center text-xs font-medium text-emerald-700/80">התחלות בנייה</th>
                  <th className="py-3 px-4 text-center text-xs font-medium text-cyan-700/80">גמר בנייה</th>
                  <th className="py-3 px-4 text-center text-xs text-slate-500 font-medium">בסיס</th>
                  <th className="py-3 px-4 text-center text-xs text-slate-500 font-medium">פער (היצע − נדרש)</th>
                </tr>
              </thead>
              <tbody>
                {supplyDemandRows.map((row) => {
                  const gapColor = row.gap === null
                    ? "text-slate-400"
                    : row.gap >= 0
                    ? "text-emerald-700"
                    : "text-red-600";
                  const sourceMeta = describeSupplySource(row.chosenSource);
                  return (
                    <tr key={row.year} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-4 text-slate-800 font-bold">{row.year}</td>
                      <td className="py-2.5 px-4 text-center text-slate-500">
                        {row.popGrowth !== null ? `${row.popGrowth >= 0 ? '+' : ''}${formatNumber(row.popGrowth)}` : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-center text-red-600 font-medium">
                        {formatNumber(row.required)}
                      </td>
                      <td className={`py-2.5 px-4 text-center font-medium ${row.chosenSource === 'permits' ? 'text-amber-700 ring-1 ring-amber-300 rounded' : 'text-amber-700'}`}>
                        {formatNumber(row.permits)}
                      </td>
                      <td className={`py-2.5 px-4 text-center font-medium ${row.chosenSource === 'starts' ? 'text-emerald-700 ring-1 ring-emerald-300 rounded' : 'text-emerald-700'}`}>
                        {formatNumber(row.starts)}
                      </td>
                      <td className={`py-2.5 px-4 text-center font-medium ${row.chosenSource === 'completions' ? 'text-cyan-700 ring-1 ring-cyan-300 rounded' : 'text-cyan-700'}`}>
                        {formatNumber(row.completions)}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <span className={`inline-block px-1.5 py-0.5 text-[10px] font-bold rounded border ${sourceMeta.cls}`}>
                          {sourceMeta.he}
                        </span>
                      </td>
                      <td className={`py-2.5 px-4 text-center font-bold ${gapColor}`}>
                        {row.gap !== null ? `${row.gap >= 0 ? '+' : ''}${formatNumber(row.gap)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
                {/* Totals row */}
                <tr className="bg-slate-50 font-bold">
                  <td className="py-3 px-4 text-slate-700">סה&quot;כ</td>
                  <td className="py-3 px-4 text-center text-slate-500">
                    {formatNumber(gapAnalysis?.totals.popGrowth ?? city.population_growth_abs)}
                  </td>
                  <td className="py-3 px-4 text-center text-red-600">
                    {formatNumber(totalRequired !== null && totalRequired > 0 ? totalRequired : city.apartments_required)}
                  </td>
                  <td className="py-3 px-4 text-center text-amber-700">
                    {formatNumber(gapAnalysis?.totals.permits ?? totalPermits)}
                  </td>
                  <td className="py-3 px-4 text-center text-emerald-700">
                    {formatNumber(totalStarts > 0 ? totalStarts : null)}
                  </td>
                  <td className="py-3 px-4 text-center text-cyan-700">
                    {formatNumber(totalCompletions > 0 ? totalCompletions : null)}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {chosenSourceMeta && (
                      <span className={`inline-block px-1.5 py-0.5 text-[10px] font-bold rounded border ${chosenSourceMeta.cls}`}>
                        {chosenSourceMeta.he}
                      </span>
                    )}
                  </td>
                  <td className={`py-3 px-4 text-center ${totalGap !== null && totalGap >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {totalGap !== null ? `${totalGap >= 0 ? '+' : ''}${formatNumber(totalGap)}` : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="px-5 py-2 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
            <span><span className="text-red-600">●</span> גרעון (היצע &lt; נדרש)</span>
            <span><span className="text-emerald-700">●</span> עודף (היצע &gt; נדרש)</span>
            <span className="text-slate-400">|</span>
            <span><strong>סולם פולבק לחישוב היצע:</strong> גמר בנייה ← התחלות בנייה ← היתרי בנייה. הסולם בוחר את המקור האיכותי ביותר הזמין לאותה שנה.</span>
          </div>
        </div>

        {/* Construction Chart */}
        {constructionChartData.some(d => d.permits || d.starts || d.completions || d.housingNeed) && (
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">היצע מול ביקוש — גרף שנתי</h3>
            <CityConstructionMiniChart data={constructionChartData} cityName={city.city_name} />
            <p className="text-[10px] text-slate-400 mt-2">
              עמודות: היתרי בנייה (כתום), התחלות (ירוק), גמר (תכלת) | קו אדום מקווקו: צורך בדירות חדשות
            </p>
          </div>
        )}
        <NumberCaption
          source='למ"ס: היתרים + 089/2026 + cbs_press_data'
          sourceHref="/reports/cbs_089_2026_construction.pdf"
          period={`${gapAnalysis?.windowStart ?? 2020}-${gapAnalysis?.windowEnd ?? 2024}`}
          method={`היצע: ${chosenSourceMeta?.he ?? '—'} | ביקוש: ${ppa.toFixed(1)} נפשות/בית`}
        />
      </section>

      <div className="section-divider" />

      {/* ═══════════════════════════════════════════════════════════
          NEIGHBORHOODS — top-3 from Govmap/nadlan.gov.il
          ═══════════════════════════════════════════════════════════ */}
      <CityNeighborhoods neighborhoods={cityNeighborhoods} />

      <div className="section-divider" />

      {/* (Yad2 section was moved to the top — right after the city header) */}

      {/* ═══════════════════════════════════════════════════════════
          SECTION 5: CHARTS
          ═══════════════════════════════════════════════════════════ */}

      {/* Population by Year */}
      {populationByYear.length > 2 && (
        <section className="mb-10">
          <div className="glass-card p-6">
            <div className="section-header mb-4">
              <div className="section-header-icon bg-blue-500/10 text-blue-400">📊</div>
              <div className="flex-1">
                <h2>מגמת אוכלוסייה</h2>
                <p>2016-2026 | מקור: data.gov.il מרשם אוכלוסין + מפקד 2022</p>
              </div>
            </div>
            <PopulationChart
              data={populationByYear.map(p => ({
                year: p.year,
                population: p.population,
                source: p.source,
              }))}
              cityName={city.city_name}
            />
            {populationByYear.length >= 2 && (() => {
              const first = populationByYear.find(p => p.population)?.population ?? 0;
              const last = [...populationByYear].reverse().find(p => p.population)?.population ?? 0;
              const growthPct = first > 0 ? ((last - first) / first * 100).toFixed(1) : '—';
              return (
                <p className="text-xs text-slate-500 mt-3 text-center">
                  גידול כולל: <span className={Number(growthPct) >= 0 ? 'text-emerald-700' : 'text-red-600'}>{growthPct}%</span>
                  {' '}({formatNumber(first)} → {formatNumber(last)})
                </p>
              );
            })()}
          </div>
        </section>
      )}

      {/* Price Trends */}
      {priceTrends.length > 2 && (
        <section className="mb-10">
          <div className="glass-card p-6">
            <div className="section-header mb-4">
              <div className="section-header-icon bg-emerald-50 text-emerald-700">💰</div>
              <div className="flex-1">
                <h2>מגמת מחירים חציוניים</h2>
                <p>מקור: nadlan.gov.il — אתר הנדל&quot;ן הממשלתי</p>
              </div>
            </div>
            <PriceTrendChart
              data={priceTrends.map(p => ({
                year: p.year,
                quarter: p.quarter,
                median_price: p.median_price,
              }))}
              cityName={city.city_name}
            />
            {priceTrends.length >= 2 && (() => {
              const first = priceTrends.find(p => p.median_price)?.median_price ?? 0;
              const last = [...priceTrends].reverse().find(p => p.median_price)?.median_price ?? 0;
              const changePct = first > 0 ? ((last - first) / first * 100).toFixed(1) : '—';
              return (
                <p className="text-xs text-slate-500 mt-2 text-center">
                  שינוי מחיר חציוני: <span className={Number(changePct) >= 0 ? 'text-emerald-700' : 'text-red-600'}>{changePct}%</span>
                  {' '}(₪{formatNumber(first)} → ₪{formatNumber(last)})
                </p>
              );
            })()}
          </div>
        </section>
      )}

      {/* Scattered facts from CBS / MoF Chief Economist reports */}
      <ScatteredFactsSection facts={scattered.facts} timeSeries={scattered.timeSeries} />

      {/* Real Deals Comparison */}
      <CityDealsComparison cityName={city.city_name} />

      {/* Sales Chart */}
      {salesData && (
        <section className="mb-10">
          <div className="glass-card p-6">
            <div className="section-header mb-4">
              <div className="section-header-icon bg-cyan-50 text-cyan-700">🏗️</div>
              <div>
                <h2>מכירות דירות חדשות</h2>
                <p>מקור: למ&quot;ס — סקר בנייה (22 ערים)</p>
              </div>
            </div>
            <SalesChart
              sales2023={salesData?.new_sales_2023 ?? null}
              sales2024={salesData?.new_sales_2024 ?? null}
              sales2025={salesData?.new_sales_2025 ?? null}
            />
          </div>
        </section>
      )}

      {/* Building Permits Chart */}
      {permitsData.length > 0 && (
        <section className="mb-10">
          <div className="glass-card p-6">
            <div className="section-header mb-4">
              <div className="section-header-icon bg-amber-50 text-amber-700">📋</div>
              <div className="flex-1">
                <h2>היתרי בנייה לפי שנה (2016-2024)</h2>
                <p>מקור: למ&quot;ס — מחולל לוחות</p>
              </div>
              <div className="flex gap-4 text-xs text-slate-500">
                <span>סה&quot;כ: <span className="text-slate-700 font-medium">{totalPermits.toLocaleString("he-IL")}</span></span>
                <span>ממוצע: <span className="text-slate-700 font-medium">{avgPermits.toLocaleString("he-IL")}</span></span>
                {permitsTrend !== null && (
                  <span>מגמה: <span className={permitsTrend >= 0 ? "text-emerald-700" : "text-red-600"}>
                    {permitsTrend >= 0 ? "+" : ""}{permitsTrend.toFixed(0)}%
                  </span></span>
                )}
              </div>
            </div>
            <PermitsChart data={permitsData} cityName={city.city_name} />
          </div>
        </section>
      )}

      <div className="section-divider" />

      {/* ═══════════════════════════════════════════════════════════
          SECTION 6: ANALYSIS
          ═══════════════════════════════════════════════════════════ */}

      {/* Correlation Table */}
      {populationByYear.length > 2 && (
        <section className="mb-10">
          <div className="glass-card p-6">
            <div className="section-header mb-4">
              <div className="section-header-icon bg-purple-50 text-purple-700">🔗</div>
              <div className="flex-1">
                <h2>ניתוח קורלציה — גידול מול היצע</h2>
                <p>מקורות: data.gov.il | למ&quot;ס היתרי בנייה + התחלות בנייה</p>
              </div>
            </div>
            <CorrelationTable
              cityName={city.city_name}
              avgHouseholdSize={city.avgHouseholdSize2022}
              data={(() => {
                const years = [2020, 2021, 2022, 2023, 2024, 2025];
                return years.map(year => {
                  const popThisYear = populationByYear.find(p => p.year === year)?.population;
                  const popPrevYear = populationByYear.find(p => p.year === year - 1)?.population;
                  const growthPct = (popThisYear && popPrevYear && popPrevYear > 0)
                    ? ((popThisYear - popPrevYear) / popPrevYear * 100)
                    : null;
                  const popGrowth = (popThisYear && popPrevYear) ? popThisYear - popPrevYear : null;
                  const requiredHH = (popGrowth && city.avgHouseholdSize2022 && city.avgHouseholdSize2022 > 0)
                    ? Math.round(popGrowth / city.avgHouseholdSize2022)
                    : null;
                  const permits = buildingPermits.find(p => p.year === year)?.permits ?? null;
                  const starts = constructionStarts.find(s => s.year === year)?.starts ?? null;
                  return {
                    year,
                    populationGrowthPct: growthPct,
                    requiredHouseholds: requiredHH,
                    householdsGrowth: null,
                    buildingPermits: permits,
                    constructionStarts: starts,
                  };
                });
              })()}
            />
          </div>
        </section>
      )}

      {/* Sales Inventory */}
      {salesData && (
        <section className="mb-10">
          <div className="section-header">
            <div className="section-header-icon bg-amber-50 text-amber-700">📦</div>
            <div>
              <h2>מלאי ומכירות</h2>
              <p>מקור: למ&quot;ס — סקר בנייה, פרסומי מכירות דירות חדשות</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="kpi-card glow-amber">
              <p className="stat-label mb-2">מלאי לא מכור 2025</p>
              <p className="stat-value text-amber-700">{formatNumber(salesData.unsold_inventory_2025)}</p>
              <p className="text-[10px] text-slate-400 mt-1">דירות</p>
            </div>
            <div className="kpi-card glow-cyan">
              <p className="stat-label mb-2">ממוצע מכירות 3 שנים</p>
              <p className="stat-value text-cyan-700">{salesData.avg_sales_3y !== null ? salesData.avg_sales_3y.toFixed(0) : "—"}</p>
              <p className="text-[10px] text-slate-400 mt-1">דירות לשנה</p>
            </div>
            <div className="kpi-card glow-purple">
              <p className="stat-label mb-2">שנים לפינוי מלאי</p>
              <p className="stat-value text-purple-700">{salesData.years_to_clear_avg !== null ? salesData.years_to_clear_avg.toFixed(1) : "—"}</p>
              <p className="text-[10px] text-slate-400 mt-1">שנים</p>
            </div>
          </div>
        </section>
      )}

      {/* Urban Renewal */}
      {city.urban_renewal_status && (
        <section className="mb-10">
          <div className="section-header">
            <div className="section-header-icon bg-emerald-50 text-emerald-700">🔄</div>
            <div>
              <h2>התחדשות עירונית</h2>
            </div>
          </div>
          <div className="glass-card p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <p className="stat-label mb-1">סטטוס</p>
                <p className="text-lg font-bold text-cyan-700">{city.urban_renewal_status}</p>
              </div>
              {city.urban_renewal_proposed_units !== null && (
                <div>
                  <p className="stat-label mb-1">יחידות מוצעות</p>
                  <p className="text-lg font-bold text-emerald-700">{formatNumber(city.urban_renewal_proposed_units)}</p>
                </div>
              )}
              {city.urban_renewal_existing_units !== null && (
                <div>
                  <p className="stat-label mb-1">יחידות קיימות</p>
                  <p className="text-lg font-bold text-slate-700">{formatNumber(city.urban_renewal_existing_units)}</p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Insights */}
      {insightEntries.length > 0 && (
        <section className="mb-10">
          <div className="section-header">
            <div className="section-header-icon bg-blue-500/10 text-blue-400">💡</div>
            <div>
              <h2>תובנות אנליטיות</h2>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {insightEntries.map((insight) => (
              <div
                key={insight.key}
                className={`flex items-start gap-3 px-5 py-4 glass-card border ${insight.color}`}
              >
                <span className="text-xl flex-shrink-0 mt-0.5">{insight.icon}</span>
                <p className="text-slate-700 text-sm leading-relaxed">{insight.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="section-divider" />

      {/* ═══════════════════════════════════════════════════════════
          RAW DATA TABLE
          ═══════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="section-header">
          <div className="section-header-icon bg-slate-100 text-slate-600">📋</div>
          <div>
            <h2>כל הנתונים</h2>
          </div>
        </div>
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {[
                ["אוכלוסייה 2021", formatNumber(city.population_2021)],
                ["אוכלוסייה 2022", formatNumber(city.population_2022)],
                ["אוכלוסייה 2024", formatNumber(city.population_2024)],
                ["אוכלוסייה 2026", formatNumber(city.population_2026)],
                ["גידול אוכלוסייה", city.population_growth_pct !== null ? `${city.population_growth_pct >= 0 ? '+' : ''}${city.population_growth_pct.toFixed(1)}%` : '—'],
                ["משקי בית 2022", formatNumber(city.households_2022)],
                ["גודל משק בית ממוצע 2022", formatNumber(city.avgHouseholdSize2022, 2)],
                ["נפשות לדירה", formatNumber(city.people_per_apartment, 2)],
                ["סך דירות", formatNumber(city.total_apartments)],
                ['מחיר למ"ר 2023', formatPrice(city.price_per_sqm_2023)],
                ['מחיר למ"ר 2026', formatPrice(city.price_per_sqm_2026)],
                ["שינוי מחיר", formatPct(city.price_change_pct)],
                ["התחלות בנייה גולמי (4 שנים)", formatNumber(city.construction_4y_gross)],
                ["מקדם נטו", formatNumber(city.net_coefficient, 2)],
                ["התחלות בנייה נטו", formatNumber(city.construction_net)],
                // NOTE: removed "דירות נדרשות / גידול דירות / מכפיל הזהב / % הזהב" — these
                // were computed from a stale 2026 population projection that produced
                // garbage values (e.g. -1,355% for TLV). The new gap analysis at the top
                // of the page replaces them with a correct fallback-ladder calculation.
              ]
                .filter(([, val]) => val !== "—")
                .map(([label, val]) => (
                  <tr key={label} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-slate-500 font-medium">{label}</td>
                    <td className="px-5 py-3 text-slate-900 text-left font-medium">{val}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="pt-8 pb-4 border-t border-slate-100 text-center">
        <p className="text-slate-500 text-xs">
          מקור: למ&quot;ס, מחקר פנימי קרנף | עודכן:{" "}
          {city.last_updated
            ? city.last_updated.toLocaleDateString("he-IL")
            : "לא ידוע"}
        </p>
      </footer>
    </main>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

type AccentColor = "cyan" | "purple" | "emerald" | "amber" | "red" | "zinc";

function KpiTile({
  label,
  value,
  unit,
  accent = "cyan",
  valueClassName,
  href,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: AccentColor;
  valueClassName?: string;
  /** Optional link — if provided, the tile becomes clickable and shows a hover hint. */
  href?: string;
}) {
  const accentMap: Record<AccentColor, string> = {
    cyan: "text-cyan-700",
    purple: "text-purple-700",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    red: "text-red-600",
    zinc: "text-slate-800",
  };

  const glowMap: Record<AccentColor, string> = {
    cyan: "glow-cyan",
    purple: "glow-purple",
    emerald: "glow-emerald",
    amber: "glow-amber",
    red: "glow-red",
    zinc: "glow-zinc",
  };

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="stat-label">{label}</p>
        {href && (
          <span className="text-[10px] text-slate-300 group-hover:text-slate-700 transition-colors" title="צפה בטבלה מלאה">
            ←
          </span>
        )}
      </div>
      <p className={`stat-value mt-1 ${valueClassName ?? accentMap[accent]}`}>
        {value}
      </p>
      {unit && <p className="text-[10px] text-slate-400 mt-0.5">{unit}</p>}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`kpi-card ${glowMap[accent]} block group cursor-pointer`}>
        {inner}
      </Link>
    );
  }
  return (
    <div className={`kpi-card ${glowMap[accent]}`}>
      {inner}
    </div>
  );
}

function Yad2Card({
  label,
  value,
  yoy,
  color,
  invertYoy = false,
}: {
  label: string;
  value: string;
  yoy: number | null;
  color: string;
  invertYoy?: boolean;
}) {
  const yoyPositive = invertYoy ? (yoy ?? 0) <= 0 : (yoy ?? 0) >= 0;
  return (
    <div className="kpi-card glow-zinc">
      <p className="stat-label mb-2">{label}</p>
      <p className={`stat-value ${color}`}>{value}</p>
      {yoy !== null && (
        <p className={`text-xs mt-1.5 ${yoyPositive ? 'text-emerald-700' : 'text-red-600'}`}>
          {yoy >= 0 ? '+' : ''}{yoy}% משנה קודמת
        </p>
      )}
    </div>
  );
}
