/**
 * POST /api/admin/feedback-approve  { id }
 *
 * Marks a feedback row approved and grants its author the one-time feedback
 * credit bonus. The bonus fires on APPROVAL, not submission — "write anything,
 * get credits" farms itself; "write something the operator judged useful"
 * does not. Anonymous feedback (no user_id) approves fine, there is just no
 * account to credit. Idempotent on both axes: re-approving is a no-op, and
 * the grant itself is once-per-user.
 */
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { appDb } from "@/lib/appDb";
import { grantFeedbackBonus } from "@/lib/credits";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isAdminRequest()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let id: number;
  try {
    id = Number((await req.json())?.id);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const row = appDb().prepare("SELECT id, user_id, approved_at FROM feedback WHERE id=?").get(id) as
    | { id: number; user_id: number | null; approved_at: string | null }
    | undefined;
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!row.approved_at) {
    appDb().prepare("UPDATE feedback SET approved_at=datetime('now') WHERE id=?").run(id);
    if (row.user_id) grantFeedbackBonus(row.user_id, row.id);
  }
  return NextResponse.json({ ok: true, credited: !!row.user_id && !row.approved_at });
}
