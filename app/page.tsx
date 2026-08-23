import { prisma } from "@/lib/db";
import { historyFromYear } from "@/lib/historyWindow";
import { ALIAS_NAMES } from "@/lib/cityAliases";
import RankingCard from "@/components/RankingCard";
import HomeSearch from "@/components/HomeSearch";
import HotCities from "@/components/HotCities";
import { loadHotCities } from "@/lib/hotCities";
import CourseBanner from "@/components/CourseBanner";
import RecentReportsSection from "@/components/RecentReportsSection";
import { HeroKpiStrip, HeroKpiCards } from "@/components/HeroKpis";
import PriceGainsRankingCard from "@/components/PriceGainsRankingCard";
import { fromToText } from "@/components/FromTo";
import { loadSecondhandChanges } from "@/lib/cityChangeMetrics";
import { loadSubsidizedByCity } from "@/lib/subsidizedYears";
import { loadCityTransactionPrices, loadRankingEligibleCities } from "@/lib/cityTransactionPrices";
import { computeMarketInsights } from "@/lib/marketInsights";
import MarketInsightsSection from "@/components/MarketInsightsSection";
import { loadCbsSales } from "@/lib/cbsSales";
import { loadDealTotals } from "@/lib/dealTotals";
import CbsSalesChart from "@/components/CbsSalesChart";
import { loadDiscoveredReports } from "@/lib/data-refresh";
import { whatsappUrl } from "@/lib/brand";
import Icon from "@/components/Icon";
import OrderedSections from "@/components/OrderedSections";
import { getSectionOrder } from "@/lib/sectionOrder";

function formatNumber(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("he-IL");
}

