import { appDb } from "./appDb";
import { ensureEventSchema } from "./events";

/**
 * Nightly aggregation of the raw event log into daily counts.
 *
 * WHY THIS EXISTS — TWO REASONS, AND THE SECOND IS THE IMPORTANT ONE
 *
 * 1. Speed. Every panel in the usage dashboard is a GROUP BY over the raw log.
 *    That is fine at ten thousand rows and not fine at a million, and the
 *    admin page is the one place where a slow query is invisible until it is
 *    already annoying.
 *
 * 2. Retention. The raw log now lives 90 days rather than 180 (lib/legal.ts),
 *    because for a signed-in visitor those rows are personal data and there is
 *    no reason to hold them beyond their use. A trend, on the other hand,
 *    genuinely wants years. The aggregates below carry NO account id, NO
 *    session id and NO search terms — they are counts — so keeping them
 *    indefinitely is the thing that makes the shorter raw retention possible
 *    rather than a loss.
 *
 * THE ORDERING THAT MATTERS: this runs BEFORE the retention sweep in the
 * nightly pipeline, not after. Reversed, the first run past the 90-day mark
 * would delete a day's rows and then aggregate the gap it just made — and the
 * aggregate is the copy that was supposed to survive. It is the kind of bug
 * that produces no error and no output, just a permanently missing week.
 *
 * NAMED PARAMETERS, NOT NUMBERED: every statement here needs the same three
 * values in a dozen places, and better-sqlite3 rejects an array bound to a
 * statement written with ?1/?2/?3 ("Too many parameter values were provided").
 * @day/@from/@to bound from one object is the form that works, and it also
 * reads better at this length.
 *
 * IDEMPOTENT BY CONSTRUCTION: each day is deleted and re-inserted inside one
 * transaction, so re-running for the same date is a no-op rather than a
 * doubling. That is what makes it safe for the pipeline to retry.
 */

let ensured = false;
function ensureTables() {
  if (ensured) return;
  // The source table first: this file reads columns that lib/events.ts adds by
  // migration, and the pipeline process may be the first to touch the DB.
  ensureEventSchema();
  appDb().exec(`
    CREATE TABLE IF NOT EXISTS usage_daily (
      day TEXT PRIMARY KEY,
      sessions INTEGER NOT NULL DEFAULT 0,
      page_views INTEGER NOT NULL DEFAULT 0,
      seconds INTEGER NOT NULL DEFAULT 0,
      bounces INTEGER NOT NULL DEFAULT 0,
      signed_in_sessions INTEGER NOT NULL DEFAULT 0,
      mobile INTEGER NOT NULL DEFAULT 0,
      tablet INTEGER NOT NULL DEFAULT 0,
      desktop INTEGER NOT NULL DEFAULT 0,
      signups INTEGER NOT NULL DEFAULT 0,
      unlocks INTEGER NOT NULL DEFAULT 0,
      wall_views INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      rage_clicks INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS usage_daily_page (
      day TEXT NOT NULL,
      path TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      seconds INTEGER NOT NULL DEFAULT 0,
      exits INTEGER NOT NULL DEFAULT 0,
      landings INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, path)
    );
    CREATE TABLE IF NOT EXISTS usage_daily_city (
      day TEXT NOT NULL,
      city TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      wall_views INTEGER NOT NULL DEFAULT 0,
      unlocks INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, city)
    );
  `);
  ensured = true;
}

/**
 * Does this table exist yet?
 *
 * `users`, `credits_ledger` and `city_unlocks` are created lazily by
 * lib/auth.ts and lib/credits.ts the first time the web app touches them — but
 * this file runs from the nightly pipeline, in a process that may never import
 * either. On a fresh database that made the roll-up throw on a missing table
 * and take the pipeline stage down with it, which is a spectacular way to fail
 * at counting to zero. Absent table = the count is zero, which is also the
 * truth.
 */
function tableExists(name: string): boolean {
  try {
    return !!appDb().prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
    ).get(name);
  } catch { return false; }
}

