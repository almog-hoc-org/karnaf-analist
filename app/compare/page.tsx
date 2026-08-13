import { prisma } from "@/lib/db";
import { ALIAS_NAMES } from "@/lib/cityAliases";
import {
  computeAllInvestorMetrics,
  investorProvenance,
} from "@/lib/investorMetrics";
import { refYear } from "@/lib/refYear";
import CompareView, {
  type CompareCityRow,
  type CompareMetrics,
  type CompareSeriesPoint,
} from "@/components/CompareView";

export const metadata = {
  title: 'השוואת ערים | קרנף אנליסט',
};

// searchParams drive the initial selection — must render per-request.
export const dynamic = "force-dynamic";

const DEFAULT_CITIES = ["תל אביב-יפו", "ירושלים"];
const MAX_CITIES = 4;

/** A year-cell needs at least this many deals to be priced on the chart. */
const MIN_N_PER_YEAR = 30;

interface SeriesRow {
  city_name: string;
  year: number | bigint;
  avg_sqm: number | null;
  n: number | bigint;
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams?: { cities?: string };
}) {
  const [cityRows, metricsMap, seriesRows] = await Promise.all([
    prisma.city.findMany({
      where: { city_name: { notIn: ALIAS_NAMES } },
      select: {
        city_name: true,
        population_2026: true,
        households_2022: true,
        price_per_sqm_2026: true,
        sales: { select: { unsold_inventory_2025: true, years_to_clear_avg: true } },
      },
      orderBy: { population_2026: "desc" },
    }),
    computeAllInvestorMetrics(),
    prisma.$queryRawUnsafe<SeriesRow[]>(
      `SELECT city_name, year, avg_sqm, n FROM nadlan_year_room_stats
       WHERE room_bucket='all' AND scope='all' AND year>=2010`
    ),
  ]);

  // ── Serialize to plain JSON-safe objects (no Map / BigInt over the wire) ──
  const cities: CompareCityRow[] = cityRows.map((c) => ({
    city_name: c.city_name,
    population_2026: c.population_2026 != null ? Number(c.population_2026) : null,
    households_2022: c.households_2022 != null ? Number(c.households_2022) : null,
    price_per_sqm_2026: c.price_per_sqm_2026 != null ? Number(c.price_per_sqm_2026) : null,
    unsold_inventory: c.sales?.unsold_inventory_2025 != null ? Number(c.sales.unsold_inventory_2025) : null,
    years_to_clear: c.sales?.years_to_clear_avg != null ? Number(c.sales.years_to_clear_avg) : null,
  }));

  const metrics: Record<string, CompareMetrics> = {};
  for (const [city, m] of metricsMap) {
    metrics[city] = {
      cityName: m.cityName,
      chg1y: m.chg1y,
      chg3y: m.chg3y,
      newPremiumPct: m.newPremiumPct,
      newPremiumYear: m.newPremiumYear,
      dealsPerYear: m.dealsPerYear,
      gapPctOfDemand: m.gapPctOfDemand,
      gapSource: m.gapSource,
      nDeals: m.nDeals,
      distinctYears: m.distinctYears,
      confidence: m.confidence,
    };
  }

  // Price series per city — skip thin year-cells (n < 30), Number() for BigInt safety.
  const series: Record<string, CompareSeriesPoint[]> = {};
  for (const r of seriesRows) {
    if (r.avg_sqm == null || Number(r.n) < MIN_N_PER_YEAR) continue;
    (series[r.city_name] ??= []).push({
      year: Number(r.year),
      avg_sqm: Number(r.avg_sqm),
    });
  }
  for (const c of Object.keys(series)) series[c].sort((a, b) => a.year - b.year);

  // ── Initial selection from ?cities=a,b,c (validated, capped at 4) ─────────
  const known = new Set(cities.map((c) => c.city_name));
  const requested = (searchParams?.cities ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && known.has(s));
  const initialCities = (requested.length > 0 ? [...new Set(requested)] : DEFAULT_CITIES)
    .filter((c) => known.has(c))
    .slice(0, MAX_CITIES);

  return (
    <main className="min-h-screen page-wrap-wide py-8">
      <header className="mb-8 text-center">
        <h1 className="text-3xl md:text-5xl font-black tracking-tight text-balance">
          <span className="text-gradient-hero">השוואת ערים</span>
        </h1>
        <p className="text-slate-500 text-sm md:text-base font-medium max-w-xl mx-auto mt-3 leading-relaxed">
          2–4 ערים זו מול זו — מחירים מעסקאות אמיתיות, פרמיית חדשות והיצע · שנת ייחוס {refYear()}
        </p>
      </header>

      <CompareView
        cities={cities}
        metrics={metrics}
        series={series}
        initialCities={initialCities}
        refYear={refYear()}
        provenance={investorProvenance()}
      />
    </main>
  );
}
