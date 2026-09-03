import { NextRequest, NextResponse } from "next/server";
import { loadAreaDealPoints } from "@/lib/dealPins";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import type { DealScope } from "@/lib/neighborhoodDeals";

/**
 * The located deals of one neighbourhood, as points in the city map's own
 * coordinate space — every deal in the window, not a page.
 *
 * A ROUTE OF ITS OWN, NOT A FLAG ON /api/city-transactions. That endpoint is
 * paged, uncached and shared by three drawers; this one is whole-window,
 * cached like the geometry it is drawn on, and fetched once per click. Two
 * cache policies on one URL would have meant the stricter one for both.
 *
 * `street` (+ optional `house`) is folded by lib/addressKey, any spelling works.
 * `neighborhood` must be the Tax Authority spelling — the price row's name,
 * never the shape's (lib/neighborhoodDeals.ts says why). Any other string
 * returns zero points, quietly.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { city: string } }) {
  const rl = rateLimit(`city-map-deals:${clientIp(req.headers)}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "יותר מדי בקשות — נסה שוב בעוד רגע" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }
  const city = decodeURIComponent(params.city);
  const q = req.nextUrl.searchParams;
  const neighborhood = (q.get("neighborhood") ?? "").trim();
  const street = (q.get("street") ?? "").trim();
  const house = (q.get("house") ?? "").trim();
  // one area: a neighbourhood, a street, or a street + house
  const area = neighborhood ? `hood:${neighborhood}` : street ? (house ? `address:${street}|${house}` : `street:${street}`) : null;
  if (!area) return NextResponse.json({ error: "חסר שם שכונה או רחוב" }, { status: 400 });
  const scope = (["sh", "new", "all"].includes(q.get("scope") ?? "") ? q.get("scope") : "sh") as DealScope;
  const from = Number(q.get("from") ?? 0) || 0;
  const to = Number(q.get("to") ?? 0) || 0;

  try {
    const data = await loadAreaDealPoints(city, area, scope, from, to);
    return NextResponse.json(data, {
      // Points change when the nightly pipeline runs; the geometry route uses
      // the same window, and the two are always drawn together.
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    });
  } catch (e) {
    console.error(`city-map deals ${city}/${neighborhood}:`, e);
    return NextResponse.json({ error: "שגיאה בשליפת הנקודות" }, { status: 500 });
  }
}
