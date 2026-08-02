/**
 * Dormant personal-account infrastructure (user directive): fully working
 * register/login/session layer, but NOTHING requires login — an anonymous
 * visitor keeps full access and /deals falls back to the owner workspace.
 * Self-contained (scrypt + sqlite sessions); OAuth/Stripe attach here later.
 */
import { cookies } from "next/headers";
import crypto from "crypto";
import { appDb } from "./appDb";

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

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

export function registerUser(email: string, name: string, password: string): { ok: true } | { ok: false; error: string } {
  ensureAuthTables();
  const em = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return { ok: false, error: "כתובת אימייל לא תקינה" };
  if (password.length < 6) return { ok: false, error: "סיסמה קצרה מדי (6 תווים לפחות)" };
  if (!name.trim()) return { ok: false, error: "חסר שם" };
  const exists = appDb().prepare("SELECT 1 FROM users WHERE email=?").get(em);
  if (exists) return { ok: false, error: "האימייל כבר רשום — נסה להתחבר" };
  const salt = crypto.randomBytes(16).toString("hex");
  appDb().prepare("INSERT INTO users (email, name, password_hash, salt) VALUES (?, ?, ?, ?)")
    .run(em, name.trim(), hashPassword(password, salt), salt);
  return { ok: true };
}

export function verifyLogin(email: string, password: string): AuthUser | null {
  ensureAuthTables();
  const u = appDb().prepare("SELECT * FROM users WHERE email=?").get(email.trim().toLowerCase()) as any;
  if (!u) return null;
  const hash = hashPassword(password, u.salt);
  if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(u.password_hash))) return null;
  return { id: `u${u.id}`, email: u.email, name: u.name, tier: u.tier };
}

export function createSession(user: AuthUser) {
  ensureAuthTables();
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

/** The logged-in user, or null — anonymous visitors are always allowed. */
export function getCurrentUser(): AuthUser | null {
  try {
    const token = cookies().get(SESSION_COOKIE)?.value;
    if (!token) return null;
    ensureAuthTables();
    const row = appDb().prepare(
      `SELECT u.id, u.email, u.name, u.tier FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token=? AND s.expires_at > datetime('now')`
    ).get(token) as any;
    return row ? { id: `u${row.id}`, email: row.email, name: row.name, tier: row.tier } : null;
  } catch {
    return null;
  }
}

/** Workspace id for user-content tables: logged-in user, else the owner workspace. */
export function workspaceId(): string {
  return getCurrentUser()?.id ?? "owner";
}
