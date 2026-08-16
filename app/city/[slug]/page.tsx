import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { canonicalCityName } from "@/lib/cityAliases";
import { cityClassificationRate } from "@/lib/classificationRate";
import { cityUrbanRenewalProjects } from "@/lib/urbanRenewal";
import { subsidizedWindowNote, citySubsidizedYears } from "@/lib/subsidizedYears";
import UrbanRenewalSection from "@/components/UrbanRenewalSection";
import NeighborhoodPrices from "@/components/NeighborhoodPrices";
import { neighborhoodSummary, neighborhoodMinDeals } from "@/lib/neighborhoods";
import { getRuleNum } from "@/lib/systemRules";
import { getCityInsights } from "@/lib/insights";
import { computeCityGap, describeSupplySource } from "@/lib/gap-analysis";
import SalesChart from "@/components/SalesChart";
import PermitsChart from "@/components/PermitsChart";
import PopulationChart from "@/components/PopulationChart";
import PriceTrendChart from "@/components/PriceTrendChart";
import CorrelationTable from "@/components/CorrelationTable";
import CityDealsComparison from "@/components/CityDealsComparison";
import CityConstructionMiniChart from "@/components/CityConstructionMiniChart";
import ScatteredFactsSection from "@/components/ScatteredFactsSection";
import { getCityScatteredData } from "@/lib/scatteredFacts";
import NumberCaption from "@/components/NumberCaption";
import { loadCityPriceChanges } from "@/lib/price-changes";
import { loadCityTransactionPrices } from "@/lib/cityTransactionPrices";
import NewVsSecondhandPanel from "@/components/NewVsSecondhandPanel";
import PopulationBySource from "@/components/PopulationBySource";
import { loadCityPopulationEstimates } from "@/lib/population-sources";
import PriceChangeSection from "@/components/PriceChangeSection";
import RoomPriceSummary from "@/components/RoomPriceSummary";
import { loadCityGraphSeries, loadCityDeals, loadDealCountCube, loadCityCleaningCounts } from "@/lib/nadlanTransactionSeries";
import Link from "next/link";
import SourceBadge from "@/components/SourceBadge";
import CoverageNotice from "@/components/CoverageNotice";
import { assessCoverage } from "@/lib/coverage";
import Icon from "@/components/Icon";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { getRuleBool, getRuleText } from "@/lib/systemRules";
import { balance, isCityUnlocked, unlockCity, ensureStarterCredits, CREDIT_RULES } from "@/lib/credits";
import { whatsappShareUrl } from "@/lib/share";
import CityWall from "@/components/CityWall";
import CityPublicSummary from "@/components/CityPublicSummary";
import CityShareButton from "@/components/CityShareButton";
import TrackCityButton from "@/components/TrackCityButton";
import { isCityTracked, setCityTracked } from "@/lib/appDb";

interface PageProps {
  params: { slug: string };
  /** only ?ref= is read — a friend's referral code arriving via a share link */
  searchParams?: { ref?: string };
}

/**
 * Default price-change window shown on first paint.
 *
 * This used to come from `?window=` on the request. Reading searchParams is a
 * Next.js Dynamic API, so it forced this page — the one a public audience
 * actually lands on — to re-render per request, ~25 DB queries each time,
 * including a full GROUP BY over every transaction in the city.
 *
 * It bought nothing: the value only seeded useState in PriceChangePanel, and
 * both windows' data ship together, so the toggle never needed the server.
 */
const DEFAULT_PRICE_WINDOW = "5y" as const;

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

