/**
 * Product-update broadcast API (admin cookie OR agent bearer token).
 *
 * GET  /api/admin/broadcast          → { configured, history: [...] }
 * POST /api/admin/broadcast { subject, body } → BroadcastReport
 *
 * Sends ONLY to mailing_consent=1 users, via Resend, with an opt-out link.
 */
import { NextResponse } from "next/server";
import { isAdminApiRequest } from "@/lib/adminAuth";
import { sendBroadcast, broadcastHistory, broadcastConfigured } from "@/lib/broadcast";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAdminApiRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ configured: broadcastConfigured(), history: broadcastHistory() });
}

export async function POST(req: Request) {
  if (!isAdminApiRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { subject?: string; body?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const report = await sendBroadcast(String(body.subject ?? ""), String(body.body ?? ""));
  return NextResponse.json(report, { status: report.ok || report.sent > 0 ? 200 : 400 });
}
