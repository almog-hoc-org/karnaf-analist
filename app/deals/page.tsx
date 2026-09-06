import { prisma } from "@/lib/db";
import FeedbackBanner from "@/components/FeedbackBanner";
import { CREDIT_RULES } from "@/lib/credits";
import { ALIAS_NAMES } from "@/lib/cityAliases";
import { listDeals, listTrackedCities } from "@/lib/appDb";
import { computeStreetComp } from "@/lib/streetComps";
import type { StreetComp } from "@/lib/compTypes";
import { loadCityTransactionPrices } from "@/lib/cityTransactionPrices";
import { loadSecondhandChanges } from "@/lib/cityChangeMetrics";
import DealsManager from "@/components/DealsManager";
import { requireWorkspaceId } from "@/lib/auth";
import { getRuleNum } from "@/lib/systemRules";
import Icon from "@/components/Icon";
import { fromToText } from "@/components/FromTo";

export const metadata = { title: 'ניהול והשוואת עסקאות | קרנף אנליסט' };
export const dynamic = "force-dynamic";

/** Summary card data for a tracked city — all from the independent repository. */
export interface TrackedCitySummary {
  city: string;
  medianShSqm: number | null;
  avgShSqm: number | null;
  priceYear: number | null;
  chg3y: number | null;
  chg3yWindow: string | null;
  deals12m: number;
  activeNeighborhoods: number;
  totalDeals: number;
}

export default async function DealsPage() {
  // Personal workspace — anonymous visitors are redirected to /login and never
  // reach the queries below. Every other page on the site stays open.
  const userId = requireWorkspaceId("/deals");

  const [cities, tracked, deals, txPrices, sh3] = await Promise.all([
    prisma.city.findMany({ where: { city_name: { notIn: ALIAS_NAMES } }, select: { city_name: true }, orderBy: { population_2026: "desc" } }),
    Promise.resolve(listTrackedCities(userId)),
    Promise.resolve(listDeals(userId)),
    loadCityTransactionPrices(),
    loadSecondhandChanges(3),
  ]);
  const sh3Map = new Map(sh3.map((c) => [c.city_name, c]));

  // summaries for tracked cities
  const summaries: TrackedCitySummary[] = await Promise.all(
    tracked.map(async (city) => {
      const p = txPrices.get(city);
      const ch = sh3Map.get(city);
      const [act] = await prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*) n, COUNT(DISTINCT neighborhood) nh FROM nadlan_transactions
         WHERE city_name=? AND COALESCE(excluded,0)=0 AND deal_date >= date('now','-12 months')`, city
      ).catch(() => [{ n: 0, nh: 0 }]);
      return {
        city,
        medianShSqm: p?.medianShSqm ?? null,
        avgShSqm: p?.avgShSqm ?? null,
        priceYear: p?.priceYear ?? null,
        chg3y: ch?.pct ?? null,
        chg3yWindow: ch ? fromToText(ch.fromY, ch.toY) : null,
        deals12m: Number(act?.n ?? 0),
        activeNeighborhoods: Number(act?.nh ?? 0),
        totalDeals: p?.totalDeals ?? 0,
      };
    })
  );

  // street comps per deal (server-computed against real transactions)
  const comps: Record<number, StreetComp> = {};
  await Promise.all(
    deals.map(async (d) => {
      comps[d.id] = await computeStreetComp(d.city, d.street, d.neighborhood, d.rooms, d.size, d.house_num);
    })
  );

  return (
    <main className="min-h-screen page-wrap-wide py-8">
      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-3xl md:text-4xl font-black tracking-tight">
            <span className="text-gradient-hero">ניהול והשוואת עסקאות</span>
          </h1>
          {/* CourseBanner removed from the header (operator spec 8/2026):
              it sat ABOVE the user's own workspace — violating the
              component's own placement rule — and the global footer already
              carries the compact pitch on this page. */}
        </div>
        <p className="mt-2 max-w-2xl text-sm text-slate-500 leading-relaxed">
          עקוב אחרי דירות בתהליך החיפוש: הזן עסקה, קבל השוואה מיידית מול עסקאות אמת ברחוב ובשכונה,
          נהל סטטוס, משימות וקישורים — הכל במקום אחד. <Icon name="source-own" size="1em" /> ההשוואות מבוססות מאגר העסקאות העצמאי.
        </p>
        <p className="mt-1.5 text-xs font-semibold text-emerald-700">
          <Icon name="check" size="1em" /> העסקאות והסטטוסים נשמרים בחשבונך — זמינים מכל מכשיר בכל כניסה
        </p>
      </header>
      <DealsManager
        allCities={cities.map((c) => c.city_name)}
        tracked={summaries}
        deals={deals}
        comps={comps}
        modernMinYear={getRuleNum("modern_min_year", 2005)}
      />
      {/* feedback invitation beside the workspace (operator spec 8/2026) */}
      <div className="mt-8">
        <FeedbackBanner bonus={CREDIT_RULES.feedbackBonus()} />
      </div>
    </main>
  );
}
