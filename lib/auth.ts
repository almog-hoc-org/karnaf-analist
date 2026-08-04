/**
 * Personal-account layer. Self-contained (scrypt + sqlite sessions);
 * OAuth/Stripe attach here later.
 *
 * ACCESS MODEL — deliberate, and the reason this file changed:
 * Every RESEARCH surface (cities, charts, rankings, comparisons) stays fully
 * open to anonymous visitors — that is the product we hand to the public.
 * Only the PERSONAL workspace (/deals — tracked cities, client deals, tasks)
 * requires an account.
 *
 * Until now workspaceId() fell back to the literal "owner" for anonymous
 * visitors, so every un-authenticated visitor shared ONE workspace, reading
 * and editing real clients' addresses, prices and private notes. That was
 * survivable while the site had exactly one user; it is a data breach the
 * moment the URL is public. There is no anonymous fallback any more —
 * personal data is reachable only by the account that owns it.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "crypto";
import { appDb } from "./appDb";
import { rethrowIfNextControlFlow } from "./nextControlFlow";

export const SESSION_COOKIE = "karnaf_session";
const SESSION_DAYS = 30;

export interface AuthUser {
  id: string;       // "u<rowid>" — used as user_id in client_deals/tracked_cities
  email: string;
  name: string;
  tier: string;     // 'free' for now; subscriptions flip this later
}

function ensureAuthTables() {
  appDb().exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'free',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Password hashing.
 *
 * Stored as `scrypt$N$r$p$<hex>` so the work factor travels WITH each hash.
 * Without that, raising the cost would lock out every existing account: the
 * verifier would derive a different key from the same password and reject it.
 * With it, old hashes keep verifying under their own parameters and are
 * transparently re-hashed at the next successful login.
 *
 * Legacy rows (bare hex, no "$") were written with Node's scrypt defaults
 * (N=16384, r=8, p=1) and are recognised by the absence of the prefix.
 */
const SCRYPT_N = 1 << 15; // 32768 — 2× the Node default
const SCRYPT_r = 8;
const SCRYPT_p = 1;

function derive(password: string, salt: string, N: number, r: number, p: number): Buffer {
  // scrypt needs ~128·N·r bytes; Node's 32MB default cap is below what N=32768
  // requires, so maxmem is raised in step with the parameters actually used.
  return crypto.scryptSync(password, salt, 64, { N, r, p, maxmem: 128 * N * r * 2 });
}

