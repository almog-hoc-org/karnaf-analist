import { prisma } from "@/lib/db";
import RankingCard from "@/components/RankingCard";
import HomeSearch from "@/components/HomeSearch";
import Link from "next/link";
import RecentReportsSection from "@/components/RecentReportsSection";
import NumberCaption from "@/components/NumberCaption";
import PriceGainsRankingCard from "@/components/PriceGainsRankingCard";
import TrendValue from "@/components/TrendValue";
import { loadAllCityPriceChanges } from "@/lib/price-changes";
import { loadSecondhandChanges } from "@/lib/cityChangeMetrics";
import { loadCityTransactionPrices, loadRankingEligibleCities } from "@/lib/cityTransactionPrices";
import { computeMarketInsights } from "@/lib/marketInsights";
import MarketInsightsSection from "@/components/MarketInsightsSection";

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

  if (cityCount === 0) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="text-center space-y-4">
          <div className="text-5xl mb-6">🏗️</div>
          <h1 className="text-2xl font-bold text-slate-900">אין נתונים במערכת</h1>
          <p className="text-slate-600 text-lg">נא להריץ את סקריפט הייבוא.</p>
          <code className="block mt-4 px-4 py-2 bg-slate-100 border border-slate-200 rounded-lg text-indigo-700 text-sm">
            npx tsx src/lib/import.ts
          </code>
        </div>
      </main>
    );
  }

  // Load all cities for client-side search — the % shown per city is the
  // SECOND-HAND 3y change from real transactions (not the old Excel field).
  const allCitiesRaw = await prisma.city.findMany({
    orderBy: { city_name: "asc" },
    select: {
      id: true,
      city_name: true,
      population_2024: true,
      population_2022: true,
      population_2026: true,
    },
  });
  const sh3ForSearch = new Map((await loadSecondhandChanges(3)).map((c) => [c.city_name, c.pct]));
  const allCities = allCitiesRaw.map((c) => ({ ...c, price_change_pct: sh3ForSearch.get(c.city_name) ?? null }));

  // ── Hero aggregate stats ─────────────────────────────────────────
  const aggregates = await prisma.city.aggregate({
    _avg: { price_per_sqm_2026: true, price_change_pct: true, population_growth_pct: true },
    _max: { price_per_sqm_2026: true, price_change_pct: true },
    _sum: { population_2026: true, apartments_required: true },
    where: { price_per_sqm_2026: { not: null } },
  });

  const avgPricePerSqm = aggregates._avg.price_per_sqm_2026;
  const avgPriceChange = aggregates._avg.price_change_pct;
  const totalPopulation = aggregates._sum.population_2026;
  const totalApartmentsNeeded = aggregates._sum.apartments_required;

  // ── Rankings ─────────────────────────────────────────────────────
  // Top movers = SECOND-HAND ONLY (user rule: overall averages are biased
  // upward the moment a new expensive neighborhood is built).
  const allPriceChanges = await loadAllCityPriceChanges();
  // Normalization gate (user rule): rankings admit only cities with 10+ deals of EVERY type.
  const rankEligible = await loadRankingEligibleCities();
  const marketInsights = await computeMarketInsights().catch(() => []);
  const top3yGain = (await loadSecondhandChanges(3)).slice(0, 5);

  // Compact per-city yearly series for the fully-filterable movers card:
  // city → scope → year → [avgSqm, medianSqm]; n≥10 cells only, 2015+.
  const gainRows = await prisma.$queryRawUnsafe<
    Array<{ city_name: string; scope: string; year: number; avg_sqm: number | null; median_sqm: number | null }>
  >(
    `SELECT city_name, scope, year, avg_sqm, median_sqm FROM nadlan_year_room_stats
     WHERE room_bucket='all' AND year >= 2015 AND n >= 10`
  );
  const gainSeries: Record<string, Record<string, Record<number, [number, number]>>> = {};
  for (const r of gainRows) {
    if (r.avg_sqm == null || r.median_sqm == null) continue;
    if (!rankEligible.has(r.city_name)) continue; // normalization: 10+ deals of every type
    ((gainSeries[r.city_name] ??= {})[r.scope] ??= {})[Number(r.year)] = [
      Math.round(Number(r.avg_sqm)), Math.round(Number(r.median_sqm)),
    ];
  }
  const gainMaxYear = 2025;

  // ── Live hero KPIs ──────────────────────────────────────────────
  // nadlan_transactions lives outside the Prisma schema → raw SQL.
  // COUNT(*) comes back as BigInt from SQLite — must convert via Number().
  let totalDeals = 0;
  let deals12m = 0;
  let dealsMaxDate: string | null = null;
  try {
    const [totals] = await prisma.$queryRawUnsafe<Array<{ n: bigint; maxd: string | null }>>(
      "SELECT COUNT(*) AS n, MAX(deal_date) AS maxd FROM nadlan_transactions"
    );
    const [recent] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      "SELECT COUNT(*) AS n FROM nadlan_transactions WHERE deal_date >= date('now','-12 months')"
    );
    totalDeals = Number(totals?.n ?? 0);
    deals12m = Number(recent?.n ?? 0);
    dealsMaxDate = totals?.maxd ?? null;
  } catch {
    // nadlan_transactions missing — tiles fall back to "—"
  }
  const dealsUpdatedLabel = dealsMaxDate
    ? new Date(dealsMaxDate).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit" })
    : undefined;

  // National 3y KPI = median of the SECOND-HAND changes across cities
  // (already bounded + n≥10-gated inside loadSecondhandChanges).
  const sh3all = (await loadSecondhandChanges(3)).map((c) => c.pct).sort((a, b) => a - b);
  const median3y = sh3all.length
    ? (sh3all[Math.floor((sh3all.length - 1) / 2)] + sh3all[Math.ceil((sh3all.length - 1) / 2)]) / 2
    : null;
  const window3yLabel = top3yGain.length ? `${top3yGain[0].fromY}→${top3yGain[0].toY}` : null;

  // Most-expensive = second-hand median ₪/m² from REAL transactions
  const txPricesForRank = await loadCityTransactionPrices();
  const mostExpensiveTx = [...txPricesForRank.values()]
    .filter((p) => p.medianShSqm != null && rankEligible.has(p.cityName))
    .sort((a, b) => (b.medianShSqm ?? 0) - (a.medianShSqm ?? 0))
    .slice(0, 5);

  const [_mostExpensiveOld, _highestGain, highestSurplus, highestInventory] = await Promise.all([
    Promise.resolve([]),
    // Kept for parity with the surrounding Promise.all shape; the new
    // PriceGainsRankingCard renders top3yGain/top5yGain directly so this is unused.
    Promise.resolve([] as Array<{ city_name: string; price_change_pct: number | null }>),
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

  const rankings = [
    {
      title: "היקרות ביותר — חציון יד-2 ₪/מ״ר",
      icon: "👑",
      detailHref: "/rankings/most-expensive",
      items: mostExpensiveTx.map((c, i) => ({
        rank: i + 1,
        city: c.cityName,
        value: `₪${(c.medianShSqm ?? 0).toLocaleString("he-IL")}/מ"ר`,
        href: `/city/${encodeURIComponent(c.cityName)}`,
      })),
    },
    // NOTE: "עליית מחיר גבוהה ביותר" is now rendered by <PriceGainsRankingCard>
    // (a sibling of <RankingCard>) so it can host the 3y/5y toggle.
    {
      title: "התחלות בנייה 2025 (לפי עיר)",
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
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-600"></span>
            </span>
            <p className="text-[10px] font-bold tracking-[0.2em] text-indigo-700 uppercase">
              Real Estate Intelligence
            </p>
          </div>
          <span className="brand-stamp">
            <span>📅</span>
            <span>{heroDate}</span>
          </span>
        </div>

        <h1 className="text-4xl md:text-6xl font-black leading-[0.9] tracking-tight text-balance">
          <span className="text-gradient-hero">קרנף אנליסט</span>
        </h1>
        <p className="text-slate-500 text-sm md:text-base font-medium max-w-xl mx-auto mt-3 leading-relaxed">
          מחקר וניתוח שוק הנדל״ן בישראל — מחירים, עסקאות אמת, אוכלוסייה ובנייה
        </p>

        <div className="max-w-xl mx-auto mt-5">
          <HomeSearch cities={allCities} />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 mt-5 text-sm">
          <span className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-700 tabular-nums shadow-sm text-[13px]">
            <span className="font-bold text-indigo-700">{cityCount}</span>
            <span className="text-slate-500 mr-1.5">ערים במאגר</span>
          </span>

        </div>
      </header>

      {/* ── HERO KPIs — live values computed from the DB on every render ──
          Each number carries its own explicit time window + provenance caption. */}
      <section className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Total deals in the transactions DB */}
        <Link href="/sources" className="hero-kpi hero-indigo group cursor-pointer block">
          <div className="flex items-start justify-between mb-3">
            <div className="stat-label">סה&quot;כ עסקאות במאגר</div>
            <span className="text-xl">🗄️</span>
          </div>
          <div className="stat-mega">{totalDeals ? totalDeals.toLocaleString("he-IL") : "—"}</div>
          <div className="mt-3 flex items-center gap-2">
            <span className="trend-pill trend-flat">1998–2026</span>
            <span className="text-xs text-slate-500">כל העסקאות</span>
          </div>
          <NumberCaption
            source='רשות המסים + נדל"ן'
            period="1998–2026"
            updated={dealsUpdatedLabel}
            insideLink
          />
        </Link>

        {/* Deals in the trailing 12 months */}
        <Link href="/sources" className="hero-kpi hero-indigo group cursor-pointer block">
          <div className="flex items-start justify-between mb-3">
            <div className="stat-label">עסקאות — 12 ח׳ אחרונים</div>
            <span className="text-xl">🤝</span>
          </div>
          <div className="stat-mega">{deals12m ? deals12m.toLocaleString("he-IL") : "—"}</div>
          <div className="mt-3 flex items-center gap-2">
            <span className="trend-pill trend-flat">חלון נגרר 12 ח׳</span>
          </div>
          <NumberCaption
            source='רשות המסים + נדל"ן'
            period="12 החודשים האחרונים"
            updated={dealsUpdatedLabel}
            insideLink
          />
        </Link>

        {/* National 3y price change — SECOND-HAND only (real transactions) */}
        <Link href="/cities" className="hero-kpi hero-indigo group cursor-pointer block">
          <div className="flex items-start justify-between mb-3">
            <div className="stat-label">שינוי מחיר יד-2 ארצי — 3 שנים</div>
            <span className="text-xl">📈</span>
          </div>
          <div className="text-4xl md:text-5xl leading-none">
            <TrendValue pct={median3y} className="font-extrabold tracking-tight" />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="trend-pill trend-flat">יד שנייה בלבד</span>
            <span className="text-xs text-slate-500">חציון {sh3all.length} ערים</span>
          </div>
          <NumberCaption
            source="עסקאות יד-שנייה אמיתיות · רשות המסים"
            period={`חציון שינוי 3ש׳ בין הערים · ${window3yLabel ?? "—"}`}
            insideLink
          />
        </Link>


      </section>

      {/* ── Rankings ─────────────────────────────────────────────── */}
      <section className="mt-12">
        <div className="section-header mb-6">
          <div className="section-header-icon">🏆</div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">דירוגים מובילים</h2>
            <p className="text-xs text-slate-500 mt-0.5">חמש הערים המובילות בכל קטגוריה</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
          {rankings.map((ranking) => (
            <RankingCard
              key={ranking.title}
              title={ranking.title}
              items={ranking.items}
              icon={ranking.icon}
              detailHref={ranking.detailHref}
            />
          ))}
          {/* fully-filterable price-changes ranking (scope × metric × year range) */}
          <PriceGainsRankingCard series={gainSeries} minYear={2015} maxYear={gainMaxYear} />
        </div>
      </section>

      {/* ── Auto-computed investor insights ────────────────────── */}
      <MarketInsightsSection insights={marketInsights} />

      {/* ── Recent CBS / MoF Reports ───────────────────────────── */}
      <RecentReportsSection />




    </main>
  );
}
