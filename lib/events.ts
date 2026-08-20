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
  | "no_result_suggestion_click"
  /* ── the usage dashboard's own events (operator request 8/2026) ──────────
   * Each one exists because a specific question could not be answered without
   * it. Nothing here was added "while we're at it".
   */
  /** first event of a visit — subject = referring DOMAIN, detail = landing path */
  | "session_start"
  /** a click on one of a closed list of buttons — subject = the button */
  | "cta_click"
  /** 3+ clicks on one element inside 1.5s: "looks clickable and isn't" */
  | "rage_click"
  /**
   * 25/50/75/100 — once per threshold per view.
   * SUPERSEDED by `page_depth`, which carries the exact maximum and from which
   * this curve is derivable. Kept in the union so the rows already collected
   * stay readable rather than being orphaned by a rename.
   */
  | "scroll_depth"
  /** exact % of the page height reached, once on leave — replaces scroll_depth */
  | "page_depth"
  /** % of the page visible with no scrolling; subject = device bucket */
  | "fold_view"
  /** time a marked section of a page was actually on screen; subject = section */
  | "section_view"
  /** one real-user speed measurement; subject = LCP/INP/CLS, detail = value */
  | "web_vital"
  /** a visitor saw an error screen — subject = path, detail = short digest */
  | "error_shown"
  /** a search that ended in actually choosing a city */
  | "search_select";

