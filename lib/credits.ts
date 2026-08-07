/**
 * Credits engine — the site's access currency.
 *
 * MODEL (decided 7.8, see plan):
 *   - signup grants a starter balance; referrals, approved feedback and (until
 *     subscriptions exist) a small monthly grant top it up.
 *   - opening a city page costs credits and unlocks that city for a window
 *     (city_unlocks); repeat views inside the window are free.
 *   - every number here is an admin-editable system rule, so pricing arguments
 *     are settled with a click, not a deploy.
 *
 * STORAGE
 *   - Balances are a SUM over an append-only ledger, never a mutable column:
 *     the ledger IS the audit trail, and a bug can be diagnosed and reversed
 *     row by row.
 *   - Amounts are stored in TENTHS of a credit as INTEGERs ("deal_save_cost"
 *     is 0.5) — floats in a money-like column round differently on every code
 *     path that touches them.
 *
 * CONCURRENCY: every spend runs inside a better-sqlite3 transaction —
 * balance check and debit are atomic, so two parallel unlock clicks cannot
 * both pass the balance check.
 */
import crypto from "crypto";
import { appDb } from "./appDb";
import { getRuleNum } from "./systemRules";

/* ── schema ──────────────────────────────────────────────────────────────── */

let ensured = false;
function ensureCreditTables() {
  if (ensured) return;
  appDb().exec(`
    CREATE TABLE IF NOT EXISTS credits_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      delta_tenths INTEGER NOT NULL,
      reason TEXT NOT NULL,      -- signup | city_unlock | deal_save | referral | feedback | monthly_grant | admin | subscription
      ref_id TEXT,               -- city name / referred-user id / whatever disambiguates
      created_at DATETIME NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_credits_user ON credits_ledger(user_id);
    CREATE INDEX IF NOT EXISTS idx_credits_reason ON credits_ledger(user_id, reason);
    CREATE TABLE IF NOT EXISTS city_unlocks (
      user_id INTEGER NOT NULL,
      city_name TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, city_name)
    );
  `);
  ensured = true;
}

/** "u123" (AuthUser.id) → 123. Accepts a bare number too. */
function uid(userId: string | number): number {
  return typeof userId === "number" ? userId : Number(String(userId).replace(/^u/, ""));
}

/* ── rules (all admin-editable; defaults are the decided model) ──────────── */

export const CREDIT_RULES = {
  signupBonus: () => getRuleNum("signup_bonus", 10),
  cityUnlockCost: () => getRuleNum("city_unlock_cost", 1),
  unlockDays: () => getRuleNum("unlock_days", 7),
  dealSaveCost: () => getRuleNum("deal_save_cost", 0),
  referralBonus: () => getRuleNum("referral_bonus", 5),
  referralDailyCap: () => getRuleNum("referral_daily_cap", 5),
  feedbackBonus: () => getRuleNum("feedback_bonus", 2),
  monthlyFreeGrant: () => getRuleNum("monthly_free_grant", 2),
};

/* ── balance & ledger ────────────────────────────────────────────────────── */

export function balanceTenths(userId: string | number): number {
  ensureCreditTables();
  const row = appDb().prepare("SELECT COALESCE(SUM(delta_tenths),0) s FROM credits_ledger WHERE user_id=?")
    .get(uid(userId)) as { s: number };
  return row.s;
}

/** Balance in whole credits, for display (e.g. 7.5). */
export function balance(userId: string | number): number {
  return balanceTenths(userId) / 10;
}

export interface LedgerEntry {
  delta_tenths: number;
  reason: string;
  ref_id: string | null;
  created_at: string;
}

export function ledgerFor(userId: string | number, limit = 50): LedgerEntry[] {
  ensureCreditTables();
  return appDb().prepare(
    "SELECT delta_tenths, reason, ref_id, created_at FROM credits_ledger WHERE user_id=? ORDER BY id DESC LIMIT ?"
  ).all(uid(userId), limit) as LedgerEntry[];
}

