/**
 * User management API — the admin panel and the operator's AI ops agent
 * share it (cookie OR ADMIN_API_TOKEN bearer, see lib/adminAuth.ts).
 *
 * GET  /api/admin/users                     → { users: [...] }
 * POST /api/admin/users { action, ... }:
 *   { action: "create", email, name, password, phone?, mailingConsent? }
 *   { action: "delete", userId }            — full cascade, irreversible
 *   { action: "reset_password", userId }    → { tempPassword } (shown once; sessions revoked)
 *   { action: "adjust_credits", userId, credits, note? }
 *   { action: "set_consent", userId, consent }
 */
import { NextResponse } from "next/server";
import { isAdminApiRequest } from "@/lib/adminAuth";
import { registerUser } from "@/lib/auth";
import { grantSignupBonus } from "@/lib/credits";
import { listUsers, deleteUser, resetUserPassword, adjustUserCredits, setUserConsent } from "@/lib/userAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAdminApiRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ users: listUsers() });
}

export async function POST(req: Request) {
  if (!isAdminApiRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const action = String(body.action ?? "");
  const userId = Number(body.userId);

  switch (action) {
    case "create": {
      const res = registerUser(
        String(body.email ?? ""), String(body.name ?? ""), String(body.password ?? ""),
        { phone: String(body.phone ?? ""), mailingConsent: body.mailingConsent !== false }
      );
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
      grantSignupBonus(res.userId);
      return NextResponse.json({ ok: true, userId: res.userId });
    }
    case "delete": {
      if (!Number.isInteger(userId)) return NextResponse.json({ error: "bad userId" }, { status: 400 });
      const res = deleteUser(userId);
      return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: res.error }, { status: 404 });
    }
    case "reset_password": {
      if (!Number.isInteger(userId)) return NextResponse.json({ error: "bad userId" }, { status: 400 });
      const res = resetUserPassword(userId);
      return res.ok ? NextResponse.json({ ok: true, tempPassword: res.tempPassword }) : NextResponse.json({ error: res.error }, { status: 404 });
    }
    case "adjust_credits": {
      const credits = Number(body.credits);
      if (!Number.isInteger(userId) || !Number.isFinite(credits) || credits === 0 || Math.abs(credits) > 1000) {
        return NextResponse.json({ error: "bad userId or credits" }, { status: 400 });
      }
      const ok = adjustUserCredits(userId, credits, String(body.note ?? "עדכון מנהל"));
      return NextResponse.json({ ok });
    }
    case "set_consent": {
      if (!Number.isInteger(userId)) return NextResponse.json({ error: "bad userId" }, { status: 400 });
      const ok = setUserConsent(userId, body.consent === true);
      return NextResponse.json({ ok });
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
