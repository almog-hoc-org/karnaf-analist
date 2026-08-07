import { prisma } from "@/lib/db";
import RankingCard from "@/components/RankingCard";
import HomeSearch from "@/components/HomeSearch";
import CourseBanner from "@/components/CourseBanner";
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
import { loadCbsSales } from "@/lib/cbsSales";
import CbsSalesChart from "@/components/CbsSalesChart";
import { loadDiscoveredReports } from "@/lib/data-refresh";
import { whatsappUrl } from "@/lib/brand";
import Icon from "@/components/Icon";

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
  } catch (e) {
    // Was a bare `catch {}`. A database that is down and a database that is
    // empty then looked identical, and both landed on the screen below — so an
    // outage was silent in the logs and indistinguishable from first-run.
    console.error("[home] city count failed:", e);
  }

  if (cityCount === 0) {
    // THIS IS A VISITOR-FACING SCREEN, not a developer one. It used to print
    // `npx tsx src/lib/import.ts` — a command for whoever runs the server, and
    // a path that has not existed since the src/ layout was dropped. Anyone
    // arriving from Instagram during a database blip was shown a shell command
    // to run on a machine they do not have.
    //
    // What a visitor needs is that the problem is ours, that their time is not
    // being wasted, and a way to reach a person. The operator gets the real
    // diagnosis from the log line above and /api/health.
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="max-w-md text-center space-y-4">
          <div className="text-5xl mb-6"><Icon name="rhino" size="1em" /></div>
          <h1 className="text-2xl font-bold text-slate-900">הנתונים לא נטענים כרגע</h1>
          <p className="text-slate-600 text-lg">
            זו תקלה אצלנו, לא אצלך. אנחנו כבר על זה — נסה שוב בעוד כמה דקות.
          </p>
          <p className="text-sm text-slate-500">
            דחוף?{" "}
            <a
              href={whatsappUrl("היי, האתר לא טוען לי נתונים")}
              className="text-indigo-600 underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              כתוב לנו בוואטסאפ
            </a>
          </p>
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
  const cbsSales = loadCbsSales();
  // reports the refresh engine discovered (fix #3: this file was written but never read)
  const discoveredReports = loadDiscoveredReports(10);
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
    // Usable deals only: active (non-excluded) and within the last 10 years — the
    // exact set that feeds the graphs, so the headline can't over-state the DB.
    const [totals] = await prisma.$queryRawUnsafe<Array<{ n: bigint; maxd: string | null }>>(
      "SELECT COUNT(*) AS n, MAX(deal_date) AS maxd FROM nadlan_transactions WHERE COALESCE(excluded,0)=0 AND deal_year >= CAST(strftime('%Y','now') AS INTEGER) - 10"
    );
    const [recent] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      "SELECT COUNT(*) AS n FROM nadlan_transactions WHERE COALESCE(excluded,0)=0 AND deal_date >= date('now','-12 months')"
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
      icon: "crown",
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
      icon: "construction",
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
      icon: "building",
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
    <main className="min-h-screen page-wrap-wide py-8">
      {/* ── HERO — Compact, screenshot-optimized ───────────────── */}
      {/* ── HERO — search-first, exactly one focal point (yad2 lesson) ── */}
      <header className="animate-fade-up pb-2 pt-6 text-center md:pt-10">
        <div className="mb-5 flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-500 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-indigo-600" />
            </span>
            <span className="t-label text-indigo-700">מאגר עסקאות עצמאי · מבוסס נתוני אמת</span>
          </span>
        </div>

        <h1 className="t-display text-balance">
          <span className="text-gradient-hero">קרנף אנליסט</span>
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-slate-500" style={{ fontSize: 16, lineHeight: 1.55 }}>
          מחקר וניתוח שוק הנדל״ן בישראל — מבוסס עסקאות אמת
        </p>

        {/* the one dominant control on the page */}
        <div className="mx-auto mt-6 max-w-2xl">
          <HomeSearch cities={allCities} />
        </div>
        <p className="mt-3 text-slate-400" style={{ fontSize: 13 }}>
          חפש עיר וקבל מחירים, מגמות והשוואות · {cityCount} ערים במאגר
        </p>
      </header>

      {/* ── HERO KPIs — live values computed from the DB on every render ──
          Each number carries its own explicit time window + provenance caption. */}
      <section className="card-grid mt-8 grid-cols-1 sm:grid-cols-3">
        {/* Total deals in the transactions DB */}
        <Link href="/sources" className="hero-kpi hero-indigo group cursor-pointer block">
          <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
            <span className="text-xl"><Icon name="database" size="1em" /></span>
            <div className="stat-label min-w-0 break-words">סה&quot;כ עסקאות במאגר</div>
          </div>
          <div className="stat-mega">{totalDeals ? totalDeals.toLocaleString("he-IL") : "—"}</div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
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
          <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
            <span className="text-xl"><Icon name="handshake" size="1em" /></span>
            <div className="stat-label min-w-0 break-words">עסקאות ב-12 החודשים האחרונים</div>
          </div>
          <div className="stat-mega">{deals12m ? deals12m.toLocaleString("he-IL") : "—"}</div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <span className="trend-pill trend-flat">12 החודשים האחרונים</span>
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
          <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
            <span className="text-xl"><Icon name="trend-up" size="1em" /></span>
            <div className="stat-label min-w-0 break-words">שינוי מחיר יד-2 ארצי — 3 שנים</div>
          </div>
          <div className="leading-none" style={{ fontSize: "clamp(28px, 7.5vw, 44px)" }}>
            <TrendValue pct={median3y} className="font-extrabold tracking-tight" />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <span className="trend-pill trend-flat">יד שנייה בלבד</span>
            <span className="text-xs text-slate-500">חציון {sh3all.length} ערים</span>
          </div>
          <NumberCaption
            source="עסקאות יד-שנייה אמיתיות · רשות המסים"
            period={`חציון שינוי 3 שנים בין הערים · ${window3yLabel ?? "—"}`}
            insideLink
          />
        </Link>


      </section>

      {/* ── Rankings ─────────────────────────────────────────────── */}
      <section className="stack mt-14">
        <div className="section-header mb-6">
          <div className="section-header-icon"><Icon name="trophy" size="1em" /></div>
          <div>
            <h2 className="text-2xl font-black text-slate-900">דירוגים מובילים</h2>
            <p className="text-xs text-slate-500 mt-0.5">חמש הערים המובילות בכל קטגוריה</p>
          </div>
        </div>

        {/* 4 cards → never more than 4 columns (a 5-col grid squeezed each card to 165px and city names vanished) */}
        <div className="card-grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
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

      {/* ── CBS national sales: new vs second-hand ─────────────── */}
      {cbsSales && (
        <section className="mt-14">
          <CbsSalesChart data={cbsSales} />
        </section>
      )}

      {/* ── Recent CBS / MoF Reports (curated + auto-discovered by the refresh engine) ── */}
      <RecentReportsSection
        discovered={discoveredReports.reports.map((r) => ({
          id: r.id,
          title: r.title,
          publisher: r.publisher,
          publishedDate: r.publishedDate,
          pdfUrl: r.pdfUrl,
          primaryPdfPath: r.primaryPdfPath,
          highlights: r.highlights,
        }))}
        lastRefreshedAt={discoveredReports.lastRefreshedAt}
      />

      {/* The one commercial block on the site, and it comes LAST on purpose —
          see the note in CourseBanner. A research tool that opens with a pitch
          has already told the reader which of those it is. */}
      <div className="px-4 md:px-6">
        <CourseBanner />
      </div>
    </main>
  );
}
