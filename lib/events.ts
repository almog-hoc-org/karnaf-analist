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
 * PRIVACY POSTURE — narrower than most analytics, and no longer anonymous
 * for signed-in visitors. The operator asked (8/2026) to see usage per user,
 * which is a real change of posture and is written down here rather than
 * discovered later from the schema:
 *   - NO IP address and NO user-agent string, ever
 *   - `user_id` is attached ONLY for a signed-in account, and only by the
 *     server from the session cookie — never accepted from the client, which
 *     could otherwise claim to be anyone
 *   - `device` is a three-way bucket (mobile/tablet/desktop) derived in the
 *     browser. The bucket, not the user-agent: it answers "does the site need
 *     to work on a phone" without contributing to a fingerprint
 *   - anonymous visitors keep the old posture exactly — a random per-tab id
 *     that dies with the tab, and nothing else
 *   - free text is only ever the user's own search terms, truncated
 *
 * The privacy notice (lib/legal.ts → app/privacy) states this, because a
 * policy that describes the previous version of the schema is worse than no
 * policy. Changing what is collected here means changing that page too.
 */

export type EventName =
  | "page_view"
  /** fired on leaving a page, carrying how long it was open (dwell_ms) */
  | "page_leave"
  | "search"
  /** a search that matched nothing — the single most actionable signal here */
  | "search_no_results"
  | "chart_action"
  | "drill_down"
  | "compare_select"
  | "feedback_open"
  | "feedback_submit"
  | "unlock_prompt_seen"
  | "unlock_done"
  | "share_click"
  | "follow_city_click"
  | "no_result_suggestion_click";

