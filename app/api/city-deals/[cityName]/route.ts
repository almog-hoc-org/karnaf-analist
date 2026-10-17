import { NextRequest, NextResponse } from "next/server";
import { getCityDealsData, CityDealsData } from "@/lib/govNadlanService";
import { getCachedDeals, setCachedDeals } from "@/lib/dealsCache";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { prisma } from "@/lib/db";

// In-memory cache (server lifetime) for very fast hits
const memoryCache = new Map<string, { data: CityDealsData; expires: number }>();
/** Bounded: every distinct name used to stay for the life of the process. */
const MEM_MAX = 200;
function remember(cityName: string, data: CityDealsData, ttlMs: number) {
  if (memoryCache.size >= MEM_MAX) {
    const oldest = memoryCache.keys().next().value;
    if (oldest !== undefined) memoryCache.delete(oldest);
  }
  memoryCache.set(cityName, { data, expires: Date.now() + ttlMs });
}
const MEM_TTL_MS = 60 * 60 * 1000; // 1 hour
// A failed live fetch is remembered briefly so a blocked govmap is probed at
// most every few minutes — not on every page view of every visitor.
const FAIL_TTL_MS = 10 * 60 * 1000;

export async function GET(
  req: NextRequest,
  { params }: { params: { cityName: string } }
) {
  // Public and unauthenticated, and on a cache miss it attempts a LIVE
  // upstream fetch — so an unlimited caller can both scrape the neighbourhood
  // comparison and use this server as an amplifier against govmap. Cheap cap;
  // the two cache layers below mean a real visitor rarely gets past step 1.
  const rl = rateLimit(`city-deals:${clientIp(req.headers)}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "יותר מדי בקשות — נסה שוב בעוד רגע" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  let cityName: string;
  try { cityName = decodeURIComponent(params.cityName); } catch { return NextResponse.json({ error: "שם עיר לא תקין" }, { status: 400 }); }

  // Only cities we know. Any other string used to reach the live fetch and
  // then be written to disk as a cache file — a public endpoint that created
  // a file per request, and fired govmap queries for each.
  const known = await prisma.city.findUnique({ where: { city_name: cityName }, select: { city_name: true } });
  if (!known) return NextResponse.json({ error: "עיר לא מוכרת" }, { status: 404 });

  // 1) memory cache
  const mem = memoryCache.get(cityName);
  if (mem && mem.expires > Date.now()) {
    return NextResponse.json(mem.data, { headers: { "X-Cache": "MEM" } });
  }

  // 2) disk cache (permanent — refreshed by pre-fetch script)
  const disk = getCachedDeals(cityName);
  if (disk) {
    remember(cityName, disk, MEM_TTL_MS);
    return NextResponse.json(disk, { headers: { "X-Cache": "DISK" } });
  }

  // 3) live fetch (slow path; govmap is geo-restricted, so this can only
  //    succeed when the server has an Israeli route — usually it does not)
  try {
    const data = await getCityDealsData(cityName);
    // An empty answer is a transient miss (govmap found nothing right now),
    // not a fact about the city — persisting it would freeze the panel on
    // "no deals" with nothing on the server able to refresh it.
    if (data.totalDealsAnalyzed > 0 && data.neighborhoods.length > 0) setCachedDeals(cityName, data);
    remember(cityName, data, data.totalDealsAnalyzed > 0 ? MEM_TTL_MS : FAIL_TTL_MS);
    return NextResponse.json(data, { headers: { "X-Cache": "LIVE" } });
  } catch (error) {
    console.error(`Failed to fetch deals for ${cityName}:`, error);
    // No cache and no live source is a DEGRADED answer, not a server error:
    // the page around this panel is healthy, and a 500 here painted the whole
    // city page as broken. 200 + unavailable:true lets the UI say precisely
    // what is missing.
    // No townCharacter: the panel used to describe Holon as a "small town"
    // on the strength of this placeholder.
    const empty: CityDealsData & { unavailable: true } = {
      cityName,
      lastUpdated: new Date().toISOString(),
      neighborhoods: [],
      totalDealsAnalyzed: 0,
      periodYears: { current: 0, minus3: 0, minus5: 0 },
      townCharacter: "",
      unavailable: true,
    };
    remember(cityName, empty, FAIL_TTL_MS);
    return NextResponse.json(empty, { headers: { "X-Cache": "UNAVAILABLE" } });
  }
}