export const EVENT_NAMES: readonly EventName[] = [
  "page_view", "page_leave", "search", "search_no_results",
  "chart_action", "drill_down", "compare_select", "feedback_open",
  "feedback_submit", "unlock_prompt_seen", "unlock_done",
  "share_click", "follow_city_click", "no_result_suggestion_click",
  "session_start", "cta_click", "rage_click",
  "scroll_depth", "page_depth", "fold_view", "section_view", "web_vital",
  "error_shown", "search_select",
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
  /**
   * Random per-BROWSER id from localStorage, expiring after 180 days.
   * The only thing that can tell "one person came back" from "two people came
   * once". Not a fingerprint, not a cookie, not linked to an identity — see
   * the note in lib/track.ts.
   */
  visitorId?: string | null;
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
/**
 * Create the events table and apply its column migrations.
 *
 * Exported because the nightly roll-up (lib/usageRollup.ts) READS this table
 * from a process that never serves a page — so nothing had guaranteed the
 * later columns existed there. On a database where the web app had not yet
 * run, the roll-up died on "no such column: dwell_ms" and took the pipeline
 * stage with it. The reader of a schema is entitled to ensure it.
 */
export function ensureEventSchema() { ensureTable(); }

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
    "ALTER TABLE events ADD COLUMN visitor_id TEXT",
  ]) {
    try { appDb().exec(ddl); } catch { /* already present */ }
  }
  try {
    appDb().exec("CREATE INDEX IF NOT EXISTS idx_events_user_created ON events(user_id, created_at DESC)");
    // Exit points, landing pages and bounce are all "first/last row per
    // session" questions. Without this they are a full scan of the log per
    // panel load, which is what would make the usage tab the slow one.
    appDb().exec("CREATE INDEX IF NOT EXISTS idx_events_session_created ON events(session_id, created_at)");
    appDb().exec("CREATE INDEX IF NOT EXISTS idx_events_visitor_created ON events(visitor_id, created_at)");
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
      "INSERT INTO events (name, path, subject, detail, session_id, visitor_id, user_id, device, dwell_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      e.name,
      trim(e.path, 300),
      trim(e.subject, 120),
      trim(e.detail, 200),
      trim(e.sessionId, 64),
      trim(e.visitorId, 64),
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

/* ── visit shape, exits and the funnel ───────────────────────────────────────
 *
 * THE FINDING THAT SHAPED THIS SECTION
 * Almost everything the operator asked for — where visitors leave, what they
 * landed on, whether they bounced, how deep a visit goes — needs NO new event.
 * It is all derivable from the page_view rows already in the log, by asking
 * "first and last row per session". The same is true of the funnel's outcomes:
 * registration, first unlock and follow are rows with timestamps in `users`,
 * `credits_ledger` and `tracked_cities`. The database already knew; nobody was
 * asking it.
 *
 * A NOTE ON WHAT A "SESSION" IS HERE, because every number below inherits it:
 * one browser TAB (a random id in sessionStorage, gone when the tab closes).
 * Not a person and not a device. Two tabs are two visits, and tomorrow is a
 * new visit. That is the honest reading, and it is why nothing here is called
 * "users" unless it is joined to an account.
 *
 * /deals, /admin, /login and /register emit no events at all
 * (components/PageViewTracker) — the privacy notice promises it. So the funnel
 * measures registration from `users.created_at`, never from a view of the
 * registration page, and no query below can be fixed by "just also counting
 * the /register page".
 */

export interface VisitShape {
  sessions: number;
  /** page views per visit */
  pagesPerVisit: number;
  /** share of visits that saw ONE page and left inside 10 seconds */
  bounceRatePct: number;
  /** visits containing at least one signed-in event */
  signedInSessions: number;
}

export function visitShape(days = 30): VisitShape {
  const empty: VisitShape = { sessions: 0, pagesPerVisit: 0, bounceRatePct: 0, signedInSessions: 0 };
  try {
    ensureTable();
    const r = appDb().prepare(
      `WITH s AS (
         SELECT session_id,
                SUM(CASE WHEN name='page_view' THEN 1 ELSE 0 END) views,
                COALESCE(SUM(dwell_ms),0) dwell,
                MAX(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) signed
           FROM events
          WHERE session_id IS NOT NULL AND created_at >= datetime('now', ?)
          GROUP BY session_id)
       SELECT COUNT(*) sessions, COALESCE(SUM(views),0) views,
              SUM(CASE WHEN views <= 1 AND dwell < 10000 THEN 1 ELSE 0 END) bounces,
              COALESCE(SUM(signed),0) signedIn
         FROM s`
    ).get(win(days)) as { sessions: number; views: number; bounces: number; signedIn: number };
    const sessions = Number(r.sessions || 0);
    return {
      sessions,
      pagesPerVisit: sessions ? Number((Number(r.views) / sessions).toFixed(1)) : 0,
      bounceRatePct: sessions ? Math.round((Number(r.bounces) / sessions) * 100) : 0,
      signedInSessions: Number(r.signedIn || 0),
    };
  } catch { return empty; }
}

export interface ExitRow {
  path: string;
  views: number;
  exits: number;
  exitRatePct: number;
  /** average seconds spent on this page in the visits that ended here */
  avgSecondsBeforeExit: number;
}

/**
 * Where visits end.
 *
 * A high exit rate is not automatically bad — the last page of a satisfied
 * visit is still an exit. What makes it a finding is a high exit rate WITH a
 * short time on the page: that pair means the page was reached and abandoned,
 * which is either something broken or something that disappointed. Both
 * columns are shown so the two cases stay distinguishable.
 */
export function exitPages(days = 30, limit = 25): ExitRow[] {
  try {
    ensureTable();
    return (appDb().prepare(
      `WITH v AS (
         SELECT session_id, path, created_at, dwell_ms,
                ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC, id DESC) rn
           FROM events
          WHERE name='page_view' AND path IS NOT NULL AND session_id IS NOT NULL
            AND created_at >= datetime('now', @win)),
       lastv AS (SELECT session_id, path FROM v WHERE rn = 1),
       ex AS (SELECT path, COUNT(*) exits FROM lastv GROUP BY path),
       vw AS (SELECT path, COUNT(*) views FROM events
               WHERE name='page_view' AND path IS NOT NULL
                 AND created_at >= datetime('now', @win) GROUP BY path),
       dw AS (SELECT e.path, AVG(e.dwell_ms) ms
                FROM events e JOIN lastv l
                  ON l.session_id = e.session_id AND l.path = e.path
               WHERE e.name='page_leave' AND e.dwell_ms IS NOT NULL
                 AND e.created_at >= datetime('now', @win)
               GROUP BY e.path)
       SELECT vw.path, vw.views, COALESCE(ex.exits,0) exits, dw.ms
         FROM vw LEFT JOIN ex ON ex.path = vw.path LEFT JOIN dw ON dw.path = vw.path
        ORDER BY exits DESC, vw.views DESC LIMIT @lim`
    ).all({ win: win(days), lim: limit }) as Array<{ path: string; views: number; exits: number; ms: number | null }>)
      .map((r) => ({
        path: r.path,
        views: Number(r.views || 0),
        exits: Number(r.exits || 0),
        exitRatePct: r.views ? Math.round((Number(r.exits) / Number(r.views)) * 100) : 0,
        avgSecondsBeforeExit: r.ms == null ? 0 : Math.round(Number(r.ms) / 1000),
      }));
  } catch { return []; }
}

export interface LandingRow { path: string; sessions: number; bounces: number; bounceRatePct: number }

/** Where visits begin, and how many of those visits went no further. */
export function landingPages(days = 30, limit = 25): LandingRow[] {
  try {
    ensureTable();
    return (appDb().prepare(
      `WITH v AS (
         SELECT session_id, path,
                ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at ASC, id ASC) rn
           FROM events
          WHERE name='page_view' AND path IS NOT NULL AND session_id IS NOT NULL
            AND created_at >= datetime('now', @win)),
       firstv AS (SELECT session_id, path FROM v WHERE rn = 1),
       shape AS (
         SELECT session_id,
                SUM(CASE WHEN name='page_view' THEN 1 ELSE 0 END) views,
                COALESCE(SUM(dwell_ms),0) dwell
           FROM events
          WHERE session_id IS NOT NULL AND created_at >= datetime('now', @win)
          GROUP BY session_id)
       SELECT f.path, COUNT(*) sessions,
              SUM(CASE WHEN s.views <= 1 AND s.dwell < 10000 THEN 1 ELSE 0 END) bounces
         FROM firstv f JOIN shape s ON s.session_id = f.session_id
        GROUP BY f.path ORDER BY sessions DESC LIMIT @lim`
    ).all({ win: win(days), lim: limit }) as Array<{ path: string; sessions: number; bounces: number }>)
      .map((r) => ({
        path: r.path,
        sessions: Number(r.sessions || 0),
        bounces: Number(r.bounces || 0),
        bounceRatePct: r.sessions ? Math.round((Number(r.bounces) / Number(r.sessions)) * 100) : 0,
      }));
  } catch { return []; }
}

/** Referring domains, from session_start. Never a full URL — see lib/track.ts. */
export function trafficSources(days = 30, limit = 15): Array<{ source: string; sessions: number }> {
  try {
    ensureTable();
    return appDb().prepare(
      `SELECT COALESCE(subject,'direct') source, COUNT(DISTINCT session_id) sessions
         FROM events WHERE name='session_start' AND created_at >= datetime('now', ?)
        GROUP BY source ORDER BY sessions DESC LIMIT ?`
    ).all(win(days), limit) as Array<{ source: string; sessions: number }>;
  } catch { return []; }
}

export interface FunnelStage { key: string; label: string; n: number; ofPreviousPct: number }

/**
 * The signup funnel, end to end.
 *
 * Each stage comes from the cheapest honest source rather than from a tag on a
 * button: views and wall impressions from the event log, everything after
 * registration from the tables that record the outcome itself. A button tag
 * can be missed, double-fired or blocked by an ad blocker; `users.created_at`
 * cannot.
 *
 * The stages are NOT one cohort walking through — a visit today and an account
 * created today may be different people. It is the standard funnel caveat and
 * it is stated in the panel rather than left for the reader to assume.
 */
export function signupFunnel(days = 30): FunnelStage[] {
  try {
    ensureTable();
    const db = appDb();
    const w = win(days);
    const one = (sql: string, ...args: unknown[]): number => {
      try { return Number((db.prepare(sql).get(...(args as [])) as { n: number }).n || 0); } catch { return 0; }
    };
    const cityVisits = one(
      `SELECT COUNT(DISTINCT session_id) n FROM events
        WHERE name='page_view' AND path LIKE '/city/%' AND created_at >= datetime('now', ?)`, w);
    // The wall impression already had an event — `unlock_prompt_seen`, fired
    // from CityWall via TrackOnMount. Adding a second name for the same moment
    // would have split the same signal across two columns and made both wrong.
    const wallSeen = one(
      `SELECT COUNT(DISTINCT session_id) n FROM events
        WHERE name='unlock_prompt_seen' AND created_at >= datetime('now', ?)`, w);
    const registerClicks = one(
      `SELECT COUNT(DISTINCT session_id) n FROM events
        WHERE name='cta_click' AND subject='register' AND created_at >= datetime('now', ?)`, w);
    const registered = one(
      `SELECT COUNT(*) n FROM users WHERE created_at >= datetime('now', ?)`, w);
    const unlocked = one(
      `SELECT COUNT(DISTINCT user_id) n FROM city_unlocks WHERE created_at >= datetime('now', ?)`, w);
    // "Came back" = an account that was active on a LATER calendar day than it
    // registered. Same-day return is just the signup visit continuing.
    const returned = one(
      `SELECT COUNT(DISTINCT e.user_id) n
         FROM events e JOIN users u ON u.id = e.user_id
        WHERE u.created_at >= datetime('now', ?)
          AND date(e.created_at) > date(u.created_at)`, w);

    const raw: Array<[string, string, number]> = [
      ["city_view", "ביקור בעמוד עיר", cityVisits],
      ["wall", "הוצגה חומת ההרשמה", wallSeen],
      ["register_click", 'לחיצה על "הרשמה"', registerClicks],
      ["registered", "נרשם", registered],
      ["unlocked", "פתח עיר ראשונה", unlocked],
      ["returned", "חזר ביום אחר", returned],
    ];
    return raw.map(([key, label, n], i) => ({
      key, label, n,
      ofPreviousPct: i === 0 || !raw[i - 1][2] ? 100 : Math.round((n / raw[i - 1][2]) * 100),
    }));
  } catch { return []; }
}

/** Accounts that registered and never opened a single city — the onboarding leak. */
export function registeredNeverUnlocked(days = 90): number {
  try {
    ensureTable();
    const r = appDb().prepare(
      `SELECT COUNT(*) n FROM users u
        WHERE u.created_at >= datetime('now', ?)
          AND NOT EXISTS (SELECT 1 FROM city_unlocks c WHERE c.user_id = u.id)`
    ).get(win(days)) as { n: number };
    return Number(r.n || 0);
  } catch { return 0; }
}

export interface DeadEndRow { path: string; label: string; n: number }

/** Rage clicks — "looks clickable and isn't", by page and element. */
export function rageClicks(days = 30, limit = 20): DeadEndRow[] {
  try {
    ensureTable();
    return appDb().prepare(
      `SELECT COALESCE(path,'—') path, COALESCE(subject,'—') label, COUNT(*) n
         FROM events WHERE name='rage_click' AND created_at >= datetime('now', ?)
        GROUP BY path, label ORDER BY n DESC LIMIT ?`
    ).all(win(days), limit) as DeadEndRow[];
  } catch { return []; }
}

/** Errors a VISITOR saw, by page. The server log has the stack; this has the blast radius. */
export function errorsShown(days = 30, limit = 20): Array<{ path: string; detail: string; n: number }> {
  try {
    ensureTable();
    return appDb().prepare(
      `SELECT COALESCE(path,'—') path, COALESCE(detail,'—') detail, COUNT(*) n
         FROM events WHERE name='error_shown' AND created_at >= datetime('now', ?)
        GROUP BY path, detail ORDER BY n DESC LIMIT ?`
    ).all(win(days), limit) as Array<{ path: string; detail: string; n: number }>;
  } catch { return []; }
}

/** Which of the tracked buttons people actually press. */
export function ctaClicks(days = 30): Array<{ cta: string; n: number; sessions: number }> {
  try {
    ensureTable();
    return appDb().prepare(
      `SELECT subject cta, COUNT(*) n, COUNT(DISTINCT session_id) sessions
         FROM events WHERE name='cta_click' AND subject IS NOT NULL
           AND created_at >= datetime('now', ?)
        GROUP BY subject ORDER BY n DESC`
    ).all(win(days)) as Array<{ cta: string; n: number; sessions: number }>;
  } catch { return []; }
}

/** How far down pages are read: share of views reaching each threshold. */
export function scrollDepth(days = 30, limit = 15): Array<{ path: string; views: number; d25: number; d50: number; d75: number; d100: number }> {
  try {
    ensureTable();
    return (appDb().prepare(
      `WITH v AS (SELECT path, COUNT(*) views FROM events
                   WHERE name='page_view' AND path IS NOT NULL
                     AND created_at >= datetime('now', @win) GROUP BY path),
            d AS (SELECT path, detail, COUNT(*) n FROM events
                   WHERE name='scroll_depth' AND path IS NOT NULL
                     AND created_at >= datetime('now', @win) GROUP BY path, detail)
       SELECT v.path, v.views,
              COALESCE(MAX(CASE WHEN d.detail='25'  THEN d.n END),0) d25,
              COALESCE(MAX(CASE WHEN d.detail='50'  THEN d.n END),0) d50,
              COALESCE(MAX(CASE WHEN d.detail='75'  THEN d.n END),0) d75,
              COALESCE(MAX(CASE WHEN d.detail='100' THEN d.n END),0) d100
         FROM v LEFT JOIN d ON d.path = v.path
        GROUP BY v.path ORDER BY v.views DESC LIMIT @lim`
    ).all({ win: win(days), lim: limit }) as Array<{ path: string; views: number; d25: number; d50: number; d75: number; d100: number }>);
  } catch { return []; }
}

export interface CityDemandRow { city: string; views: number; wallViews: number; unlocks: number }

/**
 * Which cities people actually come for.
 *
 * Crossed with data quality in the panel, this is the one metric no external
 * analytics tool can produce: "people keep opening a city whose coverage is
 * thin" is a collection priority, and it is invisible to anything that does
 * not also know what is in the archive.
 */
export function cityDemand(days = 30, limit = 40): CityDemandRow[] {
  try {
    ensureTable();
    return (appDb().prepare(
      `WITH v AS (SELECT subject city, COUNT(*) views FROM events
                   WHERE name='page_view' AND path LIKE '/city/%' AND subject IS NOT NULL
                     AND created_at >= datetime('now', @win) GROUP BY subject),
            w AS (SELECT subject city, COUNT(*) n FROM events
                   WHERE name='unlock_prompt_seen' AND subject IS NOT NULL
                     AND created_at >= datetime('now', @win) GROUP BY subject),
            u AS (SELECT city_name city, COUNT(*) n FROM city_unlocks
                   WHERE created_at >= datetime('now', @win) GROUP BY city_name)
       SELECT v.city, v.views, COALESCE(w.n,0) wallViews, COALESCE(u.n,0) unlocks
         FROM v LEFT JOIN w ON w.city = v.city LEFT JOIN u ON u.city = v.city
        ORDER BY v.views DESC LIMIT @lim`
    ).all({ win: win(days), lim: limit }) as CityDemandRow[]);
  } catch { return []; }
}

export interface CreditEconomy {
  granted: number;
  spent: number;
  outstanding: number;
  unlocks: number;
  usersWithBalance: number;
}

/** Credits handed out versus credits used — and how much is sitting unspent. */
export function creditEconomy(days = 90): CreditEconomy {
  const empty: CreditEconomy = { granted: 0, spent: 0, outstanding: 0, unlocks: 0, usersWithBalance: 0 };
  try {
    ensureTable();
    const db = appDb();
    const r = db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN delta_tenths > 0 THEN delta_tenths ELSE 0 END),0) granted,
              COALESCE(SUM(CASE WHEN delta_tenths < 0 THEN -delta_tenths ELSE 0 END),0) spent,
              SUM(CASE WHEN reason='city_unlock' THEN 1 ELSE 0 END) unlocks
         FROM credits_ledger WHERE created_at >= datetime('now', ?)`
    ).get(win(days)) as { granted: number; spent: number; unlocks: number };
    // Outstanding is the balance across ALL time, not the window: a credit
    // granted last quarter and still unspent is exactly the thing this number
    // is for.
    const bal = db.prepare(
      `SELECT COUNT(*) users, COALESCE(SUM(bal),0) total FROM (
         SELECT user_id, SUM(delta_tenths) bal FROM credits_ledger GROUP BY user_id
       ) WHERE bal > 0`
    ).get() as { users: number; total: number };
    return {
      granted: Math.round(Number(r.granted || 0)) / 10,
      spent: Math.round(Number(r.spent || 0)) / 10,
      unlocks: Number(r.unlocks || 0),
      outstanding: Math.round(Number(bal.total || 0)) / 10,
      usersWithBalance: Number(bal.users || 0),
    };
  } catch { return empty; }
}

export interface CohortRow { week: string; signups: number; d1: number; d7: number; d30: number }

/**
 * Do new accounts come back? By signup week, D1/D7/D30.
 *
 * A cohort table rather than one retention number, because one number cannot
 * tell "the product got better" from "last month's traffic was worse".
 */
export function retentionCohorts(weeks = 8): CohortRow[] {
  try {
    ensureTable();
    return (appDb().prepare(
      `SELECT strftime('%Y-W%W', u.created_at) week,
              COUNT(DISTINCT u.id) signups,
              COUNT(DISTINCT CASE WHEN EXISTS (
                SELECT 1 FROM events e WHERE e.user_id = u.id
                  AND julianday(e.created_at) - julianday(u.created_at) BETWEEN 0.5 AND 2)
                THEN u.id END) d1,
              COUNT(DISTINCT CASE WHEN EXISTS (
                SELECT 1 FROM events e WHERE e.user_id = u.id
                  AND julianday(e.created_at) - julianday(u.created_at) BETWEEN 0.5 AND 8)
                THEN u.id END) d7,
              COUNT(DISTINCT CASE WHEN EXISTS (
                SELECT 1 FROM events e WHERE e.user_id = u.id
                  AND julianday(e.created_at) - julianday(u.created_at) BETWEEN 0.5 AND 31)
                THEN u.id END) d30
         FROM users u
        WHERE u.created_at >= datetime('now', ?)
        GROUP BY week ORDER BY week DESC`
    ).all(`-${Math.max(1, Math.min(52, weeks)) * 7} days`) as CohortRow[]);
  } catch { return []; }
}

/* ── visitors, depth, sections, speed and paths ──────────────────────────────
 *
 * WHAT CHANGED WITH visitor_id, AND WHY IT MATTERS TO READ THESE RIGHT
 * Everything above counts VISITS (browser tabs). The queries below can also
 * count VISITORS (browsers, for 180 days). The two answer different questions
 * and neither replaces the other: 376 visits from 40 visitors is a small, loyal
 * audience; 376 visits from 370 visitors is a large one that never comes back.
 * Before this column those two were indistinguishable.
 *
 * Rows written before the column existed carry NULL and are excluded from
 * visitor counts rather than lumped together — a few hundred anonymous rows
 * collapsing into one "visitor" would make the returning rate meaningless.
 */

export interface VisitorShape {
  visits: number;
  visitors: number;
  returning: number;
  returningPct: number;
  /** 1 / 2–3 / 4+ visits per visitor */
  frequency: Array<{ bucket: string; visitors: number }>;
  devices: Array<{ device: string; visitors: number }>;
}

export function visitorShape(days = 30): VisitorShape {
  const empty: VisitorShape = { visits: 0, visitors: 0, returning: 0, returningPct: 0, frequency: [], devices: [] };
  try {
    ensureTable();
    const db = appDb();
    const w = win(days);
    const base = db.prepare(
      `WITH v AS (
         SELECT visitor_id,
                COUNT(DISTINCT session_id) visits,
                COUNT(DISTINCT date(created_at)) days
           FROM events
          WHERE visitor_id IS NOT NULL AND created_at >= datetime('now', @win)
          GROUP BY visitor_id)
       SELECT COUNT(*) visitors,
              COALESCE(SUM(visits),0) visits,
              -- "Returning" is a visit on a LATER CALENDAR DAY, not a second
              -- tab. Opening the site in two tabs is one sitting; coming back
              -- tomorrow is the thing worth counting.
              SUM(CASE WHEN days > 1 THEN 1 ELSE 0 END) returning
         FROM v`
    ).get({ win: w }) as { visitors: number; visits: number; returning: number };

    const frequency = db.prepare(
      `WITH v AS (SELECT visitor_id, COUNT(DISTINCT session_id) n FROM events
                   WHERE visitor_id IS NOT NULL AND created_at >= datetime('now', @win)
                   GROUP BY visitor_id)
       SELECT CASE WHEN n = 1 THEN 'ביקור אחד'
                   WHEN n <= 3 THEN '2–3 ביקורים'
                   ELSE '4+ ביקורים' END bucket,
              COUNT(*) visitors
         FROM v GROUP BY bucket ORDER BY MIN(n)`
    ).all({ win: w }) as Array<{ bucket: string; visitors: number }>;

    const devices = db.prepare(
      `SELECT device, COUNT(DISTINCT visitor_id) visitors FROM events
        WHERE device IS NOT NULL AND visitor_id IS NOT NULL
          AND created_at >= datetime('now', @win)
        GROUP BY device ORDER BY visitors DESC`
    ).all({ win: w }) as Array<{ device: string; visitors: number }>;

    const visitors = Number(base.visitors || 0);
    return {
      visits: Number(base.visits || 0),
      visitors,
      returning: Number(base.returning || 0),
      returningPct: visitors ? Math.round((Number(base.returning) / visitors) * 100) : 0,
      frequency, devices,
    };
  } catch { return empty; }
}

export interface DepthRow {
  path: string;
  views: number;
  /** median % of the page reached */
  medianPct: number;
  /** % of the page visible without scrolling, median across views */
  foldPct: number;
  /** share of views that got past each mark */
  p25: number; p50: number; p75: number; p100: number;
}

/**
 * How far down each page people get, and how much they could see at rest.
 *
 * Reads `page_depth` (exact maximum, one row per view). The 25/50/75/100
 * survival curve is DERIVED here rather than stored, which is why the old
 * bucketed `scroll_depth` event could be retired: from an exact maximum you
 * can compute the curve, a median and an average; from four buckets you can
 * compute only the curve.
 */
export function pageDepth(days = 30, limit = 20): DepthRow[] {
  try {
    ensureTable();
    return (appDb().prepare(
      `WITH d AS (SELECT path, CAST(detail AS INTEGER) pct FROM events
                   WHERE name='page_depth' AND path IS NOT NULL AND detail IS NOT NULL
                     AND created_at >= datetime('now', @win)),
            f AS (SELECT path, AVG(CAST(detail AS INTEGER)) fold FROM events
                   WHERE name='fold_view' AND path IS NOT NULL AND detail IS NOT NULL
                     AND created_at >= datetime('now', @win)
                   GROUP BY path)
       SELECT d.path,
              COUNT(*) views,
              -- SQLite has no percentile function; the median is the middle
              -- row of the ordered set, taken with a correlated subquery. At
              -- these row counts that is cheaper than sorting in JS after
              -- shipping every measurement out of the database.
              (SELECT x.pct FROM d x WHERE x.path = d.path
                ORDER BY x.pct LIMIT 1 OFFSET (SELECT COUNT(*)/2 FROM d y WHERE y.path = d.path)) medianPct,
              COALESCE((SELECT f.fold FROM f WHERE f.path = d.path), 0) foldPct,
              SUM(CASE WHEN d.pct >= 25  THEN 1 ELSE 0 END) p25,
              SUM(CASE WHEN d.pct >= 50  THEN 1 ELSE 0 END) p50,
              SUM(CASE WHEN d.pct >= 75  THEN 1 ELSE 0 END) p75,
              SUM(CASE WHEN d.pct >= 95  THEN 1 ELSE 0 END) p100
         FROM d GROUP BY d.path ORDER BY views DESC LIMIT @lim`
    ).all({ win: win(days), lim: limit }) as Array<DepthRow & { medianPct: number | null; foldPct: number }>)
      .map((r) => ({ ...r, medianPct: Math.round(Number(r.medianPct ?? 0)), foldPct: Math.round(Number(r.foldPct ?? 0)) }));
  } catch { return []; }
}

export interface SectionRow {
  section: string;
  views: number;
  avgSeconds: number;
  totalSeconds: number;
  /** share of the page's views in which this section was looked at */
  reachPct: number;
}

/**
 * Which parts of a page people stopped on — the inside of a page view.
 *
 * `city` narrows it to one city; omitted, it answers "which parts of a city
 * page get read" across all of them. `reachPct` is the number that turns this
 * from trivia into a decision: a section reached by 12% of views is either
 * buried or not wanted, and the depth table above says which.
 */
export function sectionViews(days = 30, city?: string): SectionRow[] {
  try {
    ensureTable();
    const db = appDb();
    const w = win(days);
    const denom = (db.prepare(
      city
        ? `SELECT COUNT(*) n FROM events WHERE name='page_view' AND subject = @city
             AND path LIKE '/city/%' AND created_at >= datetime('now', @win)`
        : `SELECT COUNT(*) n FROM events WHERE name='page_view' AND path LIKE '/city/%'
             AND created_at >= datetime('now', @win)`
    ).get(city ? { city, win: w } : { win: w }) as { n: number }).n || 0;

    return (db.prepare(
      `SELECT subject section, COUNT(*) views,
              COALESCE(SUM(dwell_ms),0) dwell
         FROM events
        WHERE name='section_view' AND subject IS NOT NULL
          AND created_at >= datetime('now', @win)
          ${city ? "AND detail = @city" : ""}
        GROUP BY subject ORDER BY dwell DESC`
    ).all(city ? { city, win: w } : { win: w }) as Array<{ section: string; views: number; dwell: number }>)
      .map((r) => ({
        section: r.section,
        views: Number(r.views || 0),
        totalSeconds: Math.round(Number(r.dwell || 0) / 1000),
        avgSeconds: r.views ? Math.round(Number(r.dwell) / r.views / 1000) : 0,
        reachPct: denom ? Math.round((Number(r.views) / denom) * 100) : 0,
      }));
  } catch { return []; }
}

export interface VitalRow { path: string; metric: string; device: string; p75: number; n: number }

/**
 * Real-user speed, at the 75th percentile.
 *
 * p75 AND NOT AN AVERAGE, deliberately. An average load time is dragged down
 * by the fast majority and hides exactly the slow tail that makes people
 * leave; p75 is the number Google's own thresholds are defined against, and it
 * describes an experience a real quarter of visitors are having.
 *
 * Split by device because that is where the difference lives: the same page is
 * routinely twice as slow on a phone, and a single blended figure would let
 * that hide behind desktop traffic.
 */
export function webVitals(days = 30, limit = 40): VitalRow[] {
  try {
    ensureTable();
    return (appDb().prepare(
      `WITH v AS (SELECT path, subject metric, COALESCE(device,'unknown') device,
                         CAST(detail AS INTEGER) val
                    FROM events
                   WHERE name='web_vital' AND path IS NOT NULL AND subject IS NOT NULL
                     AND detail IS NOT NULL AND created_at >= datetime('now', @win))
       SELECT path, metric, device, COUNT(*) n,
              (SELECT x.val FROM v x
                WHERE x.path = v.path AND x.metric = v.metric AND x.device = v.device
                ORDER BY x.val
                LIMIT 1 OFFSET (SELECT CAST(COUNT(*) * 0.75 AS INTEGER)
                                  FROM v y WHERE y.path = v.path AND y.metric = v.metric AND y.device = v.device)) p75
         FROM v GROUP BY path, metric, device
        HAVING n >= 3
        ORDER BY n DESC LIMIT @lim`
    ).all({ win: win(days), lim: limit }) as Array<VitalRow & { p75: number | null }>)
      .map((r) => ({ ...r, p75: Number(r.p75 ?? 0) }));
  } catch { return []; }
}

export interface PathStep { from: string; to: string; n: number }

/**
 * Where people go next — derived, with no new event.
 *
 * Consecutive page_views inside one visit, paired with LAG. This answers the
 * question the exit table cannot: an exit says the visit ended, this says what
 * the visit did instead. If the most common step after a city page is back to
 * the home page rather than on to a comparison or a price check, the natural
 * next action either does not exist or is not visible from there.
 */
export function navigationPaths(days = 30, limit = 25): PathStep[] {
  try {
    ensureTable();
    return appDb().prepare(
      `WITH v AS (SELECT session_id, path, created_at, id,
                         LAG(path) OVER (PARTITION BY session_id ORDER BY created_at, id) prev
                    FROM events
                   WHERE name='page_view' AND path IS NOT NULL AND session_id IS NOT NULL
                     AND created_at >= datetime('now', @win))
       SELECT prev "from", path "to", COUNT(*) n
         FROM v WHERE prev IS NOT NULL AND prev <> path
        GROUP BY prev, path ORDER BY n DESC LIMIT @lim`
    ).all({ win: win(days), lim: limit }) as PathStep[];
  } catch { return []; }
}

/* ── the standard product-analytics measures ─────────────────────────────────
 *
 * Everything below is a metric with an accepted definition outside this
 * codebase — GA4's engaged session, the DAU/WAU stickiness ratio, time to first
 * value, the session-length distribution, adoption breadth. They are written
 * here rather than invented because a dashboard whose definitions are private
 * cannot be compared to anything, and "is 34% good?" is unanswerable without a
 * shared meaning.
 *
 * Where a definition has a well-known threshold it is spelled out in the
 * comment, so the number on screen can be read against it rather than against
 * a feeling.
 */

export interface EngagementRate { sessions: number; engaged: number; engagedPct: number }

/**
 * Engaged sessions — GA4's definition, and the reason bounce rate was retired.
 *
 * A visit counts as engaged if it lasted more than 10 seconds, OR saw two or
 * more pages, OR produced a conversion. Bounce rate is simply its inverse, and
 * the reason the industry moved is that "did not bounce" is not "was
 * interested": a visit that loaded two pages in four seconds and left passes a
 * bounce test and fails this one.
 */
export function engagedSessions(days = 30): EngagementRate {
  const empty: EngagementRate = { sessions: 0, engaged: 0, engagedPct: 0 };
  try {
    ensureTable();
    const r = appDb().prepare(
      `WITH s AS (
         SELECT session_id,
                SUM(CASE WHEN name='page_view' THEN 1 ELSE 0 END) views,
                COALESCE(SUM(dwell_ms),0) ms,
                MAX(CASE WHEN name IN ('unlock_done','feedback_submit','search_select','cta_click')
                         THEN 1 ELSE 0 END) converted
           FROM events
          WHERE session_id IS NOT NULL AND created_at >= datetime('now', @win)
          GROUP BY session_id)
       SELECT COUNT(*) sessions,
              SUM(CASE WHEN ms > 10000 OR views >= 2 OR converted = 1 THEN 1 ELSE 0 END) engaged
         FROM s`
    ).get({ win: win(days) }) as { sessions: number; engaged: number };
    const sessions = Number(r.sessions || 0), engaged = Number(r.engaged || 0);
    return { sessions, engaged, engagedPct: sessions ? Math.round((engaged / sessions) * 100) : 0 };
  } catch { return empty; }
}

export interface Stickiness { dau: number; wau: number; pct: number }

/**
 * DAU/WAU — how much of the weekly audience shows up on an average day.
 *
 * The standard shorthand for "is this a habit or an occasional errand".
 * Roughly: under 10% is an errand, 20%+ is a product people return to without
 * being prompted. For a research tool a low number is not automatically bad —
 * nobody checks apartment prices daily — which is exactly why it is shown next
 * to the retention cohorts rather than alone.
 */
export function stickiness(days = 30): Stickiness {
  const empty: Stickiness = { dau: 0, wau: 0, pct: 0 };
  try {
    ensureTable();
    const db = appDb();
    // Average daily actives across the window, not one arbitrary day: a single
    // day is noise, and a Saturday would understate it for an Israeli audience.
    const dau = db.prepare(
      `SELECT AVG(n) a FROM (
         SELECT date(created_at) d, COUNT(DISTINCT COALESCE(visitor_id, session_id)) n
           FROM events WHERE created_at >= datetime('now', @win) GROUP BY d)`
    ).get({ win: win(days) }) as { a: number | null };
    const wau = db.prepare(
      `SELECT COUNT(DISTINCT COALESCE(visitor_id, session_id)) n
         FROM events WHERE created_at >= datetime('now', '-7 days')`
    ).get() as { n: number };
    const d = Math.round(Number(dau.a || 0)), w = Number(wau.n || 0);
    return { dau: d, wau: w, pct: w ? Math.round((d / w) * 100) : 0 };
  } catch { return empty; }
}

export interface TimeToValue { medianMinutes: number | null; n: number; within24hPct: number }

/**
 * How long from registering to opening a first city.
 *
 * The activation clock. It is the most predictive single number for whether an
 * account survives: an account that reaches value in the same sitting behaves
 * very differently from one that comes back three days later to try.
 *
 * Measured from users.created_at to the first city_unlocks row — both are
 * timestamped facts, so no client instrumentation can lose it.
 */
export function timeToFirstValue(days = 90): TimeToValue {
  const empty: TimeToValue = { medianMinutes: null, n: 0, within24hPct: 0 };
  try {
    ensureTable();
    const rows = appDb().prepare(
      `SELECT (julianday(MIN(c.created_at)) - julianday(u.created_at)) * 1440 mins
         FROM users u JOIN city_unlocks c ON c.user_id = u.id
        WHERE u.created_at >= datetime('now', @win)
        GROUP BY u.id
        HAVING mins >= 0
        ORDER BY mins`
    ).all({ win: win(days) }) as Array<{ mins: number }>;
    if (!rows.length) return empty;
    const median = rows[Math.floor(rows.length / 2)].mins;
    const fast = rows.filter((r) => r.mins <= 1440).length;
    return {
      medianMinutes: Math.round(median),
      n: rows.length,
      within24hPct: Math.round((fast / rows.length) * 100),
    };
  } catch { return empty; }
}

export interface Bucketed { bucket: string; n: number }

/**
 * How long visits actually last, as a distribution rather than an average.
 *
 * An average of three minutes can mean "everyone reads for three minutes" or
 * "most leave in ten seconds and a few read for twenty" — two completely
 * different products, and only the second one has something worth fixing at
 * the top of the funnel. The average cannot tell them apart; this can.
 */
export function sessionLengths(days = 30): Bucketed[] {
  try {
    ensureTable();
    return appDb().prepare(
      `WITH s AS (SELECT session_id, COALESCE(SUM(dwell_ms),0)/1000 secs
                    FROM events WHERE session_id IS NOT NULL
                      AND created_at >= datetime('now', @win)
                    GROUP BY session_id)
       SELECT CASE WHEN secs < 10 THEN 'עד 10 שנ׳'
                   WHEN secs < 30 THEN '10–30 שנ׳'
                   WHEN secs < 120 THEN '30 שנ׳–2 דק׳'
                   WHEN secs < 300 THEN '2–5 דק׳'
                   WHEN secs < 900 THEN '5–15 דק׳'
                   ELSE '15 דק׳ ומעלה' END bucket,
              COUNT(*) n,
              MIN(secs) ord
         FROM s GROUP BY bucket ORDER BY ord`
    ).all({ win: win(days) }) as Bucketed[];
  } catch { return []; }
}

/**
 * In how many distinct features a visitor touched.
 *
 * Breadth of use predicts return far better than volume of use: someone who
 * viewed forty pages of one kind is browsing, someone who used three different
 * tools has found the product useful. The buckets are what a roadmap decision
 * actually turns on.
 */
export function adoptionBreadth(days = 30): Bucketed[] {
  try {
    ensureTable();
    return appDb().prepare(
      `WITH f AS (
         SELECT COALESCE(visitor_id, session_id) who,
                COUNT(DISTINCT CASE WHEN name IN
                  ('search','search_select','compare_select','chart_action','drill_down',
                   'follow_city_click','share_click','unlock_done','feedback_submit','cta_click')
                  THEN name END) features
           FROM events
          WHERE created_at >= datetime('now', @win)
            AND COALESCE(visitor_id, session_id) IS NOT NULL
          GROUP BY who)
       SELECT CASE WHEN features = 0 THEN 'צפייה בלבד'
                   WHEN features = 1 THEN 'פיצ׳ר אחד'
                   WHEN features = 2 THEN 'שניים'
                   ELSE 'שלושה ומעלה' END bucket,
              COUNT(*) n, MIN(features) ord
         FROM f GROUP BY bucket ORDER BY ord`
    ).all({ win: win(days) }) as Bucketed[];
  } catch { return []; }
}

export interface LandingConversion {
  path: string; sessions: number; converted: number; convPct: number;
}

/**
 * Which entry pages produce accounts, not just traffic.
 *
 * A landing page can bring a great deal of traffic and no users, and the two
 * are routinely confused because they sit in different tables. A visit counts
 * as converted when it later carried a signed-in account or completed an
 * unlock — both visible on the session itself, so no attribution guesswork.
 */
export function conversionByLanding(days = 30, limit = 15): LandingConversion[] {
  try {
    ensureTable();
    return (appDb().prepare(
      `WITH v AS (
         SELECT session_id, path,
                ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at ASC, id ASC) rn
           FROM events
          WHERE name='page_view' AND path IS NOT NULL AND session_id IS NOT NULL
            AND created_at >= datetime('now', @win)),
       firstv AS (SELECT session_id, path FROM v WHERE rn = 1),
       conv AS (
         SELECT session_id,
                MAX(CASE WHEN user_id IS NOT NULL OR name='unlock_done' THEN 1 ELSE 0 END) c
           FROM events
          WHERE session_id IS NOT NULL AND created_at >= datetime('now', @win)
          GROUP BY session_id)
       SELECT f.path, COUNT(*) sessions, COALESCE(SUM(conv.c),0) converted
         FROM firstv f LEFT JOIN conv ON conv.session_id = f.session_id
        GROUP BY f.path ORDER BY sessions DESC LIMIT @lim`
    ).all({ win: win(days), lim: limit }) as Array<{ path: string; sessions: number; converted: number }>)
      .map((r) => ({
        path: r.path,
        sessions: Number(r.sessions || 0),
        converted: Number(r.converted || 0),
        convPct: r.sessions ? Math.round((Number(r.converted) / Number(r.sessions)) * 100) : 0,
      }));
  } catch { return []; }
}
