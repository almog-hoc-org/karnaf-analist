import { NextResponse } from "next/server";
import { loadCityMapGeometry, buildCityMap } from "@/lib/cityMap";
import { neighborhoodSummary } from "@/lib/neighborhoods";

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

export async function GET(_req: Request, { params }: { params: { city: string } }) {
  const city = decodeURIComponent(params.city);
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
