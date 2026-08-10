/**
 * GET /api/status — data-freshness heartbeat.
 *
 * DELIBERATELY SEPARATE FROM /api/health. That route is a pure liveness probe
 * that touches nothing, and the comment there explains why: the watchdog used
 * to probe a route that ran real queries, a nightly aggregation held the SQLite
 * write lock, the probe timed out, and the watchdog restarted cloudflared —
 * which handed out a new random public URL every time. Adding database work to
 * that probe would rebuild exactly the failure it was written to escape.
 *
 * So liveness stays at /api/health, and freshness lives here.
 *
 * WHAT THIS IS FOR
 * The pipeline can fail silently. Nothing today notices that last night's run
 * did not happen, so a stale site is discovered by a reader, not by an alert.
 * This endpoint reports how old the data is; an external monitor
 * (Healthchecks.io or similar) turns "no successful run in N hours" into a
 * notification.
 *
 * A dead-man switch has to be driven from OUTSIDE the box. A server that has
 * stopped updating cannot notice that it stopped — and a server that is down
 * cannot alert at all. That is why this reports state instead of alerting, and
 * why `ok:false` plus a non-200 is the useful contract for a poller.
 *
 * THREE LEVELS, TWO STATUS CODES
 *   healthy   — 200, ok:true,  no findings.
 *   degraded  — 200, ok:true,  `warnings` non-empty: users are served, but an
 *               external source is blocked or the data is aging toward its
 *               quarterly refresh. Operator reads it in the admin panel.
 *   unhealthy — 503, ok:false, `problems` non-empty: core failure, page someone.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appDb } from "@/lib/appDb";
import { refYear } from "@/lib/refYear";
import { cacheStats } from "@/lib/dealsCache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Hours after which the data is considered stale. Nightly pipeline ⇒ 36h allows one missed run. */
const STALE_AFTER_HOURS = 36;

/**
 * Sources that CANNOT succeed from this server by design: govmap and nadlan
 * are geo-restricted to Israeli routes (nadlan additionally needs a browser
 * past reCAPTCHA). They are refreshed by the quarterly run from the operator's
 * machine — so "skipped-unreachable" for them is the EXPECTED state here, a
 * warning at most, never an outage.
 *
 * This distinction is what fixes the boy-who-cried-wolf problem this endpoint
 * had: it answered 503 around the clock because of sources that can never
 * work from this box, so the external monitor was permanently red and a real
 * failure would have looked identical to the background noise.
 */
const GEO_RESTRICTED_SOURCES = new Set(["govmap", "prefetch-deals", "nadlan"]);

/**
 * Transactions arrive via the quarterly refresh from the operator's machine:
 * one quarter (~92 days) plus the tax-authority reporting lag. Beyond this,
 * the DATA is aging even though every nightly job is green — a warning the
 * operator acts on by running the refresh, not a server fault.
 */
const TRANSACTIONS_STALE_AFTER_DAYS = 130;

/** Street-comparison cache follows the same quarterly rhythm. */
const DEALS_CACHE_STALE_AFTER_DAYS = 130;

/**
 * Same idea for COLLECTION, with a longer allowance.
 *
 * This is the check that would have caught the failure it was written after: for
 * a while only the cleaning pipeline was scheduled, so this endpoint reported a
 * healthy nightly run every night while not one new transaction had entered the
 * database in weeks. "The pipeline ran" and "the data is current" are different
 * claims, and only one of them was being made.
 *
 * 50h rather than 36: collection talks to third-party government hosts, and one
 * missed night is ordinary. Two is a pattern.
 */
const COLLECT_STALE_AFTER_HOURS = 50;

interface CollectionRunRow {
  started_at: string;
  finished_at: string | null;
  status: string;
  reachability: string | null;
}

interface PipelineRunRow {
  started_at: string;
  finished_at: string | null;
  status: string;
  failed_stage: string | null;
}

function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

