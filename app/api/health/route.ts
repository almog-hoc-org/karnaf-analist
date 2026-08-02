import { NextResponse } from "next/server";

/**
 * Liveness probe for the tunnel watchdog. Deliberately touches NOTHING —
 * no database, no filesystem, no rules cache.
 *
 * The watchdog used to probe "/", which runs the full homepage query set. While
 * a nightly aggregation held the SQLite write lock the homepage exceeded the
 * probe timeout, the watchdog read that as "tunnel down", restarted cloudflared —
 * and a quick tunnel gets a NEW random URL on every restart. That is what kept
 * killing the public link. A route that can't be slowed down by data work
 * separates "the app is busy" from "the tunnel is gone".
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
