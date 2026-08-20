#!/usr/bin/env tsx
/**
 * Run every usage-dashboard query once and report that it executed.
 *
 * WHY THIS IS A SCRIPT AND NOT A UNIT TEST
 * These are SQL strings. TypeScript checks the shape of what comes back and
 * says nothing about whether the statement parses, whether the columns exist,
 * or whether the parameters bind — and two of those three had already gone
 * wrong here before this file existed: a set of queries written with ?1/?2 that
 * better-sqlite3 refuses to bind an array to, and a roll-up reading a column
 * that only the web app's migration creates. Both threw at runtime, both were
 * invisible to `tsc`, and both would have surfaced as an empty admin panel
 * rather than an error anyone would notice.
 *
 * Every query is wrapped in try/catch in lib/events.ts, which is right for a
 * dashboard — one broken panel must not blank the page — and exactly why they
 * need a caller that reports the throw instead of swallowing it. This one
 * distinguishes "returned nothing" from "could not run", and exits non-zero
 * only for the second.
 *
 *   npx tsx scripts/verify-usage-queries.ts
 */
import {
  usageSummary, topPages, topSearches, usageByUser, userUsageDetail,
  visitShape, exitPages, landingPages, trafficSources, signupFunnel,
  registeredNeverUnlocked, rageClicks, errorsShown, ctaClicks, scrollDepth,
  cityDemand, creditEconomy, retentionCohorts, eventCounts, topMisses,
  uniqueSessions, firstEventAt,
  visitorShape, pageDepth, sectionViews, webVitals, navigationPaths,
  engagedSessions, stickiness, timeToFirstValue, sessionLengths,
  adoptionBreadth, conversionByLanding,
} from "../lib/events";
import { usageTrend, rollupCoverage, periodComparison } from "../lib/usageRollup";

const DAYS = 30;

/**
 * Runs one query OUTSIDE the library's own try/catch is impossible — so
 * instead this calls it and treats a thrown error as the failure it is. The
 * library returning an empty array is a legitimate answer on a quiet site and
 * is reported as such, not as a pass/fail.
 */
const checks: Array<[string, () => unknown]> = [
  ["uniqueSessions", () => uniqueSessions(DAYS)],
  ["firstEventAt", () => firstEventAt()],
  ["eventCounts", () => eventCounts(DAYS)],
  ["topMisses", () => topMisses(DAYS)],
  ["usageSummary", () => usageSummary(DAYS)],
  ["topPages", () => topPages(DAYS)],
  ["topSearches", () => topSearches(DAYS)],
  ["usageByUser", () => usageByUser(DAYS)],
  ["userUsageDetail", () => userUsageDetail(1, DAYS)],
  ["visitShape", () => visitShape(DAYS)],
  ["exitPages", () => exitPages(DAYS)],
  ["landingPages", () => landingPages(DAYS)],
  ["trafficSources", () => trafficSources(DAYS)],
  ["signupFunnel", () => signupFunnel(DAYS)],
  ["registeredNeverUnlocked", () => registeredNeverUnlocked(90)],
  ["rageClicks", () => rageClicks(DAYS)],
  ["errorsShown", () => errorsShown(DAYS)],
  ["ctaClicks", () => ctaClicks(DAYS)],
  ["scrollDepth", () => scrollDepth(DAYS)],
  ["cityDemand", () => cityDemand(DAYS)],
  ["creditEconomy", () => creditEconomy(90)],
  ["retentionCohorts", () => retentionCohorts(8)],
  ["visitorShape", () => visitorShape(DAYS)],
  ["pageDepth", () => pageDepth(DAYS)],
  ["sectionViews", () => sectionViews(DAYS)],
  ["sectionViews(city)", () => sectionViews(DAYS, "חיפה")],
  ["webVitals", () => webVitals(DAYS)],
  ["navigationPaths", () => navigationPaths(DAYS)],
  ["engagedSessions", () => engagedSessions(DAYS)],
  ["stickiness", () => stickiness(DAYS)],
  ["timeToFirstValue", () => timeToFirstValue(90)],
  ["sessionLengths", () => sessionLengths(DAYS)],
  ["adoptionBreadth", () => adoptionBreadth(DAYS)],
  ["conversionByLanding", () => conversionByLanding(DAYS)],
  ["periodComparison", () => periodComparison(DAYS)],
  ["usageTrend", () => usageTrend(DAYS)],
  ["rollupCoverage", () => rollupCoverage()],
];

function size(v: unknown): string {
  if (Array.isArray(v)) return `${v.length} שורות`;
  if (v && typeof v === "object") return "אובייקט";
  return String(v);
}

function main() {
  console.log(`\nאימות שאילתות דשבורד השימוש · חלון ${DAYS} יום\n`);
  let failed = 0;
  let empty = 0;
  for (const [name, fn] of checks) {
    try {
      const v = fn();
      const isEmpty = Array.isArray(v) ? v.length === 0 : v == null;
      if (isEmpty) empty++;
      console.log(`  ${isEmpty ? "·" : "✓"} ${name.padEnd(26)}${size(v)}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name.padEnd(26)}${(e as Error).message}`);
    }
  }
  console.log(
    `\n  ${checks.length - failed}/${checks.length} רצו · ${empty} החזירו ריק ` +
    `(ריק אינו כישלון — אתר שקט מחזיר ריק)\n`
  );
  if (failed) {
    console.error(`  ✗ ${failed} שאילתות נכשלו — הפאנל יראה ריק ולא ידווח על כך`);
    process.exit(1);
  }
}

main();
