import { appDb } from "./appDb";

/**
 * Visitor feedback.
 *
 * WHY THE DATABASE IS THE SOURCE OF TRUTH, NOT A SPREADSHEET
 * The obvious build is "post the form straight to Google Sheets". It is also
 * the one that loses feedback: any hiccup at Google — an expired credential, a
 * quota, a network blip — and the submission is gone, with the visitor told it
 * was received. Writing locally first means the only way to lose a report is to
 * lose the database, and a mirror to Sheets becomes a sync job that can retry
 * instead of a single point of failure on the request path.
 *
 * THE `wrong_data` CATEGORY IS THE POINT
 * A reader who says "this number looks wrong for my street" is doing the most
 * valuable thing anyone can do for a data product — and is the person most
 * likely to give up if there is nowhere to say it. That category exists so
 * corrections have a route in, and so they are separable from feature requests
 * when triaging.
 */

// Kinds and labels live in ./feedbackTypes so client components can import them
// without dragging better-sqlite3 (and Node's fs) into the browser bundle.
export { FEEDBACK_KINDS, KIND_LABELS, type FeedbackKind } from "./feedbackTypes";
import { FEEDBACK_KINDS, type FeedbackKind } from "./feedbackTypes";

export interface FeedbackInput {
  kind: FeedbackKind;
  message: string;
  /** 1–5, only meaningful for kind="rating" */
  rating?: number | null;
  /** optional — the visitor decides whether they want a reply */
  email?: string | null;
  /** auto-captured context, so a report is actionable without a follow-up */
  path?: string | null;
  city?: string | null;
  /** active chart series / filters, serialized by the widget */
  viewState?: string | null;
  viewport?: string | null;
  sessionId?: string | null;
  /** git SHA of the running build, so a fixed bug can be told from a live one */
  buildSha?: string | null;
  /** numeric users.id when signed in — the hook the feedback credit-bonus hangs on */
  userId?: number | null;
}

let ensured = false;
function ensureTable() {
  if (ensured) return;
  appDb().exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      rating INTEGER,
      email TEXT,
      path TEXT,
      city TEXT,
      view_state TEXT,
      viewport TEXT,
      session_id TEXT,
      build_sha TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      -- mirror bookkeeping: NULL until a sync run ships it onward
      synced_at DATETIME,
      sync_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_feedback_unsynced ON feedback(synced_at) WHERE synced_at IS NULL;
  `);
  // additive migrations for rows created before the credits model
  const cols = appDb().prepare("PRAGMA table_info(feedback)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "user_id")) appDb().exec("ALTER TABLE feedback ADD COLUMN user_id INTEGER");
  if (!cols.some((c) => c.name === "approved_at")) appDb().exec("ALTER TABLE feedback ADD COLUMN approved_at DATETIME");
  ensured = true;
}

/** For readers outside this module (the admin panel) — same lazy migration. */
export function ensureFeedbackTable() { ensureTable(); }

const trim = (v: string | null | undefined, max: number): string | null => {
  const s = (v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

export interface SaveResult { ok: boolean; id?: number; error?: string }

export function saveFeedback(input: FeedbackInput): SaveResult {
  try {
    if (!FEEDBACK_KINDS.includes(input.kind)) return { ok: false, error: "סוג לא תקין" };
    const message = trim(input.message, 4000);
    // A rating can stand on its own; everything else needs words to be useful.
    if (!message && input.kind !== "rating") return { ok: false, error: "נא לכתוב הודעה" };

    const rating = input.kind === "rating" && Number.isFinite(input.rating)
      ? Math.min(5, Math.max(1, Math.round(Number(input.rating))))
      : null;

    const email = trim(input.email, 254);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { ok: false, error: "כתובת אימייל לא תקינה" };
    }

    ensureTable();
    const r = appDb().prepare(
      `INSERT INTO feedback (kind, message, rating, email, path, city, view_state, viewport, session_id, build_sha, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.kind, message ?? "", rating, email,
      trim(input.path, 300), trim(input.city, 120), trim(input.viewState, 1000),
      trim(input.viewport, 40), trim(input.sessionId, 64), trim(input.buildSha, 60),
      input.userId ?? null
    );
    return { ok: true, id: Number(r.lastInsertRowid) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "שגיאה" };
  }
}

export interface FeedbackRow {
  id: number; kind: string; message: string; rating: number | null; email: string | null;
  path: string | null; city: string | null; view_state: string | null; viewport: string | null;
  session_id: string | null; build_sha: string | null; created_at: string;
  synced_at: string | null; sync_error: string | null;
}

/** Newest first — what the admin screen shows. */
export function listFeedback(limit = 100): FeedbackRow[] {
  try {
    ensureTable();
    return appDb().prepare(
      "SELECT * FROM feedback ORDER BY id DESC LIMIT ?"
    ).all(Math.min(500, Math.max(1, limit))) as FeedbackRow[];
  } catch {
    return [];
  }
}

/** Rows a mirror job has not shipped yet. */
export function unsyncedFeedback(limit = 200): FeedbackRow[] {
  try {
    ensureTable();
    return appDb().prepare(
      "SELECT * FROM feedback WHERE synced_at IS NULL ORDER BY id ASC LIMIT ?"
    ).all(Math.min(1000, Math.max(1, limit))) as FeedbackRow[];
  } catch {
    return [];
  }
}

export function markSynced(ids: number[]): void {
  if (!ids.length) return;
  try {
    ensureTable();
    const stmt = appDb().prepare("UPDATE feedback SET synced_at = CURRENT_TIMESTAMP, sync_error = NULL WHERE id = ?");
    appDb().transaction(() => { for (const id of ids) stmt.run(id); })();
  } catch { /* the row stays unsynced and the next run retries it */ }
}

export function markSyncError(ids: number[], error: string): void {
  if (!ids.length) return;
  try {
    ensureTable();
    const stmt = appDb().prepare("UPDATE feedback SET sync_error = ? WHERE id = ?");
    const msg = error.slice(0, 300);
    appDb().transaction(() => { for (const id of ids) stmt.run(msg, id); })();
  } catch { /* nothing more we can do here */ }
}