/** Unconditional grant (positive delta). Idempotent per (reason, ref_id) when refId is given. */
export function grant(userId: string | number, tenths: number, reason: string, refId?: string): boolean {
  ensureCreditTables();
  if (tenths <= 0) return false;
  const id = uid(userId);
  if (refId != null) {
    const dup = appDb().prepare(
      "SELECT 1 FROM credits_ledger WHERE user_id=? AND reason=? AND ref_id=?"
    ).get(id, reason, refId);
    if (dup) return false;
  }
  appDb().prepare("INSERT INTO credits_ledger (user_id, delta_tenths, reason, ref_id) VALUES (?, ?, ?, ?)")
    .run(id, tenths, reason, refId ?? null);
  return true;
}

/**
 * Atomic spend: debit `tenths` if — and only if — the balance covers it.
 */
export function trySpend(userId: string | number, tenths: number, reason: string, refId?: string): { ok: true } | { ok: false; balanceTenths: number } {
  ensureCreditTables();
  if (tenths <= 0) return { ok: true }; // a zero cost is a no-op, not a ledger row
  const id = uid(userId);
  const db = appDb();
  const tx = db.transaction((): { ok: true } | { ok: false; balanceTenths: number } => {
    const bal = (db.prepare("SELECT COALESCE(SUM(delta_tenths),0) s FROM credits_ledger WHERE user_id=?").get(id) as { s: number }).s;
    if (bal < tenths) return { ok: false, balanceTenths: bal };
    db.prepare("INSERT INTO credits_ledger (user_id, delta_tenths, reason, ref_id) VALUES (?, ?, ?, ?)")
      .run(id, -tenths, reason, refId ?? null);
    return { ok: true };
  });
  return tx();
}

/* ── lifecycle grants ────────────────────────────────────────────────────── */

/** Once per account — idempotency keyed on the fixed ref "signup". */
export function grantSignupBonus(userId: string | number) {
  grant(userId, CREDIT_RULES.signupBonus() * 10, "signup", "signup");
}

/**
 * Free-tier monthly grant — the bridge until subscriptions launch (rule to 0
 * to turn it off). Lazy: granted when the user next does anything credit-
 * related in a fresh month, keyed on "YYYY-MM" so it cannot double-fire.
 */
export function grantMonthlyIfDue(userId: string | number) {
  const monthly = CREDIT_RULES.monthlyFreeGrant();
  if (monthly <= 0) return;
  const month = new Date().toISOString().slice(0, 7);
  grant(userId, monthly * 10, "monthly_grant", month);
}

/* ── city unlocks ────────────────────────────────────────────────────────── */

export function isCityUnlocked(userId: string | number, cityName: string): boolean {
  ensureCreditTables();
  return !!appDb().prepare(
    "SELECT 1 FROM city_unlocks WHERE user_id=? AND city_name=? AND expires_at > datetime('now')"
  ).get(uid(userId), cityName);
}

export type UnlockResult =
  | { ok: true; alreadyUnlocked: boolean }
  | { ok: false; error: "insufficient"; balanceTenths: number; costTenths: number };

/**
 * Unlock a city for unlock_days. Free if a live unlock exists; otherwise
 * spends city_unlock_cost. The spend and the unlock upsert run in ONE
 * transaction — a debit without an unlock (or the reverse) cannot happen.
 */
