import { NextRequest, NextResponse } from "next/server";
import { locateAddress } from "@/lib/dealPins";
import { getRuleNum } from "@/lib/systemRules";
import { rateLimit, clientIp } from "@/lib/rateLimit";

/**
 * One address as a point in the city map's coordinate space, plus the radius
 * the comparison ladder uses (comp_radius_m) in the same units — so the map
 * can draw the circle the verdict was measured in. 404 when the address is
 * not geocoded: the page then shows no marker rather than a wrong one.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { city: string } }) {
  const rl = rateLimit(`city-map-locate:${clientIp(req.headers)}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "יותר מדי בקשות — נסה שוב בעוד רגע" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  }
  const city = decodeURIComponent(params.city);
  const q = req.nextUrl.searchParams;
  const street = (q.get("street") ?? "").trim();
  const house = (q.get("house") ?? "").trim();
  if (!street) return NextResponse.json({ error: "חסר רחוב" }, { status: 400 });
  try {
    const located = await locateAddress(city, street, house);
    if (!located) return NextResponse.json({ error: "הכתובת אינה ממוקמת" }, { status: 404 });
    const radiusM = Math.max(0, getRuleNum("comp_radius_m"));
    return NextResponse.json(
      { ...located, radiusM, radiusUnits: radiusM * located.unitsPerMetre },
      { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } }
    );
  } catch (e) {
    console.error(`city-map locate ${city}/${street} ${house}:`, e);
    return NextResponse.json({ error: "שגיאה במיקום הכתובת" }, { status: 500 });
  }
}