export async function GET() {
  // problems ⇒ unhealthy (503): the site or its core data is actually broken.
  // warnings ⇒ degraded (200): worth an operator's glance, users unaffected.
  const problems: string[] = [];
  const warnings: string[] = [];

  // ── reference-year staleness ─────────────────────────────────────
  // ref_year (admin rule) is the honest endpoint of every trend window on the
  // site — the last FULL calendar year. It is bumped by hand once a year, and
  // nothing used to notice when it lagged: every price-change figure quietly
  // ended a year early. The external monitor on this endpoint now does.
  try {
    const expected = new Date().getFullYear() - 1;
    const ry = refYear();
    if (ry < expected) {
      problems.push(`ref_year is ${ry} but ${expected} is complete — bump it in the admin panel after the quarterly data refresh`);
    }
  } catch { /* rules table absent on a fresh machine — nothing to report */ }

  // ── last pipeline run ────────────────────────────────────────────
  let lastRun: PipelineRunRow | null = null;
  try {
    lastRun = appDb().prepare(
      `SELECT started_at, finished_at, status, failed_stage FROM pipeline_runs
        WHERE status = 'ok' ORDER BY id DESC LIMIT 1`
    ).get() as PipelineRunRow | undefined ?? null;
  } catch {
    // table absent = the pipeline has never run through scripts/pipeline.ts
  }

  let lastFailure: PipelineRunRow | null = null;
  try {
    lastFailure = appDb().prepare(
      `SELECT started_at, finished_at, status, failed_stage FROM pipeline_runs
        WHERE status IN ('failed','gate-failed') ORDER BY id DESC LIMIT 1`
    ).get() as PipelineRunRow | undefined ?? null;
  } catch { /* same */ }

  const ageHours = hoursSince(lastRun?.finished_at ?? lastRun?.started_at);
  if (ageHours == null) problems.push("no successful pipeline run recorded");
  else if (ageHours > STALE_AFTER_HOURS) problems.push(`last successful run ${ageHours.toFixed(1)}h ago`);

  // A failure NEWER than the last success means the most recent attempt broke.
  if (lastFailure) {
    const failAge = hoursSince(lastFailure.finished_at ?? lastFailure.started_at);
    if (failAge != null && (ageHours == null || failAge < ageHours)) {
      problems.push(`most recent run ${lastFailure.status} at stage "${lastFailure.failed_stage ?? "?"}"`);
    }
  }

  // ── last collection run ──────────────────────────────────────────
  let lastCollect: CollectionRunRow | null = null;
  let sourceStates: Array<{ source: string; status: string; at: string }> = [];
  try {
    lastCollect = appDb().prepare(
      `SELECT started_at, finished_at, status, reachability FROM collection_runs
        WHERE status IN ('ok','partial') ORDER BY id DESC LIMIT 1`
    ).get() as CollectionRunRow | undefined ?? null;

    // Latest outcome per source. A source that has been failing for a week while
    // the others succeed keeps the run "partial" — green enough to ignore — so
    // the per-source state has to be visible, not just the aggregate.
    sourceStates = appDb().prepare(
      `SELECT source, status, started_at AS at FROM collection_source_runs
        WHERE id IN (SELECT MAX(id) FROM collection_source_runs GROUP BY source)
        ORDER BY source`
    ).all() as Array<{ source: string; status: string; at: string }>;
  } catch {
    // table absent = scripts/collect.ts has never run on this machine
  }

  const collectAgeHours = hoursSince(lastCollect?.finished_at ?? lastCollect?.started_at);
  if (collectAgeHours == null) problems.push("no collection run recorded — new data is NOT being fetched");
  else if (collectAgeHours > COLLECT_STALE_AFTER_HOURS) problems.push(`last collection ${collectAgeHours.toFixed(1)}h ago`);

  // Last SUCCESS per source — the number the aggregate hides. A source can be
  // "skipped" every night for months and the run still reads ok/partial.
  let lastSuccessBySource: Array<{ source: string; at: string }> = [];
  try {
    lastSuccessBySource = appDb().prepare(
      `SELECT source, MAX(started_at) AS at FROM collection_source_runs
        WHERE status = 'ok' GROUP BY source ORDER BY source`
    ).all() as Array<{ source: string; at: string }>;
  } catch { /* table absent — reported above */ }

  // A hard failure is a problem anywhere. An unreachable source is a problem
  // only when the server SHOULD be able to reach it; the geo-restricted ones
  // are refreshed from the operator's machine and land here as a warning.
  // skipped-browser counts with skipped-unreachable: Chrome is deliberately
  // absent on the server, so for a geo-restricted source it is the same
  // "waiting for the quarterly refresh" state.
  const hardFailed = sourceStates.filter((s) => s.status === "failed");
  const unreachable = sourceStates.filter((s) => s.status === "skipped-unreachable" || s.status === "skipped-browser");
  const unexpectedUnreachable = unreachable.filter((s) => !GEO_RESTRICTED_SOURCES.has(s.source));
  const expectedUnreachable = unreachable.filter((s) => GEO_RESTRICTED_SOURCES.has(s.source));

  if (hardFailed.length) problems.push(`sources failing: ${hardFailed.map((s) => s.source).join(", ")}`);
  if (unexpectedUnreachable.length) problems.push(`sources unreachable from the server: ${unexpectedUnreachable.map((s) => s.source).join(", ")}`);
  if (expectedUnreachable.length) warnings.push(`geo-restricted sources waiting for the quarterly refresh: ${expectedUnreachable.map((s) => s.source).join(", ")}`);

  // ── data volume ──────────────────────────────────────────────────
  let dealCount: number | null = null;
  let statRows: number | null = null;
  let latestDealDate: string | null = null;
  try {
    const [d] = await prisma.$queryRawUnsafe<Array<{ n: bigint; maxd: string | null }>>(
      "SELECT COUNT(*) n, MAX(deal_date) maxd FROM nadlan_transactions WHERE COALESCE(excluded,0)=0"
    );
    dealCount = Number(d?.n ?? 0);
    latestDealDate = d?.maxd ?? null;
    const [s] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      "SELECT COUNT(*) n FROM nadlan_year_room_stats"
    );
    statRows = Number(s?.n ?? 0);
  } catch (e) {
    problems.push(`database unreadable: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`);
  }

  // An empty stats table is the signature of the exact failure the atomic swap
  // was written to prevent — worth calling out explicitly rather than as a number.
  if (statRows === 0) problems.push("nadlan_year_room_stats is EMPTY — price series will render blank");

  // ── quarterly-refresh freshness (data SLA, not server health) ────
  const latestDealAgeDays = (() => {
    if (!latestDealDate) return null;
    const t = Date.parse(latestDealDate);
    return Number.isFinite(t) ? (Date.now() - t) / 86_400_000 : null;
  })();
  if (latestDealAgeDays != null && latestDealAgeDays > TRANSACTIONS_STALE_AFTER_DAYS) {
    warnings.push(`latest transaction is ${Math.round(latestDealAgeDays)} days old — time for the quarterly refresh from the operator's machine`);
  }

  const deals = cacheStats();
  const cacheAgeDays = (() => {
    if (!deals.newestAt) return null;
    const t = Date.parse(deals.newestAt);
    return Number.isFinite(t) ? (Date.now() - t) / 86_400_000 : null;
  })();
  if (deals.files === 0) {
    warnings.push("deals_cache is empty — street comparison panels will show their empty state");
  } else if (cacheAgeDays != null && cacheAgeDays > DEALS_CACHE_STALE_AFTER_DAYS) {
    warnings.push(`deals_cache newest file is ${Math.round(cacheAgeDays)} days old`);
  }

  // healthy — all green. degraded — users fine, operator should glance.
  // unhealthy — the monitor should page someone.
  const ok = problems.length === 0;
  const level = !ok ? "unhealthy" : warnings.length ? "degraded" : "healthy";
  return NextResponse.json(
    {
      ok,
      level,
      at: new Date().toISOString(),
      problems,
      warnings,
      pipeline: {
        lastSuccessAt: lastRun?.finished_at ?? lastRun?.started_at ?? null,
        ageHours: ageHours != null ? Number(ageHours.toFixed(2)) : null,
        staleAfterHours: STALE_AFTER_HOURS,
        lastFailure: lastFailure
          ? { at: lastFailure.finished_at ?? lastFailure.started_at, status: lastFailure.status, stage: lastFailure.failed_stage }
          : null,
      },
      collection: {
        lastRunAt: lastCollect?.finished_at ?? lastCollect?.started_at ?? null,
        ageHours: collectAgeHours != null ? Number(collectAgeHours.toFixed(2)) : null,
        staleAfterHours: COLLECT_STALE_AFTER_HOURS,
        status: lastCollect?.status ?? null,
        reachability: lastCollect?.reachability ?? null,
        sources: sourceStates,
        lastSuccessBySource,
      },
      data: {
        dealCount,
        statRows,
        latestDealDate,
        latestDealAgeDays: latestDealAgeDays != null ? Math.round(latestDealAgeDays) : null,
        transactionsStaleAfterDays: TRANSACTIONS_STALE_AFTER_DAYS,
      },
      dealsCache: {
        files: deals.files,
        newestAt: deals.newestAt,
        ageDays: cacheAgeDays != null ? Math.round(cacheAgeDays) : null,
        staleAfterDays: DEALS_CACHE_STALE_AFTER_DAYS,
      },
    },
    // Non-200 ONLY on core failure, so a monitor can alert on the status code
    // alone. Degraded (external source blocked, data aging toward its
    // quarterly refresh) is 200: users are being served, nobody should be
    // paged, and a permanently-red monitor teaches everyone to ignore red.
    { status: ok ? 200 : 503 }
  );
}