function hashPassword(password: string, salt: string): string {
  const hex = derive(password, salt, SCRYPT_N, SCRYPT_r, SCRYPT_p).toString("hex");
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${hex}`;
}

/** Constant-time compare that returns false on length mismatch instead of throwing. */
function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual THROWS RangeError on unequal lengths — a corrupt or
  // differently-formatted stored hash would surface as a 500 rather than
  // "wrong password". Length is not a secret, so checking it first is safe.
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Verify against whichever parameters the stored hash records. */
function passwordMatches(password: string, salt: string, stored: string): boolean {
  if (!stored.startsWith("scrypt$")) {
    // legacy: Node scrypt defaults, bare hex
    const legacy = derive(password, salt, 16384, 8, 1).toString("hex");
    return safeEqualHex(legacy, stored);
  }
  const [, nRaw, rRaw, pRaw, hex] = stored.split("$");
  const N = Number(nRaw), r = Number(rRaw), p = Number(pRaw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || !hex) return false;
  try {
    return safeEqualHex(derive(password, salt, N, r, p).toString("hex"), hex);
  } catch {
    return false; // unusable parameters in the stored row
  }
}

export const MIN_PASSWORD_LENGTH = 10;

export function registerUser(email: string, name: string, password: string): { ok: true } | { ok: false; error: string } {
  ensureAuthTables();
  const em = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return { ok: false, error: "כתובת אימייל לא תקינה" };
  if (em.length > 254) return { ok: false, error: "כתובת אימייל ארוכה מדי" };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `סיסמה קצרה מדי (${MIN_PASSWORD_LENGTH} תווים לפחות)` };
  }
  // scrypt runs over the whole input; an unbounded password is a free CPU burn.
  if (password.length > 200) return { ok: false, error: "סיסמה ארוכה מדי" };
  const nm = name.trim().slice(0, 80);
  if (!nm) return { ok: false, error: "חסר שם" };
  const exists = appDb().prepare("SELECT 1 FROM users WHERE email=?").get(em);
  if (exists) return { ok: false, error: "האימייל כבר רשום — נסה להתחבר" };
  const salt = crypto.randomBytes(16).toString("hex");
  appDb().prepare("INSERT INTO users (email, name, password_hash, salt) VALUES (?, ?, ?, ?)")
    .run(em, nm, hashPassword(password, salt), salt);
  return { ok: true };
}

/** Shape of a `users` row, as better-sqlite3 hands it back. */
interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  salt: string;
  tier: string;
}

export function verifyLogin(email: string, password: string): AuthUser | null {
  ensureAuthTables();
  const u = appDb().prepare("SELECT * FROM users WHERE email=?")
    .get(email.trim().toLowerCase()) as UserRow | undefined;
  if (!u) return null;
  if (!passwordMatches(password, u.salt, u.password_hash)) return null;

  // Opportunistic upgrade: a legacy or weaker hash is re-derived at the current
  // work factor now that the plaintext is in hand and known correct.
  if (!String(u.password_hash).startsWith(`scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$`)) {
    try {
      appDb().prepare("UPDATE users SET password_hash=? WHERE id=?")
        .run(hashPassword(password, u.salt), u.id);
    } catch { /* upgrade is best-effort — never fail a valid login over it */ }
  }

  return { id: `u${u.id}`, email: u.email, name: u.name, tier: u.tier };
}

/**
 * Delete expired sessions. Rows were only ever inserted, never removed, so the
 * table grew without bound — every login of every user, forever.
 *
 * Piggy-backs on login rather than running on a timer: it is the only moment
 * that already writes to this table, it is rare, and it keeps the sweep out of
 * the read path. Throttled so a burst of logins doesn't repeat the scan.
 */
let lastSessionSweep = 0;
const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
function sweepExpiredSessions() {
  const now = Date.now();
  if (now - lastSessionSweep < SESSION_SWEEP_INTERVAL_MS) return;
  lastSessionSweep = now;
  try {
    appDb().prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  } catch { /* housekeeping only — never block a login */ }
}

export function createSession(user: AuthUser) {
  ensureAuthTables();
  sweepExpiredSessions();
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  appDb().prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .run(token, Number(user.id.slice(1)), expires.toISOString());
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 86400, path: "/",
  });
}

export function destroySession() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) {
    try { appDb().prepare("DELETE FROM sessions WHERE token=?").run(token); } catch { /* ignore */ }
  }
  cookies().delete(SESSION_COOKIE);
}

/**
 * The logged-in user, or null. Nullable by design: every research page renders
 * fine for an anonymous visitor and just shows the logged-out nav. Callers that
 * need an identity must use requireWorkspaceId* below rather than defaulting.
 */
export function getCurrentUser(): AuthUser | null {
  try {
    const token = cookies().get(SESSION_COOKIE)?.value;
    if (!token) return null;
    ensureAuthTables();
    const row = appDb().prepare(
      `SELECT u.id, u.email, u.name, u.tier FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token=? AND s.expires_at > datetime('now')`
    ).get(token) as Pick<UserRow, "id" | "email" | "name" | "tier"> | undefined;
    return row ? { id: `u${row.id}`, email: row.email, name: row.name, tier: row.tier } : null;
  } catch (e) {
    // The catch is here for the DATABASE read — a missing table or a locked
    // file should degrade to "logged out", not blank the page. But cookies()
    // is inside this try too, and it throws to tell Next to render this page
    // dynamically. Swallowing that told the build every page was static while
    // the running server read cookies on every request, and Next answers 500
    // to a page that changes from static to dynamic at runtime.
    rethrowIfNextControlFlow(e);
    return null;
  }
}

/**
 * The workspace id for user-content tables, for a PAGE that must not render
 * without an account. Sends the visitor to /login and never returns otherwise.
 *
 * `redirect()` throws a control-flow signal Next catches, so the caller can
 * treat the return value as always-present.
 */
export function requireWorkspaceId(returnTo = "/deals"): string {
  const user = getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return user.id;
}

/**
 * The workspace id for a SERVER ACTION. Throws instead of redirecting: an
 * action reached without a session is not a navigation to correct, it is a
 * request that must not be honoured. Defence in depth — the page guard above
 * already turns anonymous visitors away, but actions are independently
 * callable and must never rely on that.
 */
export function requireWorkspaceIdForAction(): string {
  const user = getCurrentUser();
  if (!user) throw new Error("נדרשת התחברות");
  return user.id;
}
