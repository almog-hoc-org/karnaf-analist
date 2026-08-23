import { cookies } from "next/headers";
import { appDb } from "./appDb";
import { getRuleNum } from "./systemRules";
import { ensureCreditTables } from "./credits";

/**
 * Two full city pages for a visitor with no account, and no screen in between.
 *
 * THE QUESTION THIS ANSWERS ("is it possible without registering — by IP?")
 * Not by IP, and the reasons are not squeamishness:
 *
 *   - IP IS SHARED. Every Israeli mobile network runs CGNAT: tens of thousands
 *     of subscribers behind one address. So do offices and buildings. One
 *     person spending their two cities would lock out everyone behind the same
 *     address — not an edge case, the normal case on a phone.
 *   - IP ALSO CHANGES. Walking from cellular onto Wi-Fi hands out a different
 *     address and the cities you opened vanish. It is simultaneously too COARSE
 *     (blocks strangers) and too LEAKY (loses you).
 *   - IP IS PERSONAL DATA THIS SITE PROMISES NOT TO COLLECT. The privacy notice
 *     says so in as many words. Using it is a policy change, not a detail.
 *
 * So: a random id in an httpOnly cookie, minted in middleware.ts, with the
 * grants stored HERE — server-side, keyed by that id. Storing them in the
 * cookie itself would put the entitlement in the visitor's hands; storing them
 * here also makes them countable in the usage dashboard.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * Clear the cookie (or open a private window) and you get a fresh allowance.
 * NO anonymous mechanism prevents that — IP does not (change networks),
 * fingerprinting does not (and is more invasive than the IP we just refused).
 * This is friction for a casual visitor, not enforcement, and it is the trade
 * the operator asked for: a lower barrier at the door in exchange for a lower
 * fence. If scraping ever becomes real, the answer is rate limiting at the
 * proxy, not a cleverer cookie.
 *
 * WHY NO HMAC SIGNATURE. A signature stops someone forging an id. But anyone
 * who wants two more cities just deletes the cookie and is handed a new, valid
 * id — so the signature would buy secret management and edge crypto in
 * exchange for nothing. The id is unguessable; it is not a capability.
 */

export const ANON_COOKIE = "karnaf_anon";
/** Same horizon as the analytics visitor id — one number for "how long we remember a browser". */
export const ANON_COOKIE_DAYS = 180;

let ensured = false;

function ensureAnonTables() {
  if (ensured) return;
  appDb().exec(`
    CREATE TABLE IF NOT EXISTS anon_unlocks (
      anon_id TEXT NOT NULL,
      city_name TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT (datetime('now')),
      claimed_by INTEGER,
      PRIMARY KEY (anon_id, city_name)
    );
    CREATE INDEX IF NOT EXISTS idx_anon_unlocks_id ON anon_unlocks(anon_id);
  `);
  ensured = true;
}

/**
 * Accept an id only if it looks like one we minted. Not a security boundary —
 * see the header — but it keeps a junk or hand-edited cookie from becoming a
 * row in the table, and bounds what reaches SQLite.
 */
export function isValidAnonId(id: string | undefined | null): id is string {
  return !!id && /^[A-Za-z0-9_-]{16,64}$/.test(id);
}

/** The current browser's anonymous id, or null when the cookie is absent/bad. */
export function anonId(): string | null {
  try {
    const raw = cookies().get(ANON_COOKIE)?.value;
    return isValidAnonId(raw) ? raw : null;
  } catch {
    return null; // outside a request scope (scripts, tests)
  }
}

/** How many free cities an anonymous visitor gets. 0 turns the whole thing off. */
export function anonFreeCities(): number {
  return Math.max(0, getRuleNum("anon_free_cities", 2));
}

export function anonUnlockedCities(id: string): string[] {
  ensureAnonTables();
  return (
    appDb()
      .prepare("SELECT city_name FROM anon_unlocks WHERE anon_id=? ORDER BY created_at")
      .all(id) as Array<{ city_name: string }>
  ).map((r) => r.city_name);
}

export function isAnonCityUnlocked(id: string, cityName: string): boolean {
  ensureAnonTables();
  return !!appDb()
    .prepare("SELECT 1 FROM anon_unlocks WHERE anon_id=? AND city_name=?")
    .get(id, cityName);
}

export interface AnonGrant {
  /** may this browser see this city right now */
  ok: boolean;
  /** how many of the free cities are spent AFTER this call */
  used: number;
  limit: number;
}

