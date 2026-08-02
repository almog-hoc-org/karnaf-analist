import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getRuleNum } from "@/lib/systemRules";
import { DRAWER_PAGE, type NadlanDeal } from "@/lib/nadlanTransactionSeries";

/**
 * Deals behind the city graph, for the year the user opened.
 *
 * Distinct from /api/city-deals/[cityName], which serves the LIVE gov-nadlan
 * neighbourhood comparison. This one reads our own collected repository and
 * exists so the drill-down can show every year of the selected range: the page
 * used to ship "the 2,000 most recent deals", which in a large city is one year
 * of data, so the year tabs never went further back.
 *
 * Filters mirror the graph's controls exactly — change one there, change it here.
 */
export const dynamic = "force-dynamic";

type DealType = "all" | "sh" | "new";
type Ba = "all" | "modern" | "old";

export async function GET(req: NextRequest, { params }: { params: { cityName: string } }) {
  const cityName = decodeURIComponent(params.cityName);
  const q = req.nextUrl.searchParams;

  const year = Number(q.get("year") ?? 0) || 0;          // 0 = the whole range
  const from = Number(q.get("from") ?? 0) || 0;
  const to = Number(q.get("to") ?? 0) || 0;
  const dealType = (["all", "sh", "new"].includes(q.get("dealType") ?? "") ? q.get("dealType") : "all") as DealType;
  const buildingAge = (["all", "modern", "old"].includes(q.get("buildingAge") ?? "") ? q.get("buildingAge") : "all") as Ba;
  const room = q.get("room") ?? "all";
  const offset = Math.max(0, Number(q.get("offset") ?? 0) || 0);
  const limit = Math.min(1000, Math.max(1, Number(q.get("limit") ?? DRAWER_PAGE) || DRAWER_PAGE));

  const modernMinYear = getRuleNum("modern_min_year", 2005);

  const where: string[] = ["city_name = ?", "COALESCE(excluded,0) = 0"];
  const args: unknown[] = [cityName];
  if (year > 0) { where.push("deal_year = ?"); args.push(year); }
  else {
    if (from > 0) { where.push("deal_year >= ?"); args.push(from); }
    if (to > 0) { where.push("deal_year <= ?"); args.push(to); }
  }
  if (["3", "4", "5"].includes(room)) { where.push("room_bucket = ?"); args.push(room); }

  if (dealType === "sh") {
    where.push("is_secondhand = 1");
    if (buildingAge === "modern") { where.push("year_built IS NOT NULL AND year_built >= ?"); args.push(modernMinYear); }
    else if (buildingAge === "old") { where.push("year_built IS NOT NULL AND year_built > 0 AND year_built < ?"); args.push(modernMinYear); }
  } else if (dealType === "new") {
    where.push("is_secondhand = 0 AND year_built IS NOT NULL AND year_built > 0");
  }

  const clause = where.join(" AND ");
  try {
    const [rows, countRow] = await Promise.all([
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT deal_date, deal_year, rooms, room_bucket, area, price, price_sqm, year_built,
                is_secondhand, source, COALESCE(luxury,0) luxury
         FROM nadlan_transactions WHERE ${clause}
         ORDER BY deal_date DESC LIMIT ${limit} OFFSET ${offset}`, ...args),
      prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*) n FROM nadlan_transactions WHERE ${clause}`, ...args),
    ]);

    const deals: NadlanDeal[] = rows.map((r) => ({
      dealDate: String(r.deal_date),
      dealYear: Number(r.deal_year),
      rooms: r.rooms == null ? null : Number(r.rooms),
      roomBucket: String(r.room_bucket),
      area: r.area == null ? null : Number(r.area),
      price: r.price == null ? null : Number(r.price),
      priceSqm: r.price_sqm == null ? null : Number(r.price_sqm),
      yearBuilt: r.year_built == null ? null : Number(r.year_built),
      isSecondHand: !!Number(r.is_secondhand),
      source: String(r.source ?? "nadlan"),
      luxury: !!Number(r.luxury),
    }));

    return NextResponse.json({ deals, total: Number(countRow[0]?.n ?? 0), offset, limit });
  } catch (e) {
    console.error(`city-transactions ${cityName}:`, e);
    return NextResponse.json({ deals: [], total: 0, offset, limit, error: "שגיאה בשליפת העסקאות" }, { status: 500 });
  }
}
