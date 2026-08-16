/**
 * In-memory rate limiter for credential endpoints (login, register, admin).
 *
 * WHY IN-MEMORY IS THE RIGHT CHOICE HERE
 * The app runs as ONE Node process on one server, so a process-local map is a
 * complete view of traffic — no shared store required, no network hop on the
 * hot path, nothing extra to operate. If the app is ever scaled to several
 * instances behind a load balancer this becomes per-instance (an attacker gets
 * N× the budget), and it should move to a shared store. Until then, a
 * dependency-free limiter that always works beats a distributed one that has to
 * be kept alive.
 *
 * A restart clears the counters. That is an acceptable trade: restarts are rare
 * and operator-driven, while the attack this blocks is a sustained guessing run.
 */

interface Bucket {
  /** attempt timestamps (ms) inside the current window */
  hits: number[];
  /** set once tripped — blocks even if the window would have drained */
  blockedUntil: number;
}

const buckets = new Map<string, Bucket>();

/** Drop buckets nothing has touched for an hour so the map can't grow forever. */
const SWEEP_AFTER_MS = 60 * 60 * 1000;
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < SWEEP_AFTER_MS) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    const newest = b.hits.length ? b.hits[b.hits.length - 1] : 0;
    if (now - Math.max(newest, b.blockedUntil) > SWEEP_AFTER_MS) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** seconds until the caller may retry (0 when ok) */
  retryAfter: number;
}

/**
 * Consume one attempt against `key`.
 *
 * @param key       identity to limit on — "<scope>:<ip>"
 * @param limit     attempts allowed inside the window
 * @param windowMs  rolling window length
 * @param blockMs   lockout once the limit is exceeded (defaults to the window)
 */
export function rateLimit(key: string, limit: number, windowMs: number, blockMs = windowMs): RateLimitResult {
  const now = Date.now();
  sweep(now);

  let b = buckets.get(key);
  if (!b) { b = { hits: [], blockedUntil: 0 }; buckets.set(key, b); }

  if (b.blockedUntil > now) {
    return { ok: false, retryAfter: Math.ceil((b.blockedUntil - now) / 1000) };
  }

  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= limit) {
    b.blockedUntil = now + blockMs;
    b.hits = [];
    return { ok: false, retryAfter: Math.ceil(blockMs / 1000) };
  }

  b.hits.push(now);
  return { ok: true, retryAfter: 0 };
}

/** Clear a key's budget — call after a SUCCESSFUL login so honest users aren't penalised. */
export function rateLimitReset(key: string) {
  buckets.delete(key);
}

/**
 * Best-effort client IP.
 *
 * Behind Caddy/Cloudflare the socket address is the proxy, so the forwarded
 * headers are the only signal available. They are client-controlled and can be
 * forged — which is fine for this purpose: a forged value costs the attacker a
 * fresh bucket, exactly what a new IP would, and the limiter is a speed bump
 * rather than an authorisation boundary. Never use this for access control.
 */
export function clientIp(headers: Headers): string {
  // cf-connecting-ip is deliberately NOT consulted. This deployment sits behind
  // Traefik, not Cloudflare, so nothing ever sets that header legitimately —
  // which made it a free reset button: any client could send its own value and
  // get a fresh bucket on every request. x-forwarded-for and x-real-ip are the
  // two Traefik actually writes.
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}
