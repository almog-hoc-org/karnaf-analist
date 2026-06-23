import { prisma } from "@/lib/db";
import Link from "next/link";
import CitiesTable from "@/components/CitiesTable";

export const metadata = {
  title: 'טבלת ערים | מחקר נדל"ן ישראל',
};

export default async function CitiesPage() {
  const cities = await prisma.city.findMany({
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

  // ─── Price changes per city across 3y / 5y windows ───────────────────────
  // Source: nadlan_price_trends (quarterly median prices). We average the
  // quarters per year, then compare the earliest year (window start) vs the
  // latest available year. The 5y window aligns with the 2020-start window
  // shown on each city's detail page; the 3y window is 2022-onwards.
  const priceRows = await prisma.nadlan_price_trends.findMany({
    where: { median_price: { not: null, gt: 0 } },
    orderBy: [{ city_name: "asc" }, { year: "asc" }, { quarter: "asc" }],
  });

  type YearAvg = { sum: number; n: number };
  const cityYearAvg = new Map<string, Map<number, YearAvg>>();
  for (const r of priceRows) {
    if (r.median_price === null) continue;
    let yrs = cityYearAvg.get(r.city_name);
    if (!yrs) { yrs = new Map(); cityYearAvg.set(r.city_name, yrs); }
    const cur = yrs.get(r.year) ?? { sum: 0, n: 0 };
    cur.sum += r.median_price;
    cur.n += 1;
    yrs.set(r.year, cur);
  }

  function computeChange(yrs: Map<number, YearAvg>, fromYear: number): { pct: number; fromAvg: number; toAvg: number; fromY: number; toY: number } | null {
    // Pick the actual earliest year >= fromYear, and the actual latest year available.
    const years = [...yrs.keys()].sort((a, b) => a - b);
    const start = years.find((y) => y >= fromYear);
    const end = years[years.length - 1];
    if (start === undefined || end === undefined || start >= end) return null;
    const a = yrs.get(start)!;
    const b = yrs.get(end)!;
    const fromAvg = a.sum / a.n;
    const toAvg = b.sum / b.n;
    if (fromAvg <= 0) return null;
    return {
      pct: ((toAvg - fromAvg) / fromAvg) * 100,
      fromAvg,
      toAvg,
      fromY: start,
      toY: end,
    };
  }

  const priceChange3y = new Map<string, ReturnType<typeof computeChange>>();
  const priceChange5y = new Map<string, ReturnType<typeof computeChange>>();
  for (const [cityName, yrs] of cityYearAvg) {
    priceChange3y.set(cityName, computeChange(yrs, 2022));
    priceChange5y.set(cityName, computeChange(yrs, 2020));
  }

  const tableData = cities.map((c) => {
    const permits = permitsMap.get(c.city_name);
    const ch3 = priceChange3y.get(c.city_name) ?? null;
    const ch5 = priceChange5y.get(c.city_name) ?? null;
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
    };
  });

  return (
    <main className="min-h-screen px-4 py-8 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-8">
        <Link
          href="/"
          className="text-sm text-slate-500 hover:text-cyan-700 transition-colors"
        >
          ← חזרה לדף הבית
        </Link>
      </div>

      <header className="mb-8">
        <p className="text-xs font-medium tracking-widest text-cyan-500 uppercase mb-2">
          All Cities Data
        </p>
        <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-2">
          טבלת ערים מלאה
        </h1>
        <p className="text-slate-500">
          {tableData.length} ערים | ניתן לסנן, למיין וללחוץ על עיר לדף מפורט
        </p>
      </header>

      <CitiesTable data={tableData} />

      <footer className="mt-12 pt-6 border-t border-slate-200 text-center text-slate-500 text-xs">
        מקור: למ&quot;ס, מחקר פנימי קרנף 2026
      </footer>
    </main>
  );
}
