import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { listRules, setRule, resetRule } from "@/lib/systemRules";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isAdminRequest()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ rules: listRules() });
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  if (body.action === "reset") {
    resetRule(String(body.key));
  } else {
    setRule(String(body.key), String(body.value ?? ""), body.enabled !== false);
  }
  return NextResponse.json({ ok: true, rules: listRules() });
}
