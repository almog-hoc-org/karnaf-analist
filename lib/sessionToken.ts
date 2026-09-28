/**
 * What the sessions table stores for a session cookie.
 *
 * The cookie carries a random 32-byte token. Until 28.9.2026 the table stored
 * that token as-is, so anyone holding a copy of app.db (the weekly backup was
 * published to a public GitHub release) could sign in as any user with a live
 * session. The table now stores a SHA-256 of the token, prefixed with a version
 * tag so legacy raw rows can be told apart and swept.
 *
 * Pure (node:crypto only, no next/headers) so scripts and tests can use it.
 */
import crypto from "node:crypto";

export const SESSION_KEY_PREFIX = "h1:";

/** The value stored in sessions.token for a given cookie token. */
export function sessionKey(token: string): string {
  return SESSION_KEY_PREFIX + crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** True for a row written before hashing, which must never authenticate again. */
export function isLegacySessionKey(stored: string): boolean {
  return !stored.startsWith(SESSION_KEY_PREFIX);
}