/**
 * REMOVED, deliberately — it could not have worked, and it is what turned a
 * framework misconfiguration into a 500 on every city.
 *
 * Two independent reasons:
 *
 * 1. It returned encodeURIComponent(city_name). Next encodes params itself, so
 *    Hebrew names were encoded TWICE: the build prerendered /city/%25D7%2597…
 *    while a visitor asks for /city/%D7%97%D7%99%D7%A4%D7%94. Not one city ever
 *    matched its own prerendered page, so all 165 fell through to an on-demand
 *    render — the exact path that then failed. Routes with ASCII slugs
 *    (/sources/[id], /stats/[metric]) were unaffected, which is why only the
 *    city pages broke.
 *
 * 2. Even with the encoding fixed, this page CANNOT be static: the root layout
 *    reads cookies on every render, for the admin control and the signed-in
 *    nav. A prerendered city page would serve one visitor's nav state to
 *    everyone.
 *
 * So the page is dynamic, like the home page already is. Expensive loaders are
 * cached in lib/cache.ts, which is where that cost belongs — a cache that can
 * be invalidated, not a prerender that bakes in an auth state.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps) {
  const cityName = decodeURIComponent(params.slug);
  // The title IS the query people type. "נתניה | קרנף אנליסט" answered nothing;
  // this one matches the search and the page's own h1.
  const title = `מחירי דירות ב${cityName} — מחיר למ״ר, עסקאות ומגמות`;
  const description = `כמה עולה דירה ב${cityName}? מחיר ממוצע למ״ר, שינוי מחירים לאורך זמן, מספר עסקאות, היתרי בנייה ואוכלוסייה — מעסקאות אמת שדווחו לרשות המסים.`;
  const path = `/city/${encodeURIComponent(cityName)}`;
  return {
    title,
    description,
    // Canonical: the alias URLs redirect here, and shares carry ?ref= codes —
    // both would otherwise look like separate pages with the same content.
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      type: "article",
      locale: "he_IL",
      url: path, // resolved against metadataBase in the root layout
    },
  };
}

export default async function CityPage({ params, searchParams }: PageProps) {
  const cityName = decodeURIComponent(params.slug);
  // An alias URL ("מכבים רעות") lands on the canonical city instead of an
  // empty duplicate page — old shared links keep working after unification.
  const canonical = canonicalCityName(cityName);
  if (canonical !== cityName) redirect(`/city/${encodeURIComponent(canonical)}`);
  const activeWindow: "3y" | "5y" = DEFAULT_PRICE_WINDOW;
  // String() first — a repeated ?ref=&ref= arrives as an ARRAY, and calling
  // .toUpperCase() on it 500'd the whole page, demo city included.
  const refRaw = String(searchParams?.ref ?? "").toUpperCase();
  const refCode = /^[A-Z2-9]{4,16}$/.test(refRaw) ? refRaw : "";

  // ── access gate — BEFORE the ~25 queries below; a walled visitor costs one ──
  // The wall model (7.8): the demo city is open to everyone; every other city
  // page needs an account, and opening one spends a credit for unlock_days.
  // paywall_on is the kill switch — off restores the fully-open site.
  const paywallOn = getRuleBool("paywall_on", true);
  const demoCity = getRuleText("demo_city", "חיפה");
  const viewer = getCurrentUser();
  if (paywallOn && cityName !== demoCity) {
    const cityExists = await prisma.city.findUnique({ where: { city_name: cityName }, select: { city_name: true } });
    if (cityExists) {
      if (!viewer) {
        // PUBLIC SUMMARY + wall. The wall used to be the entire response, which
        // meant Google indexed 167 identical signup screens instead of the
        // city data this site exists to publish. The free half below carries
        // real numbers (price, trend, sample, population); everything the wall
        // protects — the studio, rooms, neighbourhoods, deal drill-down,
        // comparisons — stays behind it.
        const [pubPrices, pubChanges, pubCity] = await Promise.all([
          loadCityTransactionPrices(),
          loadCityPriceChanges(cityName),
          prisma.city.findUnique({ where: { city_name: cityName }, select: { population_2026: true, population_2024: true } }),
        ]);
        const pp = pubPrices.get(cityName);
        // National benchmark from the map already in hand — the median of every
        // city's ₪/m², so "above/below the national average" costs no query.
        const allSqm = [...pubPrices.values()]
          .map((v) => v.avgAllSqm ?? v.medianAllSqm)
          .filter((v): v is number => v != null)
          .sort((a, b) => a - b);
        const nationalSqm = allSqm.length ? allSqm[Math.floor(allSqm.length / 2)] : null;
        const win = pubChanges?.change3y ?? pubChanges?.change5y ?? null;
        return (
          <CityPublicSummary
            data={{
              cityName,
              sqm: pp?.avgAllSqm ?? pp?.medianAllSqm ?? null,
              priceYear: pp?.priceYear ?? null,
              n: pp?.nPriceYear ?? null,
              changePct: win?.pct ?? null,
              changeFromYear: win?.fromY ?? null,
              changeToYear: win?.toY ?? null,
              population: pubCity?.population_2026 ?? pubCity?.population_2024 ?? null,
              nationalSqm,
            }}
          >
            <CityWall cityName={cityName} state="anonymous" demoCity={demoCity} refCode={refCode} signupBonus={CREDIT_RULES.signupBonus()} />
          </CityPublicSummary>
        );
      }
      if (!isCityUnlocked(viewer.id, cityName)) {
        // settle all due grants BEFORE deciding which wall to show — a user
        // owed the signup bonus (pre-credits account) or the monthly grant
        // must not be told "insufficient" by the gate that owes them credits
        ensureStarterCredits(viewer.id);
        const bal = balance(viewer.id);
        const cost = CREDIT_RULES.cityUnlockCost();
        if (bal < cost) {
          return (
            <CityWall
              cityName={cityName}
              state="insufficient"
              balanceCredits={bal}
              costCredits={cost}
              referralBonus={CREDIT_RULES.referralBonus()}
              feedbackBonus={CREDIT_RULES.feedbackBonus()}
              monthlyGrant={CREDIT_RULES.monthlyFreeGrant()}
              shareUrl={whatsappShareUrl(`/city/${encodeURIComponent(cityName)}`, viewer.id)}
            />
          );
        }
        // Unlock happens on POST only — a GET that spends credits would let
        // the browser's link prefetcher drain the balance.
        const unlockAction = async () => {
          "use server";
          const u = getCurrentUser();
          if (!u) return;
          unlockCity(u.id, cityName);
          revalidatePath(`/city/${params.slug}`);
        };
        return (
          <CityWall
            cityName={cityName}
            state="locked"
            balanceCredits={bal}
            costCredits={cost}
            unlockDays={CREDIT_RULES.unlockDays()}
            unlockAction={unlockAction}
          />
        );
      }
    }
    // a nonexistent city falls through to the regular "not found" screen below
  }

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
  // parallel — these were sequential and dominated page latency
  const [cityPriceChanges, cityPopulationEstimates, cityGraphData, cityDeals, dealCounts, cleaning, classRate] = await Promise.all([
    loadCityPriceChanges(cityName),
    loadCityPopulationEstimates(cityName),
    loadCityGraphSeries(cityName),
    loadCityDeals(cityName),
    loadDealCountCube(cityName),
    loadCityCleaningCounts(cityName),
    cityClassificationRate(cityName),
  ]);
  const urbanRenewalProjects = await cityUrbanRenewalProjects(cityName);
  const subsidizedYears = await citySubsidizedYears(cityName);
  // Second-hand is the right lens for an intra-city comparison: new-build
  // supply is concentrated in whichever neighbourhood happens to be under
  // construction, so an "all deals" table would rank the building site first.
  const neighborhoods = await neighborhoodSummary(cityName, { scope: "secondhand", years: 3 });

  if (!city) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="text-center space-y-4">
          <p className="text-5xl mb-4"><Icon name="search" size="1em" /></p>
          <h1 className="text-2xl font-bold text-slate-900">העיר לא נמצאה</h1>
          <p className="text-slate-500">
            לא נמצאו נתונים עבור &ldquo;{cityName}&rdquo;
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-700 hover:border-indigo-300 hover:text-indigo-700 transition-all"
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
      ? { key: "price", text: insights.priceChange, icon: "trend-up", color: "border-slate-200 bg-slate-50" }
      : null,
    insights.supplyBalance
      ? { key: "supply", text: insights.supplyBalance, icon: "scale", color: "border-slate-200 bg-slate-50" }
      : null,
    insights.inventoryClearance
      ? { key: "inventory", text: insights.inventoryClearance, icon: "building", color: "border-slate-200 bg-slate-50" }
      : null,
    insights.peoplePerApartment
      ? { key: "people", text: insights.peoplePerApartment, icon: "users", color: "border-slate-200 bg-slate-50" }
      : null,
    insights.buildingPermitsTrend
      ? { key: "permits", text: insights.buildingPermitsTrend, icon: "construction", color: "border-slate-200 bg-slate-50" }
      : null,
    insights.populationTrend
      ? { key: "population", text: insights.populationTrend, icon: "chart", color: "border-slate-200 bg-slate-50" }
      : null,
  ].filter(Boolean) as { key: string; text: string; icon: string; color: string }[];

  // Price KPIs come from the SAME engine as the price-change panel below
  // (loadCityPriceChanges): annual averages of all quarters, end capped at
  // ref_year, sliding start disclosed via fromY. The old inline version here
  // compared earliest-Q1-ever vs latest-Q1 — no year cap, no sample floor —
  // so this strip and the panel under it showed two different "median price
  // change" numbers for the same city on the same page.
  const headlineWindow = cityPriceChanges?.change5y ?? cityPriceChanges?.change3y ?? null;
  const subsidizedNote = await subsidizedWindowNote(cityName, headlineWindow?.fromY, headlineWindow?.toY);

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
    <main className="min-h-screen page-wrap py-8">
      {/* ── Header ─────────────────────────────────────────────── */}
      {/* Header, COMPACT (operator spec 8/2026): the old stack — English
          eyebrow, mb-10 header, then a three-sentence trust banner with mb-8 —
          pushed the first number below the fold. The eyebrow is gone (it said
          nothing in the site's language), population sits beside the name, and
          the trust line is one sentence on the same block. */}
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 tracking-tight">
            {city.city_name}
          </h1>
          {city.population_2026 && (
            <span className="text-slate-500 text-base">
              {formatNumber(city.population_2026)} תושבים
            </span>
          )}
          {city.population_growth_pct !== null && (
            <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
              (city.population_growth_pct ?? 0) >= 0
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-600"
            }`}>
              {(city.population_growth_pct ?? 0) >= 0 ? '+' : ''}{city.population_growth_pct?.toFixed(1)}% גידול
            </span>
          )}
          <CityShareButton href={whatsappShareUrl(`/city/${encodeURIComponent(city.city_name)}`, viewer?.id, `כדאי שתראה את הנתונים על ${city.city_name} — עסקאות אמת, מחירים ומגמות:`)} />
          <TrackCityButton
            cityName={city.city_name}
            initiallyTracked={viewer ? isCityTracked(viewer.id, city.city_name) : false}
            signedIn={!!viewer}
            action={async (c: string, next: boolean) => {
              "use server";
              // Re-read the session inside the action: the closure's `viewer` is
              // from render time, and an action must never trust a value the
              // client could have been served before signing out.
              const u = getCurrentUser();
              if (!u) return false;
              return setCityTracked(u.id, c, next);
            }}
          />
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <SourceBadge kind="internal" />
          <p className="text-2xs text-slate-500">
            עסקאות אמת שנאספו בלתי-תלוי מרשות המסים · יד-שנייה = {getRuleNum("secondhand_min_age", 4)}+ שנים משנת הבנייה · מקורות חיצוניים מסומנים <Icon name="source-official" size="1em" />
          </p>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════
          SECTION 1: PRICES
          ═══════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="section-header">
          <div className="section-header-icon">₪</div>
          <div>
            <h2 className="flex items-center gap-2 flex-wrap">מחירים <SourceBadge kind="external" name="גוב-נדלן" /></h2>
            <p>מחיר חציוני לדירה | מקור: nadlan.gov.il</p>
          </div>
        </div>
        {headlineWindow ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiTile
                label={`מחיר חציוני ${headlineWindow.fromY}`}
                value={formatPrice(headlineWindow.fromAvg)}
                accent="zinc"
              />
              <KpiTile
                label={`מחיר חציוני ${headlineWindow.toY}`}
                value={formatPrice(headlineWindow.toAvg)}
                accent="cyan"
              />
              <KpiTile
                label={`שינוי מחיר ${headlineWindow.fromY}–${headlineWindow.toY}`}
                value={`${headlineWindow.pct >= 0 ? '+' : ''}${headlineWindow.pct.toFixed(1)}%`}
                accent={headlineWindow.pct >= 0 ? "emerald" : "red"}
                valueClassName={headlineWindow.pct >= 0 ? "text-emerald-700" : "text-red-600"}
              />
              <KpiTile
                label="בסיס הנתון"
                value={`${headlineWindow.fromQuarters + headlineWindow.toQuarters} רבעונים`}
                accent="purple"
              />
            </div>
            {headlineWindow.thin && (
              <p className="mt-2 text-2xs font-semibold text-amber-600">
                ⚠ מדגם דל — אחת משנות הקצה נשענת על רבעון בודד או שהחלון הוזז בגלל שנים חסרות; קרא את המספר בזהירות
              </p>
            )}
            {/* A window anchored on a מחיר-למשתכן year measures a change of
                programme, not a change of market — say so where the number is,
                not in a footnote nobody reaches. */}
            {subsidizedNote && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-2xs leading-relaxed text-amber-800">
                ⚠ {subsidizedNote}
              </p>
            )}
          </>
        ) : (
          <div className="glass-card p-4 md:p-6 text-center text-slate-500 text-sm">
            אין מספיק נתוני מחיר רציפים מ-nadlan.gov.il להצגת מגמה אמינה
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
              <div className="section-header-icon"><Icon name="building" size="1em" /></div>
              <div>
                <h2 className="flex items-center gap-2 flex-wrap">מצב שוק חי <SourceBadge kind="external" name="מדדי לוחות" /></h2>
                <p>מודעות פעילות, ימים בשוק וסוג שוק — מדדי היצע וביקוש עדכניים</p>
              </div>
            </div>
            <Link
              href="/stats/yad2-market-data"
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-50 border border-indigo-200 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
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
              color="text-slate-900"
            />
            <Yad2Card
              label="נכסים יד שנייה"
              value={formatNumber(yad2Data.secondhand_properties)}
              yoy={yad2Data.secondhand_yoy}
              color="text-slate-900"
            />
            <Yad2Card
              label="ימים ממוצע למודעה"
              value={formatNumber(yad2Data.avg_days_on_market)}
              yoy={yad2Data.days_yoy}
              color="text-slate-900"
              invertYoy
            />
            <Yad2Card
              label="קונים שצפו"
              value={formatNumber(yad2Data.buyers_count)}
              yoy={yad2Data.buyers_yoy}
              color="text-slate-900"
            />
          </div>

          <div className="mt-3 glass-card p-4 flex items-center gap-3">
            <span className="text-xl">
              <Icon name={yad2Data.market_type === 'sellers' ? "flame" : yad2Data.market_type === 'buyers' ? "snow" : "scale"} size="1em" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">
                {yad2Data.market_type === 'sellers' ? 'שוק של מוכרים' : yad2Data.market_type === 'buyers' ? 'שוק של קונים' : 'שוק מאוזן'}
              </p>
              <p className="text-2xs text-slate-500">על בסיס יחס קונים-מוכרים וזמן חשיפה</p>
            </div>
            <Link
              href="/stats/yad2-market-data"
              className="md:hidden text-xs text-indigo-700 hover:text-indigo-900 font-semibold"
            >
              כל הערים ←
            </Link>
          </div>

          {/* Household data from yadata (more current than CBS 2022) */}
          {(yad2Data.households || yad2Data.avg_household_size) && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              {yad2Data.households && (
                <KpiTile
                  label="משקי בית (מדדי לוחות)"
                  value={formatNumber(yad2Data.households)}
                  accent="purple"
                />
              )}
              {yad2Data.avg_household_size && (
                <KpiTile
                  label="נפשות למשק בית (מדדי לוחות)"
                  value={formatNumber(yad2Data.avg_household_size, 1)}
                  accent="amber"
                />
              )}
            </div>
          )}

          {/* מדד התפשרות — מוצמד לנתוני מצב-שוק יד-2 (Yad2), מוצג לכל עיר.
              (כרטיס "מד השוק" הוסר לבקשת המשתמש.) */}
          {yad2Data && (yad2Data.compromise_index != null || yad2Data.market_type || yad2Data.avg_days_on_market != null) ? (
            <div className="mt-3">
              <div className="rounded-2xl bg-indigo-50/40 border border-indigo-100 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xs font-bold text-indigo-700 uppercase tracking-wide">
                      מדד התפשרות — מצב שוק יד-2
                    </p>
                    <p className="text-2xl font-black tabular-nums text-slate-900 mt-1">
                      {yad2Data.compromise_index != null
                        ? `${yad2Data.compromise_index >= 0 ? "+" : ""}${formatNumber(yad2Data.compromise_index, 1)}%`
                        : yad2Data.market_type === "sellers" ? "שוק מוכרים"
                        : yad2Data.market_type === "buyers" ? "שוק קונים"
                        : yad2Data.market_type ? "שוק מאוזן" : "—"}
                    </p>
                  </div>
                  <span className="text-2xl"><Icon name="trend-down" size="1em" /></span>
                </div>
                <p className="text-2xs text-slate-500 mt-1">
                  {yad2Data.avg_days_on_market != null ? `${formatNumber(yad2Data.avg_days_on_market, 0)} ימים ממוצע בשוק · ` : ""}
                  מבוסס על נתוני מצב-שוק יד-2 (Yad2) — חיובי/שוק-מוכרים = פחות התפשרות
                </p>
              </div>
            </div>
          ) : null}
        </section>
      )}





      <div className="section-divider" />

      {/* ═══════════════════════════════════════════════════════════
          PRICE-CHANGE SECTION (boxed) — YoY ₪/sqm graph + matrix + median
          ═══════════════════════════════════════════════════════════ */}
      {/* Says how much of the decade is actually behind the chart below.
          Derived from the series already loaded — no extra query, and no city
          named in code, so a locality that fills in loses its notice by itself. */}
      <CoverageNotice
        coverage={assessCoverage(cityGraphData, getRuleNum("min_deals_per_year", 10))}
        cityName={city.city_name}
      />
      <PriceChangeSection
        priceChanges={cityPriceChanges}
        graphData={cityGraphData}
        deals={cityDeals}
        dealCounts={dealCounts}
        cleaning={cleaning}
        initialWindow={activeWindow}
        cityName={city.city_name}
        secondhandMinAge={getRuleNum("secondhand_min_age", 4)}
        modernMinYear={getRuleNum("modern_min_year", 2005)}
        classificationRate={classRate?.rate ?? null}
        subsidizedYears={subsidizedYears}
        minSample={getRuleNum("min_deals_per_year", 10)}
      />

      {/* Room-size price rubric (operator spec 8/2026) — the numbers people
          actually quote, pulled out of the chart into plain text, right under
          the price graphs it summarizes. */}
      {cityGraphData && (
        <RoomPriceSummary data={cityGraphData} classificationRate={classRate?.rate ?? null} />
      )}

      {/* ═══════════════════════════════════════════════════════════
          NEW (CONTRACTOR) vs SECOND-HAND — CBS 047/2026 hard numbers
          ═══════════════════════════════════════════════════════════ */}
      <NewVsSecondhandPanel
        cityName={city.city_name}
        yad2SecondhandListings={yad2Data?.secondhand_properties ?? undefined}
        yad2SecondhandYoy={yad2Data?.secondhand_yoy ?? undefined}
      />

      {/* ═══════════════════════════════════════════════════════════
          POPULATION BY SOURCE — multi-source comparison
          ═══════════════════════════════════════════════════════════ */}
      <PopulationBySource data={cityPopulationEstimates} cityName={city.city_name} />

      {/* (Sub-area price matrix now lives inside <PriceChangeSection> above) */}

      <div className="section-divider" />

      {/* (Yad2 section was moved to the top — right after the city header) */}

      {/* ═══════════════════════════════════════════════════════════
          SECTION 5: CHARTS
          ═══════════════════════════════════════════════════════════ */}

      {/* Population by Year */}
      {populationByYear.length > 2 && (
        <section className="mb-10">
          <div className="glass-card p-4 md:p-6">
            <div className="section-header mb-4">
              <div className="section-header-icon"><Icon name="chart" size="1em" /></div>
              <div className="flex-1">
                <h2 className="flex items-center gap-2 flex-wrap">מגמת אוכלוסייה <SourceBadge kind="external" name='למ"ס' /></h2>
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
          <div className="glass-card p-4 md:p-6">
            <div className="section-header mb-4">
              <div className="section-header-icon"><Icon name="money" size="1em" /></div>
              <div className="flex-1">
                <h2 className="flex items-center gap-2 flex-wrap">מגמת מחירים חציוניים <SourceBadge kind="external" name="גוב-נדלן" /></h2>
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
            {headlineWindow && (
              <p className="text-xs text-slate-500 mt-2 text-center">
                שינוי מחיר חציוני {headlineWindow.fromY}–{headlineWindow.toY}:{' '}
                <span className={headlineWindow.pct >= 0 ? 'text-emerald-700' : 'text-red-600'}>
                  {headlineWindow.pct >= 0 ? '+' : ''}{headlineWindow.pct.toFixed(1)}%
                </span>
                {' '}(₪{formatNumber(headlineWindow.fromAvg)} → ₪{formatNumber(headlineWindow.toAvg)})
                {headlineWindow.thin ? ' · מדגם דל' : ''}
              </p>
            )}
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
          <div className="glass-card p-4 md:p-6">
            <div className="section-header mb-4">
              <div className="section-header-icon"><Icon name="construction" size="1em" /></div>
              <div>
                <h2 className="flex items-center gap-2 flex-wrap">מכירות דירות חדשות <SourceBadge kind="external" name='למ"ס' /></h2>
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
          <div className="glass-card p-4 md:p-6">
            <div className="section-header mb-4">
              <div className="section-header-icon"><Icon name="clipboard" size="1em" /></div>
              <div className="flex-1">
                <h2 className="flex items-center gap-2 flex-wrap">היתרי בנייה לפי שנה (2016-2024) <SourceBadge kind="external" name='למ"ס' /></h2>
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
          <div className="glass-card p-4 md:p-6">
            <div className="section-header mb-4">
              <div className="section-header-icon"><Icon name="link" size="1em" /></div>
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
            <div className="section-header-icon"><Icon name="package" size="1em" /></div>
            <div>
              <h2 className="flex items-center gap-2 flex-wrap">מלאי ומכירות <SourceBadge kind="external" name='למ"ס' /></h2>
              <p>מקור: למ&quot;ס — סקר בנייה, פרסומי מכירות דירות חדשות</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="kpi-card glow-indigo">
              <p className="stat-label mb-2">מלאי לא מכור 2025</p>
              <p className="stat-value text-slate-900">{formatNumber(salesData.unsold_inventory_2025)}</p>
              <p className="text-2xs text-slate-400 mt-1">דירות</p>
            </div>
            <div className="kpi-card glow-indigo">
              <p className="stat-label mb-2">ממוצע מכירות 3 שנים</p>
              <p className="stat-value text-slate-900">{salesData.avg_sales_3y !== null ? salesData.avg_sales_3y.toFixed(0) : "—"}</p>
              <p className="text-2xs text-slate-400 mt-1">דירות לשנה</p>
            </div>
            <div className="kpi-card glow-indigo">
              <p className="stat-label mb-2">שנים לפינוי מלאי</p>
              <p className="stat-value text-slate-900">{salesData.years_to_clear_avg !== null ? salesData.years_to_clear_avg.toFixed(1) : "—"}</p>
              <p className="text-2xs text-slate-400 mt-1">שנים</p>
            </div>
          </div>
        </section>
      )}

      {/* Intra-city spread — from neighborhood_year_stats (aggregation stage) */}
      <NeighborhoodPrices
        cityName={cityName}
        rows={neighborhoods.rows}
        year={neighborhoods.year}
        citySqm={neighborhoods.citySqm}
        minDeals={neighborhoodMinDeals()}
        scopeLabel="יד שנייה"
      />

      {/* Urban Renewal — live district list when the collector has run, static snapshot otherwise */}
      <UrbanRenewalSection
        projects={urbanRenewalProjects}
        staticStatus={city.urban_renewal_status}
        staticExisting={city.urban_renewal_existing_units}
        staticProposed={city.urban_renewal_proposed_units}
      />

      {/* Insights */}
      {insightEntries.length > 0 && (
        <section className="mb-10">
          <div className="section-header">
            <div className="section-header-icon"><Icon name="idea" size="1em" /></div>
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
      {/* ═══════════════════════════════════════════════════════════
          SECTION 3: SUPPLY & DEMAND (EXPANDED)
          ═══════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="section-header">
          <div className="section-header-icon"><Icon name="scale" size="1em" /></div>
          <div>
            <h2 className="flex items-center gap-2 flex-wrap">היצע וביקוש — ניתוח מקיף <SourceBadge kind="external" name='למ"ס' /></h2>
            <p>
              חישוב מגידול אוכלוסייה לפי {ppa.toFixed(1)} נפשות/משק בית
              {gapAnalysis ? ` (מקור: ${gapAnalysis.personsPerHouseholdSource === 'yad2' ? 'מדדי לוחות' : gapAnalysis.personsPerHouseholdSource === 'census2022' ? 'מפקד 2022' : 'ממוצע ארצי'})` : ''}
              {' | '}חלון: {gapAnalysis?.windowStart ?? '—'}-{gapAnalysis?.windowEnd ?? '—'}
              {' | '}סולם היצע: גמר ← התחלות ← היתרים
            </p>
          </div>
        </div>

        {/* Supply-source provenance badge */}
        {chosenSourceMeta && (
          <div className={`mb-4 inline-flex flex-wrap min-w-0 items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold ${chosenSourceMeta.cls}`}>
            <span><Icon name="ruler" size="1em" /> בסיס חישוב הפער:</span>
            <span className="font-bold">{chosenSourceMeta.he}</span>
            <span className="text-2xs font-normal opacity-80">— {chosenSourceMeta.long}</span>
          </div>
        )}

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5 [&>*:nth-child(5)]:col-span-2 lg:[&>*:nth-child(5)]:col-span-1">
          <KpiTile
            label={`דירות נדרשות (${gapAnalysis?.windowStart ?? 2020}-${gapAnalysis?.windowEnd ?? 2024})`}
            value={formatNumber(totalRequired !== null && totalRequired > 0 ? totalRequired : city.apartments_required)}
            accent="zinc"
          />
          <KpiTile
            label={`סך היתרי בנייה (${gapAnalysis?.coverage.yearsWithPermits ?? 0} שנים)`}
            value={formatNumber(gapAnalysis?.totals.permits ?? totalPermits)}
            accent="amber"
          />
          <KpiTile
            label={`סך התחלות בנייה (${gapAnalysis?.coverage.yearsWithStarts ?? 0} שנים)`}
            value={formatNumber(totalStarts > 0 ? totalStarts : null)}
            accent="zinc"
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
                  <th className="py-3 px-4 text-center text-xs text-slate-500 font-medium">דירות נדרשות</th>
                  <th className="py-3 px-4 text-center text-xs text-slate-500 font-medium">היתרי בנייה</th>
                  <th className="py-3 px-4 text-center text-xs text-slate-500 font-medium">התחלות בנייה</th>
                  <th className="py-3 px-4 text-center text-xs text-slate-500 font-medium">גמר בנייה</th>
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
                      <td className="py-2.5 px-4 text-center text-slate-700 font-medium">
                        {formatNumber(row.required)}
                      </td>
                      <td className={`py-2.5 px-4 text-center font-medium ${row.chosenSource === 'permits' ? 'text-indigo-700 ring-1 ring-indigo-300 rounded' : 'text-slate-700'}`}>
                        {formatNumber(row.permits)}
                      </td>
                      <td className={`py-2.5 px-4 text-center font-medium ${row.chosenSource === 'starts' ? 'text-indigo-700 ring-1 ring-indigo-300 rounded' : 'text-slate-700'}`}>
                        {formatNumber(row.starts)}
                      </td>
                      <td className={`py-2.5 px-4 text-center font-medium ${row.chosenSource === 'completions' ? 'text-indigo-700 ring-1 ring-indigo-300 rounded' : 'text-slate-700'}`}>
                        {formatNumber(row.completions)}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <span className={`inline-block px-1.5 py-0.5 text-2xs font-bold rounded border ${sourceMeta.cls}`}>
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
                  <td className="py-3 px-4 text-center text-slate-700">
                    {formatNumber(totalRequired !== null && totalRequired > 0 ? totalRequired : city.apartments_required)}
                  </td>
                  <td className="py-3 px-4 text-center text-slate-700">
                    {formatNumber(gapAnalysis?.totals.permits ?? totalPermits)}
                  </td>
                  <td className="py-3 px-4 text-center text-slate-700">
                    {formatNumber(totalStarts > 0 ? totalStarts : null)}
                  </td>
                  <td className="py-3 px-4 text-center text-slate-700">
                    {formatNumber(totalCompletions > 0 ? totalCompletions : null)}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {chosenSourceMeta && (
                      <span className={`inline-block px-1.5 py-0.5 text-2xs font-bold rounded border ${chosenSourceMeta.cls}`}>
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
          <div className="px-5 py-2 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-slate-500">
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
            <p className="text-2xs text-slate-400 mt-2">
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

      {/* ═══════════════════════════════════════════════════════════
          SECTION 2: DEMOGRAPHICS
          ═══════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="section-header">
          <div className="section-header-icon"><Icon name="users" size="1em" /></div>
          <div>
            <h2 className="flex items-center gap-2 flex-wrap">דמוגרפיה ודיור <SourceBadge kind="external" name='למ"ס' /></h2>
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

      <section className="mb-10">
        <div className="section-header">
          <div className="section-header-icon"><Icon name="clipboard" size="1em" /></div>
          <div>
            <h2>כל הנתונים</h2>
          </div>
        </div>
        <div className="glass-card overflow-x-auto">
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
  // Unified palette: non-trend KPI values are neutral slate ink; only emerald/red deviate,
  // reserved for trend direction (up = green, down = red). Decorative accents → brand indigo bar.
  const accentMap: Record<AccentColor, string> = {
    cyan: "text-slate-900",
    purple: "text-slate-900",
    emerald: "text-emerald-700",
    amber: "text-slate-900",
    red: "text-red-600",
    zinc: "text-slate-900",
  };

  const glowMap: Record<AccentColor, string> = {
    cyan: "glow-indigo",
    purple: "glow-indigo",
    emerald: "kpi-accent glow-emerald",
    amber: "glow-indigo",
    red: "kpi-accent glow-red",
    zinc: "glow-indigo",
  };

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="stat-label">{label}</p>
        {href && (
          <span className="text-2xs text-slate-300 group-hover:text-slate-700 transition-colors" title="צפה בטבלה מלאה">
            ←
          </span>
        )}
      </div>
      <p className={`stat-value mt-1 ${valueClassName ?? accentMap[accent]}`}>
        {value}
      </p>
      {unit && <p className="text-2xs text-slate-400 mt-0.5">{unit}</p>}
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
    <div className="kpi-card glow-indigo">
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
