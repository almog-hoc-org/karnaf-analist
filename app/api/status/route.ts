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
      data: { dealCount, statRows, latestDealDate },
    },
    // Non-200 on trouble so a monitor can alert on the status code alone,
    // without parsing the body.
    { status: ok ? 200 : 503 }
  );
}
