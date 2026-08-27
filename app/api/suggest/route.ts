import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { searchNorm } from "@/lib/searchIndex";

/**
 * Hood/street suggestions for the search boxes — the site's first suggestion
 * endpoint.
 *
 * Reads only the pre-built search_index (a few thousand pre-normalised rows,
 * indexed on `norm`), never the deal table — a keystroke must not cost a
 * GROUP BY over 1.45M rows. The index is rebuilt by the nightly pipeline;
 * a missing table (index never built) answers an empty list, not an error.
 *
 * Prefix matches rank above contains-matches, and within each tier more
 * deals rank higher — "the hood people mean" and "the hood with the most
 * market" are usually the same one.
 */
export const dynamic = "force-dynamic";

export interface Suggestion {
  kind: "hood" | "street";
  city: string;
  /** display name — the hood, or the street */
  name: string;
  /** the target hood (for a street, where it leads) */
  hood: string;
  url: string;
}

export async function GET(req: NextRequest) {
  const rl = rateLimit(`suggest:${clientIp(req.headers)}`, 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { suggestions: [] },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2 || q.length > 60) return NextResponse.json({ suggestions: [] });
  const norm = searchNorm(q);
  if (!norm) return NextResponse.json({ suggestions: [] });

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      kind: string; city_name: string; name: string; hood: string; n: number; tier: number;
    }>>(
      // ESCAPE and the stripped % / _ : the norm is free text from the client
      // and LIKE metacharacters in it would turn a search into a wildcard.
      `SELECT kind, city_name, name, hood, n,
              CASE WHEN norm LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END tier
         FROM search_index
        WHERE norm LIKE ? ESCAPE '\\'
        ORDER BY tier, n DESC
        LIMIT 8`,
      like(norm) + "%",
      "%" + like(norm) + "%"
    );
    const suggestions: Suggestion[] = rows.map((r) => ({
      kind: r.kind as "hood" | "street",
      city: r.city_name,
      name: r.name,
      hood: r.hood,
      url: `/city/${encodeURIComponent(r.city_name)}/neighborhood/${encodeURIComponent(r.hood)}`,
    }));
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] }); // index not built yet
  }
}

function like(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
