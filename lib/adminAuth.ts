import { cookies } from "next/headers";
import crypto from "crypto";

/**
 * Minimal admin gate until full auth lands: /admin requires a cookie proving
 * knowledge of ADMIN_PASSWORD (env). When ADMIN_PASSWORD is unset (local dev),
 * the gate is open.
 */
export const ADMIN_COOKIE = "karnaf_admin";

export function adminToken(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  return crypto.createHash("sha256").update(pw).digest("hex").slice(0, 32);
}

export function isAdminRequest(): boolean {
  const tok = adminToken();
  if (!tok) return true; // dev: open
  return cookies().get(ADMIN_COOKIE)?.value === tok;
}
