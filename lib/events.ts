import { appDb } from "./appDb";

/**
 * First-party event log.
 *
 * WHY IT SHIPS WITH THE LAUNCH RATHER THAN AFTER IT
 * Behavioural data cannot be collected retroactively. The first weeks after the
 * site is handed to an audience are the only chance to see how people actually
 * use it before it is reshaped around that use — and they are exactly the weeks
 * when it is most tempting to postpone instrumentation. So this ships with the
 * launch, deliberately small.
 *
 * THE MOST VALUABLE EVENT HERE IS `search_no_results`. Everything else measures
 * what the site already does; that one measures what people came for and did
 * not find. It is the cheapest source of a roadmap there is.
 *
 * PRIVACY POSTURE — this stays boring on purpose:
 *   - no IP address, no user-agent string, no account id, no cookie
 *   - the session id is a random per-tab value from sessionStorage; it exists
 *     to group events within one visit and is gone when the tab closes
 *   - free text is only ever the user's own search terms, truncated
 * The result is data that answers product questions without building a profile.
 * If that changes, the privacy policy has to change with it — that is the line.
 */

export type EventName =
  | "page_view"
  | "search"
  /** a search that matched nothing — the single most actionable signal here */
  | "search_no_results"
  | "chart_action"
  | "drill_down"
  | "compare_select"
  | "feedback_open";

export const EVENT_NAMES: readonly EventName[] = [
  "page_view", "search", "search_no_results",
  "chart_action", "drill_down", "compare_select", "feedback_open",
] as const;

export interface EventInput {
  name: EventName;
  /** page path the event happened on, base path already stripped */
  path?: string | null;
  /** city, metric or ranking the event refers to */
  subject?: string | null;
  /** free-form small detail: the series toggled, the search term, the year opened */
  detail?: string | null;
  /** random per-tab id, groups a visit; NOT an account or a device id */
  sessionId?: string | null;
}

let ensured = false;
function ensureTable() {
  if (ensured) return;
  appDb().exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT,
      subject TEXT,
      detail TEXT,
      session_id TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_events_name_created ON events(name, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
  `);
  ensured = true;
}

const trim = (v: string | null | undefined, max: number): string | null => {
  const s = (v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Record one event. Never throws: analytics failing must never break a page.
 * Returns whether it was written, so a caller can surface it in tests.
 */
export function recordEvent(e: EventInput): boolean {
  try {
    if (!EVENT_NAMES.includes(e.name)) return false;
    ensureTable();
    appDb().prepare(
      "INSERT INTO events (name, path, subject, detail, session_id) VALUES (?, ?, ?, ?, ?)"
    ).run(
      e.name,
      trim(e.path, 300),
      trim(e.subject, 120),
      trim(e.detail, 200),
      trim(e.sessionId, 64)
    );
    return true;
  } catch {
    return false;
  }
}

export interface EventSummaryRow { name: string; n: number }

/** Event counts over a window — the shape the admin dashboard needs. */
export function eventCounts(days = 7): EventSummaryRow[] {
  try {
    ensureTable();
    return appDb().prepare(
      `SELECT name, COUNT(*) n FROM events
        WHERE created_at >= datetime('now', ?)
        GROUP BY name ORDER BY n DESC`
    ).all(`-${Math.max(1, Math.min(365, days))} days`) as EventSummaryRow[];
  } catch {
    return [];
  }
}

/**
 * What people searched for and did not find, most frequent first.
 * This is the query worth reading every week.
 */
export function topMisses(days = 30, limit = 50): Array<{ term: string; n: number }> {
  try {
    ensureTable();
    return appDb().prepare(
      `SELECT detail term, COUNT(*) n FROM events
        WHERE name = 'search_no_results' AND detail IS NOT NULL
          AND created_at >= datetime('now', ?)
        GROUP BY detail ORDER BY n DESC LIMIT ?`
    ).all(`-${Math.max(1, Math.min(365, days))} days`, limit) as Array<{ term: string; n: number }>;
  } catch {
    return [];
  }
}

/** Delete events older than `days`. The log is for trends, not for history. */
export function pruneEvents(days = 180): number {
  try {
    ensureTable();
    const r = appDb().prepare(
      "DELETE FROM events WHERE created_at < datetime('now', ?)"
    ).run(`-${Math.max(1, days)} days`);
    return r.changes ?? 0;
  } catch {
    return 0;
  }
}