export function unlockCity(userId: string | number, cityName: string): UnlockResult {
  ensureCreditTables();
  const id = uid(userId);
  if (isCityUnlocked(id, cityName)) return { ok: true, alreadyUnlocked: true };

  grantMonthlyIfDue(id); // a fresh month's grant should count toward this unlock

  const costTenths = CREDIT_RULES.cityUnlockCost() * 10;
  const days = Math.max(1, CREDIT_RULES.unlockDays());
  const db = appDb();
  const tx = db.transaction((): UnlockResult => {
    if (costTenths > 0) {
      const bal = (db.prepare("SELECT COALESCE(SUM(delta_tenths),0) s FROM credits_ledger WHERE user_id=?").get(id) as { s: number }).s;
      if (bal < costTenths) return { ok: false, error: "insufficient", balanceTenths: bal, costTenths };
      db.prepare("INSERT INTO credits_ledger (user_id, delta_tenths, reason, ref_id) VALUES (?, ?, 'city_unlock', ?)")
        .run(id, -costTenths, cityName);
    }
    db.prepare(`
      INSERT INTO city_unlocks (user_id, city_name, expires_at)
      VALUES (?, ?, datetime('now', '+' || ? || ' days'))
      ON CONFLICT(user_id, city_name) DO UPDATE SET expires_at = excluded.expires_at
    `).run(id, cityName, days);
    return { ok: true, alreadyUnlocked: false };
  });
  return tx();
}

export function unlockedCities(userId: string | number): Array<{ city_name: string; expires_at: string }> {
  ensureCreditTables();
  return appDb().prepare(
    "SELECT city_name, expires_at FROM city_unlocks WHERE user_id=? AND expires_at > datetime('now') ORDER BY expires_at DESC"
  ).all(uid(userId)) as Array<{ city_name: string; expires_at: string }>;
}

/* ── referrals ───────────────────────────────────────────────────────────── */

/** The user's own share code, minted on first request. Short, unambiguous alphabet. */
export function referralCodeFor(userId: string | number): string {
  ensureCreditTables();
  const id = uid(userId);
  const row = appDb().prepare("SELECT referral_code FROM users WHERE id=?").get(id) as { referral_code: string | null } | undefined;
  if (row?.referral_code) return row.referral_code;
  // 8 chars from a 30-char alphabet (no 0/O/1/I/L) ≈ 6.5e11 — collisions retried anyway
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ2345678";
  for (let attempt = 0; attempt < 5; attempt++) {
    let code = "";
    const bytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) code += alphabet[bytes[i] % alphabet.length];
    try {
      appDb().prepare("UPDATE users SET referral_code=? WHERE id=? AND referral_code IS NULL").run(code, id);
      const check = appDb().prepare("SELECT referral_code FROM users WHERE id=?").get(id) as { referral_code: string | null };
      if (check.referral_code) return check.referral_code;
    } catch { /* unique clash — retry with fresh bytes */ }
  }
  return "";
}

/**
 * Credit the owner of `code` for referring `newUserId`. Called once, right
 * after registration. Caps and self-referral are enforced here, not trusted
 * from the form.
 */
export function applyReferral(code: string, newUserId: string | number): void {
  ensureCreditTables();
  const c = code.trim().toUpperCase();
  if (!/^[A-Z2-9]{4,16}$/.test(c)) return;
  const referrer = appDb().prepare("SELECT id FROM users WHERE referral_code=?").get(c) as { id: number } | undefined;
  const newId = uid(newUserId);
  if (!referrer || referrer.id === newId) return;

  appDb().prepare("UPDATE users SET referred_by=? WHERE id=? AND referred_by IS NULL").run(referrer.id, newId);

  // daily cap — a burst of self-made accounts stops paying after N
  const todayCount = (appDb().prepare(
    "SELECT COUNT(*) n FROM credits_ledger WHERE user_id=? AND reason='referral' AND created_at >= date('now')"
  ).get(referrer.id) as { n: number }).n;
  if (todayCount >= CREDIT_RULES.referralDailyCap()) return;

  // idempotent per referred user — re-submitting the form cannot double-credit
  grant(referrer.id, CREDIT_RULES.referralBonus() * 10, "referral", `u${newId}`);
}

/** One-time bonus when an admin approves this user's feedback. */
export function grantFeedbackBonus(userId: string | number) {
  grant(userId, CREDIT_RULES.feedbackBonus() * 10, "feedback", "first-approved");
}
