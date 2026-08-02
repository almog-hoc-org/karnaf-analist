/**
 * Background refresh job — decouples the (long) scan from the HTTP request.
 *
 * The old route ran the generator INSIDE the response stream: closing the tab
 * killed the scan, and route maxDuration capped it at 60s while a full
 * catch-up scan can take minutes. Now POST /api/refresh-data just STARTS the
 * job here; the job keeps running server-side to completion regardless of who
 * is watching, appending events to an in-memory buffer + data/refresh_progress.json.
 * Any number of clients can replay/follow the buffer live.
 */
import fs from "fs";
import path from "path";
import { refreshDataStream, type RefreshEvent } from "./data-refresh";

const PROGRESS_FILE = path.resolve(process.cwd(), "data", "refresh_progress.json");

export interface RefreshJobState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  events: RefreshEvent[];
}

// Next.js dev may load this module in several bundles — pin the singleton on
// globalThis so every route instance sees the SAME job.
const g = globalThis as unknown as { __karnafRefreshJob?: RefreshJobState };
if (!g.__karnafRefreshJob) {
  g.__karnafRefreshJob = { running: false, startedAt: null, finishedAt: null, events: [] };
}
const job = g.__karnafRefreshJob;

export function getRefreshJob(): RefreshJobState {
  return job;
}

function persistProgress() {
  try {
    fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ ...job, events: job.events.slice(-200) }, null, 2), "utf-8");
  } catch { /* progress file is best-effort */ }
}

/** Start the scan if idle. Returns false when one is already running. */
export function startRefreshJob(): boolean {
  if (job.running) return false;
  job.running = true;
  job.startedAt = new Date().toISOString();
  job.finishedAt = null;
  job.events = [];
  void (async () => {
    try {
      for await (const event of refreshDataStream()) {
        job.events.push(event);
        if (job.events.length % 5 === 0) persistProgress();
      }
    } catch (err) {
      job.events.push({
        type: "error",
        message: `שגיאה כללית: ${err instanceof Error ? err.message : String(err)}`,
      });
      job.events.push({ type: "done", message: "done" });
    } finally {
      job.running = false;
      job.finishedAt = new Date().toISOString();
      persistProgress();
    }
  })();
  return true;
}
