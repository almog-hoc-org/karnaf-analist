import { prisma } from "@/lib/db";
import { listDeals, listTrackedCities } from "@/lib/appDb";
import { computeStreetComp } from "@/lib/streetComps";
import type { StreetComp } from "@/lib/compTypes";
import { loadCityTransactionPrices } from "@/lib/cityTransactionPrices";
import { loadSecondhandChanges } from "@/lib/cityChangeMetrics";
import DealsManager from "@/components/DealsManager";
import { getCurrentUser, workspaceId } from "@/lib/auth";

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
  const [cities, tracked, deals, txPrices, sh3] = await Promise.all([
    prisma.city.findMany({ select: { city_name: true }, orderBy: { population_2026: "desc" } }),
    Promise.resolve(listTrackedCities(workspaceId())),
    Promise.resolve(listDeals(workspaceId())),
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
        chg3yWindow: ch ? `${ch.fromY}→${ch.toY}` : null,
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
      comps[d.id] = await computeStreetComp(d.city, d.street, d.neighborhood, d.rooms, d.size);
    })
  );

  return (
    <main className="min-h-screen page-wrap-wide py-8">
      <header className="mb-8">
        <h1 className="text-3xl md:text-4xl font-black tracking-tight">
          <span className="text-gradient-hero">ניהול והשוואת עסקאות</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500 leading-relaxed">
          עקוב אחרי דירות בתהליך החיפוש: הזן עסקה, קבל השוואה מיידית מול עסקאות אמת ברחוב ובשכונה,
          נהל סטטוס, משימות וקישורים — הכל במקום אחד. 🔵 ההשוואות מבוססות מאגר העסקאות העצמאי.
        </p>
      </header>
      <DealsManager
        allCities={cities.map((c) => c.city_name)}
        tracked={summaries}
        deals={deals}
        comps={comps}
      />
    </main>
  );
}
