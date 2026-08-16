import { prisma } from "./db";
import { cachedMarket } from "./cache";

/**
 * The three headline numbers on the home page: usable deals, deals in the last
 * 12 months, and the freshest deal date.
 *
 * They were computed inline on every render, and neither COUNT can use the
 * only index on nadlan_transactions (city_name, deal_year, room_bucket) — so
 * each home-page view cost two full scans of ~1.35M rows. The numbers change
 * once a night at most, which is precisely what the market cache tag means.
 */
export interface DealTotals {
  totalDeals: number;
  deals12m: number;
  maxDealDate: string | null;
}

async function loadDealTotalsUncached(): Promise<DealTotals> {
  try {
    // Usable deals only: active (non-excluded) and within the last 10 years —
    // the exact set that feeds the graphs, so the headline can't over-state it.
    const [totals] = await prisma.$queryRawUnsafe<Array<{ n: bigint; maxd: string | null }>>(
      "SELECT COUNT(*) AS n, MAX(deal_date) AS maxd FROM nadlan_transactions WHERE COALESCE(excluded,0)=0 AND deal_year >= CAST(strftime('%Y','now') AS INTEGER) - 10"
    );
    const [recent] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      "SELECT COUNT(*) AS n FROM nadlan_transactions WHERE COALESCE(excluded,0)=0 AND deal_date >= date('now','-12 months')"
    );
    return {
      totalDeals: Number(totals?.n ?? 0),
      deals12m: Number(recent?.n ?? 0),
      maxDealDate: totals?.maxd ?? null,
    };
  } catch {
    // table missing (fresh DB) — the tiles render "—" rather than crashing
    return { totalDeals: 0, deals12m: 0, maxDealDate: null };
  }
}

export const loadDealTotals = cachedMarket(loadDealTotalsUncached, ["deal-totals"]);