export default async function HomePage() {
  // The home page did not know who was reading it. A returning user landed on
  // the same anonymous marketing hero as a first-time visitor and had to search
  // for their own city again, every time — the site had a follow feature and
  // then behaved as though nobody had ever used it.
  const sectionOrder = getSectionOrder("home");

  let cityCount = 0;

  try {
    cityCount = await prisma.city.count();
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
    where: { city_name: { notIn: ALIAS_NAMES } },
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

  // ── Rankings ─────────────────────────────────────────────────────
  // Top movers = SECOND-HAND ONLY (user rule: overall averages are biased
  // upward the moment a new expensive neighborhood is built).
  // Normalization gate (user rule): rankings admit only cities with 10+ deals of EVERY type.
  const rankEligible = await loadRankingEligibleCities();
  const marketInsights = await computeMarketInsights().catch(() => []);
  const cbsSales = loadCbsSales();
  // reports the refresh engine discovered (fix #3: this file was written but never read)
  // Four, matching what the section renders — there is no point serialising
  // six more into the RSC payload for rows that are sliced off on arrival.
  const discoveredReports = loadDiscoveredReports(4);
  const top3yGain = (await loadSecondhandChanges(3)).slice(0, 5);

  // Compact per-city yearly series for the fully-filterable movers card:
  // city → scope → year → [avgSqm, medianSqm]; n≥10 cells only, 2015+.
  const gainRows = await prisma.$queryRawUnsafe<
    Array<{ city_name: string; scope: string; year: number; avg_sqm: number | null; median_sqm: number | null }>
  >(
    `SELECT city_name, scope, year, avg_sqm, median_sqm FROM nadlan_year_room_stats
     WHERE room_bucket='all' AND year >= ${historyFromYear()} AND n >= 10`
  );
  const gainSeries: Record<string, Record<string, Record<number, [number, number]>>> = {};
  for (const r of gainRows) {
    if (r.avg_sqm == null || r.median_sqm == null) continue;
    if (!rankEligible.has(r.city_name)) continue; // normalization: 10+ deals of every type
    ((gainSeries[r.city_name] ??= {})[r.scope] ??= {})[Number(r.year)] = [
      Math.round(Number(r.avg_sqm)), Math.round(Number(r.median_sqm)),
    ];
  }
  // Offer every year the stats actually cover, INCLUDING the running calendar
  // year — but flag it, so the card can label it "חלקית" and never default to
  // it. (Operator request 8/2026: let the range reach 2026.)
  const currentYear = new Date().getFullYear();
  const gainMaxYear = gainRows.reduce((m, r) => Math.max(m, Number(r.year)), 2025);
  // The picker opens at the oldest year the stats actually carry (post
  // history-extension that reaches 1998) — not a hardcoded 2015.
  const gainMinYear = gainRows.reduce((m, r) => Math.min(m, Number(r.year)), 2015);
  const gainPartialYear = gainMaxYear >= currentYear ? currentYear : null;

  // ── Live hero KPIs ──────────────────────────────────────────────
  // Two full scans of 1.35M rows that no index covers, once per render until
  // now — moved to lib/dealTotals.ts behind the market cache tag, so they are
  // recomputed when the pipeline says the data changed and not before.
  const { totalDeals, deals12m, maxDealDate: dealsMaxDate } = await loadDealTotals();
  const subsidizedByCity = await loadSubsidizedByCity();
  const dealsUpdatedLabel = dealsMaxDate
    ? new Date(dealsMaxDate).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit" })
    : undefined;

  // National 3y KPI = median of the SECOND-HAND changes across cities
  // (already bounded + n≥10-gated inside loadSecondhandChanges).
  const sh3all = (await loadSecondhandChanges(3)).map((c) => c.pct).sort((a, b) => a - b);
  const median3y = sh3all.length
    ? (sh3all[Math.floor((sh3all.length - 1) / 2)] + sh3all[Math.ceil((sh3all.length - 1) / 2)]) / 2
    : null;
  // With the bounded window slide, cities can legitimately differ in their
  // start year — the label discloses the RANGE instead of pretending the
  // first city's window speaks for all of them.
  const window3yLabel = (() => {
    if (!top3yGain.length) return null;
    const froms = top3yGain.map((c) => c.fromY);
    const lo = Math.min(...froms), hi = Math.max(...froms);
    const to = top3yGain[0].toY;
    return lo === hi ? fromToText(lo, to) : fromToText(`${lo}–${hi}`, to);
  })();

  // The three cards that now open the page. Loaded here rather than inside the
  // component so the section is server-rendered into the first paint — it is
  // the LCP element, and a client fetch would draw it after the fold is judged.
  const hotCities = await loadHotCities(3);

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
      select: { city_name: true, unsold_inventory_2025: true, avg_sales_3y: true },
    }),
  ]);

  // Inventory digestion: how many YEARS the unsold stock would take to clear
  // at the city's average sales pace of the last 3 years. The intuitive read
  // of "8,000 unsold units" depends entirely on whether the city sells 4,000
  // a year or 400.
  const yearsToSell = (inv: number | null, avg3y: number | null): string | null => {
    if (!inv || !avg3y || avg3y <= 0) return null;
    const years = inv / avg3y;
    return years >= 10 ? "10+" : years.toFixed(1);
  };

  // Promoted out of the rankings grid: the operator wants it read right after
  // the price-change table, not four cards further down the page.
  const unsoldRanking =
    {
      title: "מלאי דירות לא מכורות",
      icon: "building",
      detailHref: "/rankings/highest-inventory",
      items: highestInventory.map((c, i) => {
        const yts = yearsToSell(c.unsold_inventory_2025, c.avg_sales_3y);
        return {
          rank: i + 1,
          city: c.city_name,
          value: formatNumber(c.unsold_inventory_2025),
          // separate visual channel for the pace metric (operator spec 8/2026:
          // the two numbers blended into one unreadable string)
          badge: yts ? `${yts} שנים למכירה` : undefined,
          href: `/city/${encodeURIComponent(c.city_name)}`,
        };
      }),
    };

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
  ];

  return (
    <main className="min-h-screen page-wrap-wide pb-8 pt-2 md:py-8">
      {/* ── HERO ────────────────────────────────────────────────────────────
          THREE HOT CITIES, THEN THE SEARCH BOX — both on the first screen with
          no scrolling (operator requirement, 8/2026). That inverts the old
          search-first hero, and the reason is that a search box only helps a
          visitor who already knows which city they want; whoever does still
          finds it immediately below, on the same screen.

          EVERYTHING ABOVE THEM WAS CUT TO THE BONE, because the requirement is
          a pixel budget and the old header spent it on nothing. On a phone it
          opened with 56px of pure air (main's py-8 plus the header's pt-6)
          under a sticky 56px nav, then a status pill, then a heading that
          repeats the wordmark already visible in that nav, then a tagline that
          wrapped to two lines — roughly 280px before the search box began.
          The pill and the full tagline are desktop-only now, the heading is
          smaller, and the tagline is short enough to hold one line.

          relative z-30: animate-fade-up leaves a forwards-fill transform on
          this header, creating a stacking context — without an explicit z the
          search dropdown (z-[100] INSIDE that context) painted UNDER the
          hero-kpi cards that follow in DOM order. */}
      <header className="animate-fade-up relative z-30 pb-1 pt-1 md:pb-2 md:pt-8">
        {/* Hidden on phones: it costs ~48px and says what the tagline below
            already says. On a wide screen the pixels are free. */}
        <div className="mb-5 hidden flex-wrap items-center justify-center gap-2 md:flex">
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-500 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-indigo-600" />
            </span>
            <span className="t-label text-indigo-700">מאגר עסקאות עצמאי · מבוסס נתוני אמת</span>
          </span>
        </div>

        <div className="text-center">
          {/* t-display keeps the weight, leading and tracking; the two size
              utilities override its font-size (utilities layer beats
              components), so this is one heading with two sizes and not two. */}
          <h1 className="t-display text-xl md:text-[2.75rem]">
            <span className="text-gradient-hero">קרנף אנליסט</span>
          </h1>
          {/* One line on a phone — the long version wrapped to two and added a
              line of leading between them for no information gained. */}
          <p className="mx-auto mt-0.5 max-w-lg text-slate-500 md:mt-3" style={{ lineHeight: 1.4 }}>
            <span className="text-xs md:hidden">ניתוח שוק הנדל״ן בישראל</span>
            <span className="hidden md:inline" style={{ fontSize: 16, lineHeight: 1.55 }}>
              מחקר וניתוח שוק הנדל״ן בישראל — מבוסס עסקאות אמת
            </span>
          </p>
        </div>

        <HotCities data={hotCities} />

        {/* Directly under the cards, still above the fold. */}
        <div className="mx-auto mt-3 max-w-2xl md:mt-5">
          <HomeSearch cities={allCities} />
        </div>
        <p className="mt-1.5 text-center text-slate-400" style={{ fontSize: 12 }}>
          <span className="hidden md:inline">חפש עיר וקבל מחירים, מגמות והשוואות · </span>
          {cityCount} ערים במאגר
        </p>

        {/* PHONE ONLY: the three headline figures as one strip, directly under
            the search box (operator spec 8/2026). As three hero cards they were
            ~480px of vertical scrolling on a phone before anything the reader
            came for. Same numbers, same links, ~40px. The cards themselves are
            unchanged from sm: up — see <HeroKpiCards> below. */}
        <HeroKpiStrip
          className="mt-2"
          totalDeals={totalDeals}
          deals12m={deals12m}
          median3y={median3y}
          medianCities={sh3all.length}
          window3yLabel={window3yLabel}
          dealsUpdatedLabel={dealsUpdatedLabel}
        />
      </header>

      {/* Everything below the header is ordered from the dashboard
          (🧩 סדר אלמנטים). The default is the order written here in
          lib/pageSections; a section added later is appended rather than
          dropped, so a stale saved order can never hide it. */}
      <OrderedSections
        page="home"
        order={sectionOrder}
        nodes={{
          "hero-kpis": (
            <HeroKpiCards
              className="mt-8"
              totalDeals={totalDeals}
              deals12m={deals12m}
              median3y={median3y}
              medianCities={sh3all.length}
              window3yLabel={window3yLabel}
              dealsUpdatedLabel={dealsUpdatedLabel}
            />
          ),
          "price-gains": (
            <div className="mt-6">
              <PriceGainsRankingCard series={gainSeries} minYear={gainMinYear} maxYear={gainMaxYear} partialYear={gainPartialYear} subsidized={subsidizedByCity} />
            </div>
          ),
          "unsold-inventory": (
            <div className="mt-4">
              <RankingCard
                title={unsoldRanking.title}
                items={unsoldRanking.items}
                icon={unsoldRanking.icon}
                detailHref={unsoldRanking.detailHref}
              />
            </div>
          ),
          rankings: (
            <section className="stack mt-14">
              <div className="section-header mb-6">
                <div className="section-header-icon"><Icon name="trophy" size="1em" /></div>
                <div>
                  <h2 className="text-2xl font-black text-slate-900">דירוגים מובילים</h2>
                  <p className="text-xs text-slate-500 mt-0.5">חמש הערים המובילות בכל קטגוריה</p>
                </div>
              </div>
              <div className="card-grid card-grid-auto grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                {rankings.map((ranking) => (
                  <RankingCard
                    key={ranking.title}
                    title={ranking.title}
                    items={ranking.items}
                    icon={ranking.icon}
                    detailHref={ranking.detailHref}
                  />
                ))}
              </div>
            </section>
          ),
          "market-insights": <MarketInsightsSection insights={marketInsights} />,
          "cbs-sales": cbsSales ? (
            <section className="mt-14">
              <CbsSalesChart data={cbsSales} />
            </section>
          ) : null,
          "recent-reports": (
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
          ),
        }}
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
