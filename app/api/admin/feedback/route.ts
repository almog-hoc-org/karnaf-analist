/**
 * GET /api/admin/feedback — the feedback inbox, for the admin panel's ops
 * agent (bearer token) as much as for humans.
 *
 * ?status=pending (default) | approved | all
 *
 * This is what lets the agent TRIAGE: read what users reported, group it,
 * turn it into tasks, and approve entries (POST /api/admin/feedback-approve)
 * once the operator signs off.
 */
import { NextResponse } from "next/server";
import { isAdminApiRequest } from "@/lib/adminAuth";
import { appDb } from "@/lib/appDb";
import { ensureFeedbackTable } from "@/lib/feedback";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAdminApiRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const status = new URL(req.url).searchParams.get("status") ?? "pending";
  const where =
    status === "approved" ? "WHERE approved_at IS NOT NULL" :
    status === "all" ? "" : "WHERE approved_at IS NULL";
  try {
    ensureFeedbackTable();
    const rows = appDb().prepare(
      `SELECT id, kind, message, rating, email, path, city, user_id, approved_at, created_at
         FROM feedback ${where} ORDER BY id DESC LIMIT 200`
    ).all();
    return NextResponse.json({ feedback: rows });
  } catch {
    return NextResponse.json({ feedback: [] });
  }
}
