/**
 * Operator-side user management: the functions behind the admin users tab and
 * the /api/admin/users endpoint (human + AI-agent access alike).
 *
 * DELETION IS A CASCADE, DELIBERATELY: a deleted account must not leave
 * orphaned personal data behind — sessions (or the user stays logged in!),
 * saved deals and their tasks, tracked cities, unlocks and the credit ledger
 * all go with it. Feedback rows are kept but detached (user_id nulled): they
 * are product signals, not personal workspace content.
 */
import crypto from "crypto";
import { appDb } from "./appDb";
import { adminSetUserPassword } from "./auth";
import { tenthsToCredits, adminAdjustCredits, setUnlimited, UNLIMITED_TIER } from "./credits";

export interface AdminUserRow {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  mailing_consent: number;
  google_id: string | null;
  created_at: string;
  ravmesser_synced_at: string | null;
  crm_synced_at: string | null;
  /** whole credits, may be fractional (tenths-backed) */
  credits: number;
  /** true = no credit limit at all; the balance above is meaningless */
  unlimited: boolean;
  deals: number;
  last_seen: string | null;
}

export function listUsers(): AdminUserRow[] {
  const rows = appDb().prepare(`
    SELECT u.id, u.email, u.name, u.phone, u.mailing_consent, u.google_id, u.created_at, u.tier,
           u.ravmesser_synced_at, u.crm_synced_at,
           COALESCE((SELECT SUM(delta_tenths) FROM credits_ledger c WHERE c.user_id = u.id), 0) AS credit_tenths,
           (SELECT COUNT(*) FROM client_deals d WHERE d.user_id = 'u' || u.id) AS deals,
           (SELECT MAX(created_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen
      FROM users u ORDER BY u.id DESC
  `).all() as Array<Omit<AdminUserRow, "unlimited"> & { credit_tenths: number; tier: string | null }>;
  return rows.map((r) => ({ ...r, credits: tenthsToCredits(r.credit_tenths), unlimited: r.tier === UNLIMITED_TIER }));
}

/**
 * Reset a user's password to a fresh random temporary one, returned ONCE so
 * the operator can hand it to the user over a trusted channel. All existing
 * sessions are revoked — a reset that leaves old sessions alive isn't one.
 */
export function resetUserPassword(userId: number): { ok: true; tempPassword: string } | { ok: false; error: string } {
  const u = appDb().prepare("SELECT id FROM users WHERE id=?").get(userId);
  if (!u) return { ok: false, error: "משתמש לא נמצא" };
  // readable alphabet (no 0/O/1/l), 12 chars — strong enough, dictatable over the phone
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(12);
  let temp = "";
  for (let i = 0; i < 12; i++) temp += alphabet[bytes[i] % alphabet.length];
  adminSetUserPassword(userId, temp);
  appDb().prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
  return { ok: true, tempPassword: temp };
}

export function deleteUser(userId: number): { ok: true } | { ok: false; error: string } {
  const u = appDb().prepare("SELECT id FROM users WHERE id=?").get(userId);
  if (!u) return { ok: false, error: "משתמש לא נמצא" };
  const db = appDb();
  const wid = `u${userId}`;
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM deal_tasks WHERE deal_id IN (SELECT id FROM client_deals WHERE user_id=?)").run(wid);
    db.prepare("DELETE FROM client_deals WHERE user_id=?").run(wid);
    db.prepare("DELETE FROM tracked_cities WHERE user_id=?").run(wid);
    db.prepare("DELETE FROM city_unlocks WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM credits_ledger WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
    try { db.prepare("UPDATE feedback SET user_id=NULL WHERE user_id=?").run(userId); } catch { /* table may not exist yet */ }
    db.prepare("DELETE FROM users WHERE id=?").run(userId);
  });
  tx();
  return { ok: true };
}

export function setUserConsent(userId: number, consent: boolean): boolean {
  const r = appDb().prepare("UPDATE users SET mailing_consent=? WHERE id=?").run(consent ? 1 : 0, userId);
  return r.changes > 0;
}

/**
 * Grant or revoke unlimited access.
 *
 * Returns the RESULTING state rather than a boolean "did the UPDATE run", so
 * the admin screen reflects what the database holds instead of what the click
 * intended — the two diverge exactly when it matters, on a user id that no
 * longer exists.
 */
export function setUserUnlimited(userId: number, unlimited: boolean): boolean {
  return setUnlimited(userId, unlimited);
}

/** Admin credit adjustment — positive or negative, always ledgered with a reason. */
export function adjustUserCredits(userId: number, credits: number, note: string): boolean {
  return adminAdjustCredits(userId, credits, note);
}
