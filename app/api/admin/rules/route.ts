import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { revalidateTag } from "next/cache";
import { listRules, setRule, resetRule } from "@/lib/systemRules";
import { TAGS } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isAdminRequest()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ rules: listRules() });
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  if (body.action === "reset") {
    resetRule(String(body.key));
  } else {
    setRule(String(body.key), String(body.value ?? ""), body.enabled !== false);
  }
  // Several cached loaders read a rule as a default argument (ref_year, the
  // ranking thresholds); their cache key does not carry the value, so a rule
  // edit showed up only when the entry expired — up to 12h later, while the
  // uncached parts of the same page changed at once.
  revalidateTag(TAGS.market);
  revalidateTag(TAGS.reference);
  return NextResponse.json({ ok: true, rules: listRules() });
}
