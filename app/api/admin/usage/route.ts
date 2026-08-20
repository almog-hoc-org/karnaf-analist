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
import {
  userUsageDetail, usageSummary, topPages, topSearches, usageByUser,
  eventCounts, topMisses, firstEventAt, visitShape, exitPages, landingPages,
  trafficSources, signupFunnel, registeredNeverUnlocked, rageClicks,
  errorsShown, ctaClicks, scrollDepth, cityDemand, creditEconomy,
  retentionCohorts,
} from "@/lib/events";
import { usageTrend, rollupCoverage } from "@/lib/usageRollup";
import { loadThinSampleCities, loadRankingEligibleCities } from "@/lib/cityTransactionPrices";

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

  // The WHOLE panel in one response, on purpose.
  //
  // app/admin/page.tsx renders all eight tabs on the server for every load, so
  // any query added to this dashboard would have slowed down every other tab —
  // including the ones an operator opens far more often. Moving the panel
  // behind one fetch means the cost is paid only by whoever opens "שימוש", and
  // means the range picker can change the window without a page reload.
  //
  // Each loader fails soft on its own (lib/events.ts), so one broken panel
  // returns empty instead of blanking the response.
  // Demand crossed with COVERAGE — the one thing no external analytics tool
  // can produce, because it needs to know what is in the archive as well as
  // what people looked at. "People keep opening a city whose sample is thin"
  // is a collection priority, and it is invisible to anything that only sees
  // the traffic.
  let thin = new Set<string>();
  let eligible = new Set<string>();
  try {
    [thin, eligible] = await Promise.all([loadThinSampleCities(), loadRankingEligibleCities()]);
  } catch { /* the analytics DB being busy must not blank the usage tab */ }
  const demand = cityDemand(days, 40).map((c) => ({
    ...c,
    quality: thin.has(c.city) ? "thin" : eligible.has(c.city) ? "ok" : "partial",
  }));

  return NextResponse.json({
    days,
    since: firstEventAt(),
    summary: usageSummary(days),
    shape: visitShape(days),
    trend: usageTrend(Math.max(days, 30)),
    rollup: rollupCoverage(),
    pages: topPages(days, 25),
    exits: exitPages(days, 25),
    landings: landingPages(days, 20),
    scroll: scrollDepth(days, 15),
    sources: trafficSources(days, 15),
    funnel: signupFunnel(days),
    neverUnlocked: registeredNeverUnlocked(90),
    rage: rageClicks(days, 20),
    errors: errorsShown(days, 20),
    ctas: ctaClicks(days),
    cities: demand,
    credits: creditEconomy(90),
    cohorts: retentionCohorts(8),
    events: eventCounts(days),
    misses: topMisses(days, 30),
    searches: topSearches(days, 25),
    users: usageByUser(days, 200),
  });
}