export interface RollupResult { day: string; sessions: number; pages: number; cities: number }

/**
 * Aggregate ONE day. Defaults to yesterday — today is still being written to,
 * and a partial day stored as if it were whole is a number that silently
 * disagrees with itself the next morning.
 */
export function rollupDay(day?: string): RollupResult {
  ensureTables();
  const db = appDb();
  const d = day ?? (db.prepare("SELECT date('now','-1 day') d").get() as { d: string }).d;
  const from = `${d} 00:00:00`;
  const to = `${d} 23:59:59`;
  const hasUsers = tableExists("users");
  const hasUnlocks = tableExists("city_unlocks");
  const signupsSql = hasUsers
    ? "(SELECT COUNT(*) FROM users WHERE created_at BETWEEN @from AND @to)" : "0";
  const unlocksSql = hasUnlocks
    ? "(SELECT COUNT(*) FROM city_unlocks WHERE created_at BETWEEN @from AND @to)" : "0";

  const run = db.transaction(() => {
    db.prepare("DELETE FROM usage_daily WHERE day = ?").run(d);
    db.prepare("DELETE FROM usage_daily_page WHERE day = ?").run(d);
    db.prepare("DELETE FROM usage_daily_city WHERE day = ?").run(d);

    db.prepare(
      `INSERT INTO usage_daily (day, sessions, page_views, seconds, bounces, signed_in_sessions,
                                mobile, tablet, desktop, signups, unlocks, wall_views, errors, rage_clicks)
       SELECT @day,
         (SELECT COUNT(DISTINCT session_id) FROM events
           WHERE session_id IS NOT NULL AND created_at BETWEEN @from AND @to),
         (SELECT COUNT(*) FROM events WHERE name='page_view' AND created_at BETWEEN @from AND @to),
         (SELECT COALESCE(SUM(dwell_ms),0)/1000 FROM events WHERE created_at BETWEEN @from AND @to),
         (SELECT COUNT(*) FROM (
            SELECT session_id, SUM(CASE WHEN name='page_view' THEN 1 ELSE 0 END) v,
                   COALESCE(SUM(dwell_ms),0) ms
              FROM events WHERE session_id IS NOT NULL AND created_at BETWEEN @from AND @to
             GROUP BY session_id) WHERE v <= 1 AND ms < 10000),
         (SELECT COUNT(DISTINCT session_id) FROM events
           WHERE user_id IS NOT NULL AND session_id IS NOT NULL AND created_at BETWEEN @from AND @to),
         (SELECT COUNT(DISTINCT session_id) FROM events WHERE device='mobile'  AND created_at BETWEEN @from AND @to),
         (SELECT COUNT(DISTINCT session_id) FROM events WHERE device='tablet'  AND created_at BETWEEN @from AND @to),
         (SELECT COUNT(DISTINCT session_id) FROM events WHERE device='desktop' AND created_at BETWEEN @from AND @to),
         ${signupsSql},
         ${unlocksSql},
         (SELECT COUNT(*) FROM events WHERE name='unlock_prompt_seen' AND created_at BETWEEN @from AND @to),
         (SELECT COUNT(*) FROM events WHERE name='error_shown'        AND created_at BETWEEN @from AND @to),
         (SELECT COUNT(*) FROM events WHERE name='rage_click'         AND created_at BETWEEN @from AND @to)`
    ).run({ day: d, from, to });

    // Per page: views and dwell are plain sums; exits and landings are the
    // last/first page_view of each session, which is the only way to get them
    // and the reason this is worth precomputing at all.
    db.prepare(
      `INSERT INTO usage_daily_page (day, path, views, seconds, exits, landings)
       WITH ev AS (SELECT * FROM events WHERE created_at BETWEEN @from AND @to),
            v AS (SELECT session_id, path, id, created_at,
                         ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at ASC, id ASC) rn_first,
                         ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC, id DESC) rn_last
                    FROM ev WHERE name='page_view' AND path IS NOT NULL AND session_id IS NOT NULL),
            agg AS (SELECT path,
                           SUM(CASE WHEN name='page_view' THEN 1 ELSE 0 END) views,
                           COALESCE(SUM(dwell_ms),0)/1000 secs
                      FROM ev WHERE path IS NOT NULL GROUP BY path)
       SELECT @day, agg.path, agg.views, agg.secs,
              (SELECT COUNT(*) FROM v WHERE v.rn_last  = 1 AND v.path = agg.path),
              (SELECT COUNT(*) FROM v WHERE v.rn_first = 1 AND v.path = agg.path)
         FROM agg`
    ).run({ day: d, from, to });

    db.prepare(
      `INSERT INTO usage_daily_city (day, city, views, wall_views, unlocks)
       WITH v AS (SELECT subject city, COUNT(*) n FROM events
                   WHERE name='page_view' AND path LIKE '/city/%' AND subject IS NOT NULL
                     AND created_at BETWEEN @from AND @to GROUP BY subject),
            w AS (SELECT subject city, COUNT(*) n FROM events
                   WHERE name='unlock_prompt_seen' AND subject IS NOT NULL
                     AND created_at BETWEEN @from AND @to GROUP BY subject),
            u AS (${hasUnlocks
              ? `SELECT city_name city, COUNT(*) n FROM city_unlocks
                   WHERE created_at BETWEEN @from AND @to GROUP BY city_name`
              : "SELECT NULL city, 0 n WHERE 0"}),
            all_cities AS (SELECT city FROM v UNION SELECT city FROM w UNION SELECT city FROM u)
       SELECT @day, a.city, COALESCE(v.n,0), COALESCE(w.n,0), COALESCE(u.n,0)
         FROM all_cities a
         LEFT JOIN v ON v.city = a.city
         LEFT JOIN w ON w.city = a.city
         LEFT JOIN u ON u.city = a.city`
    ).run({ day: d, from, to });
  });
  run();

  const counts = db.prepare(
    `SELECT (SELECT sessions FROM usage_daily WHERE day = @day) sessions,
            (SELECT COUNT(*) FROM usage_daily_page WHERE day = @day) pages,
            (SELECT COUNT(*) FROM usage_daily_city WHERE day = @day) cities`
  ).get({ day: d }) as { sessions: number; pages: number; cities: number };

  return { day: d, sessions: Number(counts.sessions || 0), pages: Number(counts.pages || 0), cities: Number(counts.cities || 0) };
}