export const EVENT_NAMES: readonly EventName[] = [
  "page_view", "page_leave", "search", "search_no_results",
  "chart_action", "drill_down", "compare_select", "feedback_open",
  "feedback_submit", "unlock_prompt_seen", "unlock_done",
  "share_click", "follow_city_click", "no_result_suggestion_click",
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
  /** 'mobile' | 'tablet' | 'desktop' — the bucket, never the user-agent */
  device?: string | null;
  /** milliseconds the page was open; only on page_leave */
  dwellMs?: number | null;
  /**
   * Signed-in account. Set by the API route from the session cookie — a value
   * arriving from the client is ignored, or anyone could write events as
   * anyone.
   */
  userId?: number | null;
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
  // Columns added after the table shipped. ALTER TABLE ADD COLUMN on an
  // existing column throws, and there is no IF NOT EXISTS for it, so each one
  // is attempted and its "duplicate column" error swallowed — the cheapest
  // migration that is correct on both a fresh and an existing database.
  for (const ddl of [
    "ALTER TABLE events ADD COLUMN user_id INTEGER",
    "ALTER TABLE events ADD COLUMN device TEXT",
    "ALTER TABLE events ADD COLUMN dwell_ms INTEGER",
  ]) {
    try { appDb().exec(ddl); } catch { /* already present */ }
  }
  try {
    appDb().exec("CREATE INDEX IF NOT EXISTS idx_events_user_created ON events(user_id, created_at DESC)");
  } catch { /* index is an optimisation, never a requirement */ }
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
    // Dwell is clamped rather than trusted: a tab left open overnight would
    // otherwise put a 14-hour "page view" into every average and quietly make
    // the whole panel useless. 30 minutes is well past any real read.
    const dwell = e.dwellMs == null || !Number.isFinite(e.dwellMs)
      ? null
      : Math.max(0, Math.min(30 * 60_000, Math.round(e.dwellMs)));
    const device = ["mobile", "tablet", "desktop"].includes(String(e.device)) ? String(e.device) : null;
    appDb().prepare(
      "INSERT INTO events (name, path, subject, detail, session_id, user_id, device, dwell_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      e.name,
      trim(e.path, 300),
      trim(e.subject, 120),
      trim(e.detail, 200),
      trim(e.sessionId, 64),
      e.userId != null && Number.isInteger(e.userId) ? e.userId : null,
      device,
      dwell
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Distinct visit count for a window. A "visit" is one browser TAB session
 * (random per-tab id, gone when the tab closes) — closest first-party
 * analogue to an analytics "session". It is NOT unique people: the same
 * person tomorrow, or in a second tab, counts again. Events recorded
 * without a session id (very old rows, storage-blocked browsers) are
 * excluded rather than miscounted as one giant visitor.
 */
export function uniqueSessions(days = 7): number {
  try {
    ensureTable();
    const row = appDb().prepare(
      `SELECT COUNT(DISTINCT session_id) n FROM events
        WHERE session_id IS NOT NULL AND created_at >= datetime('now', ?)`
    ).get(`-${Math.max(1, Math.floor(days))} days`) as { n: number };
    return row.n;
  } catch { return 0; }
}

/** When collection started — the honest denominator for every window shown. */
export function firstEventAt(): string | null {
  try {
    ensureTable();
    const row = appDb().prepare("SELECT MIN(created_at) t FROM events").get() as { t: string | null };
    return row.t;
  } catch { return null; }
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

/* ── per-user usage (operator request 8/2026) ────────────────────────────────
 *
 * Everything below reads the SAME event log, grouped by account instead of in
 * aggregate. Anonymous rows carry no user_id and never appear in these — the
 * per-user views describe registered users only, which is both the question
 * that was asked and the narrower answer.
 *
 * Time on a page comes from page_leave.dwell_ms, already clamped on write.
 * "Time on site" is the SUM of those dwells, not last-event-minus-first: the
 * difference matters for a tab left open, where the subtraction says four
 * hours and the sum says the eleven minutes someone actually read.
 */

const win = (days: number) => `-${Math.max(1, Math.min(365, Math.floor(days)))} days`;

export interface UsageSummary {
  sessions: number;
  pageViews: number;
  /** seconds, summed dwell across all page_leave events */
  totalSeconds: number;
  /** seconds per session, averaged over sessions that reported any dwell */
  avgSessionSeconds: number;
  signedInUsers: number;
  devices: Array<{ device: string; sessions: number }>;
}

export function usageSummary(days = 30): UsageSummary {
  const empty: UsageSummary = {
    sessions: 0, pageViews: 0, totalSeconds: 0, avgSessionSeconds: 0,
    signedInUsers: 0, devices: [],
  };
  try {
    ensureTable();
    const db = appDb();
    const w = win(days);
    const base = db.prepare(
      `SELECT COUNT(DISTINCT session_id) sessions,
              SUM(CASE WHEN name='page_view' THEN 1 ELSE 0 END) views,
              COALESCE(SUM(dwell_ms), 0) dwell,
              COUNT(DISTINCT user_id) users
         FROM events WHERE created_at >= datetime('now', ?)`
    ).get(w) as { sessions: number; views: number; dwell: number; users: number };

    // Averaged over sessions that actually reported time, not over all
    // sessions: a bounce that never fired page_leave would otherwise drag the
    // average toward zero and make every real read look shorter than it was.
    const timed = db.prepare(
      `SELECT COUNT(DISTINCT session_id) n FROM events
        WHERE dwell_ms IS NOT NULL AND session_id IS NOT NULL
          AND created_at >= datetime('now', ?)`
    ).get(w) as { n: number };

    const devices = db.prepare(
      `SELECT device, COUNT(DISTINCT session_id) sessions FROM events
        WHERE device IS NOT NULL AND created_at >= datetime('now', ?)
        GROUP BY device ORDER BY sessions DESC`
    ).all(w) as Array<{ device: string; sessions: number }>;

    const totalSeconds = Math.round(Number(base.dwell || 0) / 1000);
    return {
      sessions: Number(base.sessions || 0),
      pageViews: Number(base.views || 0),
      totalSeconds,
      avgSessionSeconds: timed.n ? Math.round(totalSeconds / timed.n) : 0,
      signedInUsers: Number(base.users || 0),
      devices,
    };
  } catch { return empty; }
}

export interface UsagePageRow { path: string; views: number; avgSeconds: number; totalSeconds: number }

/** Most-visited paths, with how long people stay on each. */
export function topPages(days = 30, limit = 25): UsagePageRow[] {
  try {
    ensureTable();
    return (appDb().prepare(
      `SELECT path,
              SUM(CASE WHEN name='page_view' THEN 1 ELSE 0 END) views,
              COALESCE(SUM(dwell_ms), 0) dwell,
              SUM(CASE WHEN dwell_ms IS NOT NULL THEN 1 ELSE 0 END) timed
         FROM events
        WHERE path IS NOT NULL AND created_at >= datetime('now', ?)
        GROUP BY path ORDER BY views DESC, dwell DESC LIMIT ?`
    ).all(win(days), limit) as Array<{ path: string; views: number; dwell: number; timed: number }>)
      .map((r) => ({
        path: r.path,
        views: Number(r.views || 0),
        totalSeconds: Math.round(Number(r.dwell || 0) / 1000),
        avgSeconds: r.timed ? Math.round(Number(r.dwell) / r.timed / 1000) : 0,
      }));
  } catch { return []; }
}

/** What people searched for — found or not. `misses` is the subset that failed. */
export function topSearches(days = 30, limit = 25): Array<{ term: string; n: number; misses: number }> {
  try {
    ensureTable();
    return appDb().prepare(
      `SELECT detail term, COUNT(*) n,
              SUM(CASE WHEN name='search_no_results' THEN 1 ELSE 0 END) misses
         FROM events
        WHERE name IN ('search','search_no_results') AND detail IS NOT NULL
          AND created_at >= datetime('now', ?)
        GROUP BY detail ORDER BY n DESC LIMIT ?`
    ).all(win(days), limit) as Array<{ term: string; n: number; misses: number }>;
  } catch { return []; }
}

export interface UserUsageRow {
  userId: number;
  email: string;
  name: string;
  sessions: number;
  pageViews: number;
  totalSeconds: number;
  searches: number;
  /** the device bucket this user used most */
  device: string | null;
  lastSeen: string | null;
}

/** One row per registered user who did anything in the window, busiest first. */
export function usageByUser(days = 30, limit = 200): UserUsageRow[] {
  try {
    ensureTable();
    return (appDb().prepare(
      `SELECT e.user_id userId, u.email, u.name,
              COUNT(DISTINCT e.session_id) sessions,
              SUM(CASE WHEN e.name='page_view' THEN 1 ELSE 0 END) pageViews,
              COALESCE(SUM(e.dwell_ms), 0) dwell,
              SUM(CASE WHEN e.name IN ('search','search_no_results') THEN 1 ELSE 0 END) searches,
              (SELECT device FROM events d
                WHERE d.user_id = e.user_id AND d.device IS NOT NULL
                GROUP BY d.device ORDER BY COUNT(*) DESC LIMIT 1) device,
              MAX(e.created_at) lastSeen
         FROM events e JOIN users u ON u.id = e.user_id
        WHERE e.user_id IS NOT NULL AND e.created_at >= datetime('now', ?)
        GROUP BY e.user_id ORDER BY dwell DESC, pageViews DESC LIMIT ?`
    ).all(win(days), limit) as Array<UserUsageRow & { dwell: number }>)
      .map((r) => ({ ...r, totalSeconds: Math.round(Number(r.dwell || 0) / 1000) }));
  } catch { return []; }
}

export interface UserUsageDetail {
  pages: UsagePageRow[];
  searches: Array<{ term: string; n: number; found: boolean }>;
  devices: Array<{ device: string; n: number }>;
}

/** The drill-down for one user: which pages, how long on each, what they searched. */
export function userUsageDetail(userId: number, days = 30): UserUsageDetail {
  const empty: UserUsageDetail = { pages: [], searches: [], devices: [] };
  try {
    ensureTable();
    const db = appDb();
    const w = win(days);
    const pages = (db.prepare(
      `SELECT path,
              SUM(CASE WHEN name='page_view' THEN 1 ELSE 0 END) views,
              COALESCE(SUM(dwell_ms), 0) dwell,
              SUM(CASE WHEN dwell_ms IS NOT NULL THEN 1 ELSE 0 END) timed
         FROM events
        WHERE user_id = ? AND path IS NOT NULL AND created_at >= datetime('now', ?)
        GROUP BY path ORDER BY dwell DESC, views DESC LIMIT 50`
    ).all(userId, w) as Array<{ path: string; views: number; dwell: number; timed: number }>)
      .map((r) => ({
        path: r.path,
        views: Number(r.views || 0),
        totalSeconds: Math.round(Number(r.dwell || 0) / 1000),
        avgSeconds: r.timed ? Math.round(Number(r.dwell) / r.timed / 1000) : 0,
      }));

    const searches = (db.prepare(
      `SELECT detail term, COUNT(*) n,
              SUM(CASE WHEN name='search_no_results' THEN 1 ELSE 0 END) misses
         FROM events
        WHERE user_id = ? AND name IN ('search','search_no_results') AND detail IS NOT NULL
          AND created_at >= datetime('now', ?)
        GROUP BY detail ORDER BY n DESC LIMIT 50`
    ).all(userId, w) as Array<{ term: string; n: number; misses: number }>)
      .map((r) => ({ term: r.term, n: Number(r.n), found: Number(r.misses) === 0 }));

    const devices = db.prepare(
      `SELECT device, COUNT(*) n FROM events
        WHERE user_id = ? AND device IS NOT NULL AND created_at >= datetime('now', ?)
        GROUP BY device ORDER BY n DESC`
    ).all(userId, w) as Array<{ device: string; n: number }>;

    return { pages, searches, devices };
  } catch { return empty; }
}
