import { prisma } from "@/lib/db";
import { ALIAS_NAMES } from "@/lib/cityAliases";
import Link from "next/link";
import CitiesTable, { type InvestorRow } from "@/components/CitiesTable";
import { loadAllCityPriceChanges } from "@/lib/price-changes";
import { loadCitiesChangeMetrics } from "@/lib/cityChangeMetrics";
import { computeAllInvestorMetrics } from "@/lib/investorMetrics";
import { refYear } from "@/lib/refYear";
import { loadCityTransactionPrices, loadActiveDealCounts, loadFourRoomPrices, loadPopulationGrowth10y } from "@/lib/cityTransactionPrices";
import { getRuleNum } from "@/lib/systemRules";

export const metadata = {
  title: 'טבלת ערים | קרנף אנליסט',
};

export default async function CitiesPage() {
  // ONE await for seven independent loaders. They were seven sequential
  // awaits — none of them depends on another, so the page paid the sum of
  // their latencies instead of the slowest.
  const [cities, permitsAgg, allPriceChanges, txPrices, changeMetrics, dealCountMap, investorMetrics, fourRoom, popGrowth] = await Promise.all([
    prisma.city.findMany({
      where: { city_name: { notIn: ALIAS_NAMES } },
      orderBy: { population_2026: "desc" },
      include: {
        sales: {
          select: {
            unsold_inventory_2025: true,
            years_to_clear_avg: true,
          },
        },
      },
    }),
    // total permits per city
    prisma.buildingPermit.groupBy({
      by: ["city_name"],
      _sum: { permits: true },
      _count: { permits: true },
    }),
    // Centralized 3y/5y price-change calculation (shared with city page + rankings)
    loadAllCityPriceChanges(),
    // Price LEVELS from real transactions — the site's price axis
    loadCityTransactionPrices(),
    // Per-city yearly value series for the windowed change columns
    loadCitiesChangeMetrics(),
    // Per-city total collected transactions — a column AND the basis for the
    // yellow thin-sample tint. Counted from ACTIVE rows via the same loader the
    // ranking exclusion uses, so tint, count and rankings always agree.
    loadActiveDealCounts(),
    // Investor screener metrics
    computeAllInvestorMetrics(),
    // Two default columns added 8/2026. Both join the existing Promise.all
    // rather than being awaited after it — none of these depend on each other,
    // and the page should pay the slowest, not the sum.
    loadFourRoomPrices(),
    loadPopulationGrowth10y(),
  ]);

  const permitsMap = new Map(
    permitsAgg.map((p) => [
      p.city_name,
      {
        total: p._sum.permits ?? 0,
        years: p._count.permits ?? 0,
        avg: p._count.permits ? Math.round((p._sum.permits ?? 0) / p._count.permits) : 0,
      },
    ])
  );

  // user rule: cities under this many active deals are tinted yellow + excluded from rankings
  const minDeals = getRuleNum("city_min_total_deals", 150);

  // Map → serializable plain Record (BigInt-safe via Number()) for the client table.
  const investor: Record<string, InvestorRow> = {};
  investorMetrics.forEach((m, cityName) => {
    investor[cityName] = {
      newPremiumPct: m.newPremiumPct != null ? Number(m.newPremiumPct) : null,
      newPremiumYear: m.newPremiumYear != null ? Number(m.newPremiumYear) : null,
      gapPctOfDemand: m.gapPctOfDemand != null ? Number(m.gapPctOfDemand) : null,
      gapSource: m.gapSource,
      nDeals: Number(m.nDeals),
      distinctYears: Number(m.distinctYears),
      confidence: m.confidence,
    };
  });

  const tableData = cities.map((c) => {
    const permits = permitsMap.get(c.city_name);
    const changes = allPriceChanges.get(c.city_name);
    const ch3 = changes?.change3y ?? null;
    const ch5 = changes?.change5y ?? null;
    return {
      city_name: c.city_name,
      population_2022: c.population_2022,
      population_2024: c.population_2024,
      population_2026: c.population_2026,
      households_2022: c.households_2022,
      price_per_sqm_2023: c.price_per_sqm_2023,
      price_per_sqm_2026: c.price_per_sqm_2026,
      price_change_pct: c.price_change_pct,
      // ─── Nadlan-derived 3y / 5y price changes ─────
      price_change_3y_pct: ch3?.pct ?? null,
      price_change_3y_from: ch3?.fromY ?? null,
      price_change_3y_to: ch3?.toY ?? null,
      price_change_5y_pct: ch5?.pct ?? null,
      price_change_5y_from: ch5?.fromY ?? null,
      price_change_5y_to: ch5?.toY ?? null,
      golden_pct: c.golden_pct,
      golden_multiplier: c.golden_multiplier,
      people_per_apartment: c.people_per_apartment,
      construction_4y_gross: c.construction_4y_gross,
      apartments_required: c.apartments_required,
      apartment_growth: c.apartment_growth,
      unsold_inventory: c.sales?.unsold_inventory_2025 ?? null,
      years_to_clear: c.sales?.years_to_clear_avg ?? null,
      total_permits: permits?.total ?? null,
      avg_permits: permits?.avg ?? null,
      urban_renewal_status: c.urban_renewal_status,
      changeMetrics: changeMetrics.get(c.city_name),
      dealCount: dealCountMap.get(c.city_name) ?? null,
      tx_avg_4room: fourRoom.get(c.city_name)?.price ?? null,
      tx_avg_4room_year: fourRoom.get(c.city_name)?.year ?? null,
      pop_growth_10y_pct: popGrowth.get(c.city_name) ?? null,
      tx_price_year: txPrices.get(c.city_name)?.priceYear ?? null,
      tx_avg_all: txPrices.get(c.city_name)?.avgAllSqm ?? null,
      tx_median_all: txPrices.get(c.city_name)?.medianAllSqm ?? null,
      tx_avg_sh: txPrices.get(c.city_name)?.avgShSqm ?? null,
      tx_median_sh: txPrices.get(c.city_name)?.medianShSqm ?? null,
      tx_year_min: txPrices.get(c.city_name)?.yearMin ?? null,
      tx_year_max: txPrices.get(c.city_name)?.yearMax ?? null,
      tx_thin: txPrices.get(c.city_name)?.thin ?? true,
      tx_govmap: txPrices.get(c.city_name)?.govmapSource ?? false,
    };
  });

  return (
    <main className="min-h-screen page-wrap-wide pb-8 pt-3 md:py-8">
      {/* Back-link, title and subtitle in one block instead of three stacked
          ones. What came out: an English eyebrow ("All Cities Data") on a
          Hebrew site, and two mb-8 gaps — together about 200px of a phone
          screen spent before the first number. */}
      <header className="mb-3 md:mb-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl md:text-4xl font-bold text-slate-900">
            טבלת ערים מלאה
          </h1>
          <Link href="/" className="text-xs text-slate-500 transition-colors hover:text-indigo-700">
            ← חזרה לדף הבית
          </Link>
        </div>
        {/* one line, always: truncate is the guarantee, the short wording is
            what makes the guarantee cost nothing */}
        <p className="mt-1 truncate text-xs text-slate-500">
          {tableData.length} ערים · לחצו על עיר לפירוט
        </p>
      </header>

      <CitiesTable data={tableData} investor={investor} refYear={refYear()} minDeals={minDeals} />

      <footer className="mt-12 pt-6 border-t border-slate-200 text-center text-slate-500 text-xs">
        מקור: למ&quot;ס, מחקר פנימי קרנף 2026
      </footer>
    </main>
  );
}
