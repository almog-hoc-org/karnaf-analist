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
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appDb } from "@/lib/appDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Hours after which the data is considered stale. Nightly pipeline ⇒ 36h allows one missed run. */
const STALE_AFTER_HOURS = 36;

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
  const problems: string[] = [];

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

  const failingSources = sourceStates.filter((s) => s.status === "failed" || s.status === "skipped-unreachable");
  if (failingSources.length) problems.push(`sources not collecting: ${failingSources.map((s) => s.source).join(", ")}`);

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

  const ok = problems.length === 0;
  return NextResponse.json(
    {
      ok,
      at: new Date().toISOString(),
      problems,
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
      },
      data: { dealCount, statRows, latestDealDate },
    },
    // Non-200 on trouble so a monitor can alert on the status code alone,
    // without parsing the body.
    { status: ok ? 200 : 503 }
  );
}
