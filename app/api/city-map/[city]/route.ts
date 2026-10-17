import { NextRequest, NextResponse } from "next/server";
import { loadCityMapGeometry, buildCityMap } from "@/lib/cityMap";
import { neighborhoodSummary } from "@/lib/neighborhoods";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { resolveCityName } from "@/lib/cityLookup";

/**
 * The neighbourhood map's geometry, fetched by the browser only when there is a
 * wide screen to draw it on.
 *
 * WHY NOT JUST RENDER IT WITH THE PAGE
 * Because `hidden lg:block` hides pixels, not bytes. Tel Aviv's outlines and
 * streets are on the order of a hundred kilobytes of path strings, and
 * server-rendering them into every response would send all of it to every
 * phone — where the map is never shown. The previous release was spent taking
 * weight OFF the phone; putting it back invisibly would undo that.
 *
 * The desktop cost is one cached request after paint. The table, which is what
 * a phone actually reads, still renders on the server exactly as before.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { city: string } }) {
  // cheap per hit after the first, but the city string is a cache key: a
  // budget and a known-city check keep the key space finite
  const rl = rateLimit(`city-map:${clientIp(req.headers)}`, 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "יותר מדי בקשות — נסה שוב בעוד רגע" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  let requested: string;
  try { requested = decodeURIComponent(params.city); } catch { return NextResponse.json({ map: null }, { status: 400 }); }
  const city = await resolveCityName(requested);
  if (!city) return NextResponse.json({ map: null }, { status: 404 });
  const [geometry, summary] = await Promise.all([
    loadCityMapGeometry(city),
    neighborhoodSummary(city, { scope: "secondhand", years: 3 }),
  ]);
  const view = buildCityMap(geometry, summary.rows);
  if (!view) return NextResponse.json({ map: null });
  return NextResponse.json(
    { map: view },
    // The geometry changes when the collector runs, which is nightly at most.
    { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } }
  );
}
