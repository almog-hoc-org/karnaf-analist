/**
 * POST /api/admin/sync-mailing  { target: "ravmesser" | "crm" }
 * GET  /api/admin/sync-mailing?export=csv
 *
 * The manual triggers behind the admin panel's mailing section. POST runs one
 * sync batch and returns its report; GET with ?export=csv downloads the full
 * user list as CSV — the no-configuration fallback that always works.
 */
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { syncToRavMesser, syncToCrm, consentingUsersCsv, ravMesserConfigured, crmConfigured } from "@/lib/mailingSync";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAdminRequest()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  if (url.searchParams.get("export") === "csv") {
    return new NextResponse(consentingUsersCsv(), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="karnaf-users-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }
  // no export param → report configuration state, so the UI can label buttons
  return NextResponse.json({ ravmesser: ravMesserConfigured(), crm: crmConfigured() });
}

export async function POST(req: Request) {
  if (!isAdminRequest()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let target: string;
  try {
    target = String((await req.json())?.target ?? "");
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (target === "ravmesser") return NextResponse.json(await syncToRavMesser());
  if (target === "crm") return NextResponse.json(await syncToCrm());
  return NextResponse.json({ error: "unknown target" }, { status: 400 });
}