/**
 * Open a city for this browser, if it has a slot left.
 *
 * NO EXPIRY, unlike a paid unlock. A registered user's credit buys `unlock_days`
 * because it is a recurring allowance they can top up; an anonymous visitor has
 * exactly two and no way to earn more, so expiring them would take away the one
 * thing that makes the offer feel like a gift ("the cities stay open for that
 * visitor" — operator, 8/2026).
 *
 * Idempotent: re-reading a city already opened costs nothing.
 */
export function tryAnonUnlock(id: string, cityName: string): AnonGrant {
  ensureAnonTables();
  const limit = anonFreeCities();
  const db = appDb();

  const tx = db.transaction((): AnonGrant => {
    const rows = (
      db.prepare("SELECT city_name FROM anon_unlocks WHERE anon_id=?").all(id) as Array<{ city_name: string }>
    ).map((r) => r.city_name);

    if (rows.includes(cityName)) return { ok: true, used: rows.length, limit };
    if (rows.length >= limit) return { ok: false, used: rows.length, limit };

    db.prepare("INSERT OR IGNORE INTO anon_unlocks (anon_id, city_name) VALUES (?, ?)").run(id, cityName);
    return { ok: true, used: rows.length + 1, limit };
  });

  return tx();
}

/**
 * Carry the anonymous grants into a brand-new account.
 *
 * WITHOUT THIS, REGISTERING IS A DOWNGRADE: you read two cities for free, you
 * sign up because the site asked you to, and the two cities you were reading
 * close behind you. Nobody designs that on purpose; it is what happens when the
 * anonymous and signed-in paths are written separately.
 *
 * The rows are copied into `city_unlocks` at no credit cost and marked claimed,
 * so the signup bonus is on TOP of what the visitor already had. Claimed rows
 * stay in place rather than being deleted: the same browser signing in again
 * must not be handed a second free allowance.
 */
export function claimAnonUnlocks(userId: string | number, unlockDays: number, forId?: string): number {
  // `forId` exists so scripts/verify-anon-access.ts can exercise this without a
  // request scope. Callers in the app omit it and get the current browser's id.
  const id = forId ?? anonId();
  if (!isValidAnonId(id)) return 0;
  ensureAnonTables();

  const uid = typeof userId === "number" ? userId : Number(String(userId).replace(/^u/, ""));
  if (!Number.isFinite(uid) || uid <= 0) return 0;
  ensureCreditTables(); // this function writes into credits' table, so it owns making sure it exists

  const db = appDb();
  const tx = db.transaction((): number => {
    const rows = db
      .prepare("SELECT city_name FROM anon_unlocks WHERE anon_id=? AND claimed_by IS NULL")
      .all(id) as Array<{ city_name: string }>;
    const days = Math.max(1, unlockDays);
    for (const r of rows) {
      db.prepare(
        `INSERT INTO city_unlocks (user_id, city_name, expires_at)
         VALUES (?, ?, datetime('now', '+' || ? || ' days'))
         ON CONFLICT(user_id, city_name) DO UPDATE SET expires_at = excluded.expires_at`
      ).run(uid, r.city_name, days);
    }
    db.prepare("UPDATE anon_unlocks SET claimed_by=? WHERE anon_id=? AND claimed_by IS NULL").run(uid, id);
    return rows.length;
  });

  return tx();
}

/**
 * Requests that must NOT spend an anonymous slot.
 *
 * PREFETCH. Next's <Link> fetches a route's RSC payload on hover or on entering
 * the viewport, and the home page carries dozens of city links. Without this
 * check both free cities would be gone before the visitor clicked anything —
 * the same hazard that already forces the paid unlock to be a POST.
 *
 * CRAWLERS. Googlebot arrives with no cookies, so every one of its requests
 * looks like a brand-new visitor and would open a city. The result would be
 * Google indexing full pages at random instead of the public summary built for
 * exactly that purpose. A missed bot costs one wasted row; a missed prefetch
 * costs the visitor their allowance — so this errs toward not spending.
 */
const BOT_UA = /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|preview|lighthouse|headless/i;

export function mayConsumeAnonSlot(headers: {
  prefetch?: string | null;
  purpose?: string | null;
  userAgent?: string | null;
}): boolean {
  if (headers.prefetch) return false;
  if ((headers.purpose ?? "").toLowerCase() === "prefetch") return false;
  if (headers.userAgent && BOT_UA.test(headers.userAgent)) return false;
  return true;
}
