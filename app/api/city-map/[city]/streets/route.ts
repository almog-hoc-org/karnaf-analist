import { NextRequest, NextResponse } from "next/server";
import { loadCityStreets, streetsInBox } from "@/lib/cityMap";
import { rateLimit, clientIp } from "@/lib/rateLimit";

/**
 * The local streets that cross one box of the city map — what the zoomed
 * view draws under the pins. Never the whole city: Tel Aviv's local streets
 * are ~500 KB, a neighbourhood's a few tens.
 *   GET ?x=&y=&w=&h=   (map units, 0..1000)
 */
export const dynamic = "force-dynamic";
const MAX_LINES = 900;

export async function GET(req: NextRequest, { params }: { params: { city: string } }) {
  const rl = rateLimit(`city-map-streets:${clientIp(req.headers)}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "יותר מדי בקשות — נסה שוב בעוד רגע" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  }
  const city = decodeURIComponent(params.city);
  const q = req.nextUrl.searchParams;
  const box = { x: Number(q.get("x")), y: Number(q.get("y")), w: Number(q.get("w")), h: Number(q.get("h")) };
  if (![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.w <= 0 || box.h <= 0) {
    return NextResponse.json({ error: "חסרה תיבה (x, y, w, h)" }, { status: 400 });
  }
  try {
    const all = await loadCityStreets(city);
    const inBox = streetsInBox(all, box).sort((a, b) => a.rank - b.rank || b.length - a.length).slice(0, MAX_LINES);
    return NextResponse.json(
      { lines: inBox.map((s) => ({ kind: "road", rank: s.rank, name: s.name, path: s.path, length: s.length })), total: all.length },
      { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } }
    );
  } catch (e) {
    console.error(`city-map streets ${city}:`, e);
    return NextResponse.json({ error: "שגיאה בשליפת הרחובות" }, { status: 500 });
  }
}
