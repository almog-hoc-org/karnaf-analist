import { cookies } from "next/headers";
import crypto from "crypto";

/**
 * Admin gate for the data-management dashboard.
 *
 * FAIL-CLOSED, AND WHY IT MATTERS
 * This used to return `true` whenever ADMIN_PASSWORD was unset, so a missing
 * environment variable — a silent, easy misconfiguration — opened the entire
 * dashboard to the internet. That is not a theoretical exposure: the admin
 * endpoint at app/api/admin/deals/route.ts accepts a filter object and can
 * exclude every deal in the archive in one request. A deployment that forgets
 * the variable must lose admin access, never grant it to everyone.
 *
 * The only exemption is an explicit local development run (NODE_ENV
 * === "development"), so `npm run dev` stays frictionless. Production and any
 * other environment require the password, full stop.
 *
 * The cookie value is a RANDOM per-process secret, not a hash of the password.
 * A password-derived token is stable forever: once it leaks — a shared browser,
 * a screenshot, a synced profile — it grants access until the password itself
 * is changed, and it is identical across every machine that ever logged in.
 * A random secret can be rotated by restarting the process, and reveals nothing
 * about the password.
 */
export const ADMIN_COOKIE = "karnaf_admin";

/** True only for a genuine local `next dev` run. */
function isLocalDev(): boolean {
  return process.env.NODE_ENV === "development";
}

/**
 * The value a valid admin cookie must carry.
 *
 * Generated once per process and held in memory. Pinned to globalThis because
 * Next may evaluate this module in several bundles (route handlers, server
 * components, middleware chunks) — without the pin each bundle would mint its
 * own secret and a cookie set by one would be rejected by another.
 *
 * Set ADMIN_TOKEN_SECRET to keep sessions alive across restarts and across
 * multiple app instances behind a load balancer.
 */
const g = globalThis as unknown as { __karnafAdminSecret?: string };
function adminSecret(): string {
  if (process.env.ADMIN_TOKEN_SECRET) return process.env.ADMIN_TOKEN_SECRET;
  if (!g.__karnafAdminSecret) g.__karnafAdminSecret = crypto.randomBytes(32).toString("hex");
  return g.__karnafAdminSecret;
}

/** The expected cookie value, or null when admin access is impossible. */
export function adminToken(): string | null {
  if (!process.env.ADMIN_PASSWORD) return null;
  // bound to the password so changing it invalidates every issued cookie
  return crypto.createHmac("sha256", adminSecret())
    .update(process.env.ADMIN_PASSWORD)
    .digest("hex");
}

/** Constant-time compare that tolerates length mismatch instead of throwing. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function isAdminRequest(): boolean {
  const expected = adminToken();
  // No password configured: open ONLY for a local dev run, closed everywhere else.
  if (!expected) return isLocalDev();
  const got = cookies().get(ADMIN_COOKIE)?.value;
  return !!got && safeEqual(got, expected);
}

/** Whether an admin password is configured at all — lets the UI explain itself. */
export function adminConfigured(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}
