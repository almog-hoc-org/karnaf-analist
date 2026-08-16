/**
 * GET /api/admin/usage?userId=<id>&days=<n> → one user's usage detail.
 *
 * Behind the same admin gate as every other operator endpoint (cookie OR
 * ADMIN_API_TOKEN — lib/adminAuth.ts). Without `userId` it returns the
 * site-wide summary, which is what the ops agent asks for.
 *
 * This exists rather than passing every user's detail down with the page:
 * for a few hundred accounts that would be most of the event log travelling
 * to a screen where one row at a time is ever expanded.
 */
import { NextResponse } from "next/server";
import { isAdminApiRequest } from "@/lib/adminAuth";
import { userUsageDetail, usageSummary, topPages, topSearches, usageByUser } from "@/lib/events";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAdminApiRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  // Clamped, not trusted: the window feeds a SQL datetime modifier, and an
  // unbounded one turns a dashboard click into a full-table scan.
  const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days")) || 30));
  const rawUser = url.searchParams.get("userId");

  if (rawUser != null) {
    const userId = Number(rawUser);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "bad userId" }, { status: 400 });
    }
    return NextResponse.json(userUsageDetail(userId, days));
  }

  return NextResponse.json({
    days,
    summary: usageSummary(days),
    pages: topPages(days, 25),
    searches: topSearches(days, 25),
    users: usageByUser(days, 200),
  });
}
