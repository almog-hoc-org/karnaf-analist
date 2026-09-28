#!/usr/bin/env tsx
/**
 * Gather the weekly operator report and email it (lib/opsReport.ts formats it).
 *
 * Run: npx tsx scripts/send-ops-report.ts             (sends)
 *      npx tsx scripts/send-ops-report.ts --dry-run   (prints, sends nothing)
 *
 * Scheduled by deploy/karnaf-ops-report.timer (Sunday 07:00 Israel time).
 * Reads only: the event log, users, the credits ledger and feedback in app.db,
 * and /api/status from the running app for health. Every block is guarded, so
 * a missing table on a fresh machine yields a thinner report, never no report.
 */
import { appDb } from "../lib/appDb";
import { creditEconomy, topMisses, usageSummary } from "../lib/events";
import { buildOpsReport, type OpsSnapshot } from "../lib/opsReport";
import { sendOperatorEmail } from "../lib/notify";

const dry = process.argv.includes("--dry-run");
const BASE = `http://127.0.0.1:3000${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;

function one<T>(sql: string, ...args: unknown[]): T | null {
  try { return (appDb().prepare(sql).get(...(args as never[])) as T) ?? null; } catch { return null; }
}
function all<T>(sql: string, ...args: unknown[]): T[] {
  try { return appDb().prepare(sql).all(...(args as never[])) as T[]; } catch { return []; }
}
const n = (v: unknown) => Number(v ?? 0) || 0;
const eventCount = (name: string, days: number, where = "") =>
  n(one<{ c: number }>(`SELECT COUNT(*) c FROM events WHERE name=? AND created_at >= datetime('now', ?) ${where}`, name, `-${days} days`)?.c);

async function health(): Promise<OpsSnapshot["health"]> {
  const empty: OpsSnapshot["health"] = {
    httpOk: null, problems: [], warnings: [], latestDealDate: null,
    latestDealAgeDays: null, pipelineAgeHours: null, collectionAgeHours: null,
  };
  try {
    const res = await fetch(`${BASE}/api/status`, { signal: AbortSignal.timeout(20_000) });
    const j = await res.json() as {
      problems?: string[]; warnings?: string[];
      pipeline?: { ageHours?: number | null }; collection?: { ageHours?: number | null };
      data?: { latestDealDate?: string | null; latestDealAgeDays?: number | null };
    };
    return {
      httpOk: res.ok,
      problems: j.problems ?? [],
      warnings: j.warnings ?? [],
      latestDealDate: j.data?.latestDealDate ?? null,
      latestDealAgeDays: j.data?.latestDealAgeDays ?? null,
      pipelineAgeHours: j.pipeline?.ageHours ?? null,
      collectionAgeHours: j.collection?.ageHours ?? null,
    };
  } catch (e) {
    return { ...empty, httpOk: false, problems: [`/api/status לא ענה: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

async function main() {
  const u = usageSummary(7);
  const c30 = creditEconomy(30);
  const snap: OpsSnapshot = {
    generatedAt: new Date().toISOString(),
    health: await health(),
    users: {
      total: n(one<{ c: number }>("SELECT COUNT(*) c FROM users")?.c),
      new7: n(one<{ c: number }>("SELECT COUNT(*) c FROM users WHERE created_at >= datetime('now','-7 days')")?.c),
      new30: n(one<{ c: number }>("SELECT COUNT(*) c FROM users WHERE created_at >= datetime('now','-30 days')")?.c),
      consenting: n(one<{ c: number }>("SELECT COUNT(*) c FROM users WHERE mailing_consent=1")?.c),
      referred30: n(one<{ c: number }>("SELECT COUNT(*) c FROM users WHERE referred_by IS NOT NULL AND created_at >= datetime('now','-30 days')")?.c),
    },
    usage7: { sessions: u.sessions, signedInUsers: u.signedInUsers, pageViews: u.pageViews },
    funnel7: {
      checks: eventCount("page_view", 7, "AND path = '/check'"),
      // no event marks a verdict yet (plan phase 5e adds check_verdict)
      verdicts: eventCount("check_verdict", 7),
      unlocks: eventCount("unlock_done", 7),
      signups: n(one<{ c: number }>("SELECT COUNT(*) c FROM users WHERE created_at >= datetime('now','-7 days')")?.c),
      shares: eventCount("share_click", 7),
    },
    credits: { granted30: c30.granted, spent30: c30.spent, outstanding: c30.outstanding, usersWithBalance: c30.usersWithBalance },
    search7: {
      searches: eventCount("search", 7),
      misses: eventCount("search_no_results", 7),
      topMisses: topMisses(7, 10),
    },
    feedbackOpen: all<{ id: number; kind: string; city: string | null; message: string; created_at: string }>(
      "SELECT id, kind, city, message, created_at FROM feedback WHERE approved_at IS NULL AND created_at >= datetime('now','-60 days') ORDER BY id DESC LIMIT 10"
    ).map((f) => ({ id: f.id, kind: f.kind, city: f.city, message: f.message, createdAt: f.created_at })),
    topCities7: all<{ city: string; n: number }>(
      `SELECT subject city, COUNT(*) n FROM events
        WHERE name='page_view' AND path LIKE '/city/%' AND subject IS NOT NULL
          AND created_at >= datetime('now','-7 days')
        GROUP BY subject ORDER BY n DESC LIMIT 10`
    ),
  };

  const r = buildOpsReport(snap);
  if (dry) {
    console.log(`${r.subject}\n\n${r.text}`);
    return;
  }
  const res = await sendOperatorEmail(r.subject, r.html, r.text);
  if (!res.sent) process.exitCode = res.reason?.includes("not set") ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
