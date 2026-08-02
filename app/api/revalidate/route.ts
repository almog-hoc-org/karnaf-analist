/**
 * POST /api/revalidate — drop cached research data after the pipeline changes it.
 *
 * WHY THIS EXISTS
 * Until now nothing could tell a running server that the database had changed.
 * The only refresh mechanism in the repo was a full rebuild and redeploy
 * (scripts/monthly-refresh.sh), and the bi-weekly script did not even do that —
 * it imported new data and left the live process serving whatever it already
 * had. With lib/cache.ts now holding query results between requests, that gap
 * would turn from "wasted work" into "wrong numbers", so the pipeline needs a
 * way to say: this is stale, throw it away.
 *
 * AUTH — two accepted callers, deliberately different:
 *   1. A logged-in admin (cookie) — for the dashboard's "apply changes" button.
 *   2. A bearer token (REVALIDATE_TOKEN) — for the nightly pipeline, which runs
 *      as a script with no browser session.
 * If the token is not configured, only the cookie path works. It never falls
 * open — same rule as lib/adminAuth.ts.
 *
 * Usage from a script:
 *   curl -X POST localhost:3000/api/revalidate \
 *        -H "Authorization: Bearer $REVALIDATE_TOKEN" \
 *        -H "Content-Type: application/json" -d '{"tags":["market-data"]}'
 */
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import crypto from "crypto";
import { isAdminRequest } from "@/lib/adminAuth";
import { TAGS } from "@/lib/cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_TAGS = new Set<string>(Object.values(TAGS));

/** Constant-time compare that tolerates a length mismatch instead of throwing. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function authorized(req: NextRequest): boolean {
  if (isAdminRequest()) return true;
  const expected = process.env.REVALIDATE_TOKEN;
  if (!expected) return false; // not configured ⇒ token auth is unavailable, not open
  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return !!presented && safeEqual(presented, expected);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Body is optional: no body (or no tags) means "everything", which is the
  // right default for a pipeline that just rewrote the database.
  let requested: string[] = [...VALID_TAGS];
  try {
    const body = await req.json();
    if (Array.isArray(body?.tags) && body.tags.length) {
      requested = body.tags.map(String);
    }
  } catch {
    /* no body — keep the default */
  }

  const unknown = requested.filter((t) => !VALID_TAGS.has(t));
  if (unknown.length) {
    return NextResponse.json(
      { error: `unknown tags: ${unknown.join(", ")}`, valid: [...VALID_TAGS] },
      { status: 400 }
    );
  }

  for (const tag of requested) revalidateTag(tag);

  return NextResponse.json({ ok: true, revalidated: requested, at: new Date().toISOString() });
}
