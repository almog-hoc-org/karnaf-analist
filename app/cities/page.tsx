import { prisma } from "@/lib/db";
import { ALIAS_NAMES } from "@/lib/cityAliases";
import Link from "next/link";
import CitiesTable, { type InvestorRow } from "@/components/CitiesTable";
import { loadAllCityPriceChanges } from "@/lib/price-changes";
import { loadCitiesChangeMetrics } from "@/lib/cityChangeMetrics";
import { computeAllInvestorMetrics } from "@/lib/investorMetrics";
import { refYear } from "@/lib/refYear";
import { loadCityTransactionPrices, loadActiveDealCounts } from "@/lib/cityTransactionPrices";
import { getRuleNum } from "@/lib/systemRules";

export const metadata = {
  title: 'טבלת ערים | קרנף אנליסט',
};

export default async function CitiesPage() {
  const cities = await prisma.city.findMany({
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
  });

  // Get total permits per city
  const permitsAgg = await prisma.buildingPermit.groupBy({
    by: ["city_name"],
    _sum: { permits: true },
    _count: { permits: true },
  });

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

  // Centralized 3y/5y price-change calculation (shared with city page + rankings)
  const allPriceChanges = await loadAllCityPriceChanges();
  // Price LEVELS from real transactions — the site's price axis (replaces old-Excel prices)
  const txPrices = await loadCityTransactionPrices();
  // Per-city yearly value series for the windowed change columns (median / all / second-hand)
  const changeMetrics = await loadCitiesChangeMetrics();
  // Per-city total collected transactions (internal repository) — shown as a
  // column AND the basis for the yellow thin-sample tint. Counted from ACTIVE
  // rows (both sources, each deal once) via the same loader the ranking
  // exclusion uses, so the tint, the count and the rankings always agree.
  const dealCountMap = await loadActiveDealCounts();
  // user rule: cities under this many active deals are tinted yellow + excluded from rankings
  const minDeals = getRuleNum("city_min_total_deals", 150);

  // Investor screener metrics (server-computed Map → serializable plain Record,
  // BigInt-safe via Number()) — passed as a prop to the client table.
  const investorMetrics = await computeAllInvestorMetrics();
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
    <main className="min-h-screen page-wrap-wide py-8">
      <div className="flex items-center justify-between mb-8">
        <Link
          href="/"
          className="text-sm text-slate-500 hover:text-indigo-700 transition-colors"
        >
          ← חזרה לדף הבית
        </Link>
      </div>

      <header className="mb-8">
        <p className="text-xs font-medium tracking-widest text-indigo-500 uppercase mb-2">
          All Cities Data
        </p>
        <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-2">
          טבלת ערים מלאה
        </h1>
        <p className="text-slate-500">
          {tableData.length} ערים | ניתן לסנן, למיין וללחוץ על עיר לדף מפורט
        </p>
      </header>

      <CitiesTable data={tableData} investor={investor} refYear={refYear()} minDeals={minDeals} />

      <footer className="mt-12 pt-6 border-t border-slate-200 text-center text-slate-500 text-xs">
        מקור: למ&quot;ס, מחקר פנימי קרנף 2026
      </footer>
    </main>
  );
}
