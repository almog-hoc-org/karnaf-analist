/**
 * POST /api/events — first-party event intake.
 *
 * Public and unauthenticated by necessity: the whole point is to hear from
 * anonymous visitors, which is who the audience is. That makes it the one write
 * endpoint on the site anyone can reach, so it is deliberately narrow:
 *
 *   - the event name must be one of a fixed list; unknown names are rejected
 *   - every field is length-capped before it reaches the database
 *   - per-IP rate limiting bounds how much one client can write
 *   - it stores no IP, no user-agent, no account id (see lib/events.ts)
 *
 * Always answers 204 to the browser, even when the write is dropped. A visitor
 * gains nothing from an analytics error, and a failure here must never surface
 * as a broken interaction — the caller uses sendBeacon and ignores the reply.
 */
import { NextRequest, NextResponse } from "next/server";
import { recordEvent, EVENT_NAMES, type EventName } from "@/lib/events";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_CONTENT = new NextResponse(null, { status: 204 });

export async function POST(req: NextRequest) {
  // Generous enough for real browsing (a page view plus a few interactions per
  // page), small enough that no single client can flood the table.
  const gate = rateLimit(`events:${clientIp(req.headers)}`, 120, 60_000);
  if (!gate.ok) return NO_CONTENT;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NO_CONTENT;
  }

  // Accept one event or a small batch — sendBeacon on unload may flush several.
  const items = Array.isArray(body) ? body.slice(0, 20) : [body];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const name = String(e.name ?? "");
    if (!EVENT_NAMES.includes(name as EventName)) continue;
    recordEvent({
      name: name as EventName,
      path: typeof e.path === "string" ? e.path : null,
      subject: typeof e.subject === "string" ? e.subject : null,
      detail: typeof e.detail === "string" ? e.detail : null,
      sessionId: typeof e.sessionId === "string" ? e.sessionId : null,
    });
  }

  return NO_CONTENT;
}