/**
 * A calendar date N days back, computed by SQLite rather than in JS.
 *
 * The aggregate rows are keyed on the same date() the read queries use. A
 * timezone difference between a JS Date and SQLite's would produce days that
 * simply never join — no error, just an empty panel.
 */
export function dayOffset(daysBack: number): string {
  ensureTables();
  return (appDb().prepare("SELECT date('now', ?) d").get(`-${Math.max(0, Math.floor(daysBack))} days`) as { d: string }).d;
}

export interface DailyRow {
  day: string; sessions: number; pageViews: number; seconds: number; bounces: number;
  signups: number; unlocks: number; errors: number;
}

/** The daily series for the dashboard's trend line — from the aggregate, not the log. */
export function usageTrend(days = 30): DailyRow[] {
  try {
    ensureTables();
    return (appDb().prepare(
      `SELECT day, sessions, page_views pageViews, seconds, bounces, signups, unlocks, errors
         FROM usage_daily WHERE day >= date('now', ?) ORDER BY day ASC`
    ).all(`-${Math.max(1, Math.min(730, days))} days`) as DailyRow[]);
  } catch { return []; }
}

/** Whether the roll-up has ever run, and how far it reaches. */
export function rollupCoverage(): { days: number; first: string | null; last: string | null } {
  try {
    ensureTables();
    const r = appDb().prepare(
      "SELECT COUNT(*) days, MIN(day) first, MAX(day) last FROM usage_daily"
    ).get() as { days: number; first: string | null; last: string | null };
    return { days: Number(r.days || 0), first: r.first, last: r.last };
  } catch { return { days: 0, first: null, last: null }; }
}
