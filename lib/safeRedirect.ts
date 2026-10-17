/**
 * The one place a `?next=` value is turned into a redirect target.
 *
 * `startsWith("/") && !startsWith("//")` was the check in four files, and it
 * let `/\evil.com` through: browsers (and WHATWG `new URL`) treat a backslash
 * as a slash, so `Location: /\evil.com` leaves the site. The only safe test is
 * to resolve the value against our own origin and insist the result stayed
 * there; a value that fails goes to the default, never to an error page.
 */
export const DEFAULT_NEXT = "/deals";

export function safeNext(raw: unknown, fallback: string = DEFAULT_NEXT): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s.startsWith("/") || s.startsWith("//")) return fallback;
  // backslashes, control characters and anything that would be percent-mangled
  // into a scheme are not paths of ours
  if (/[\\\u0000-\u001f\u007f]/.test(s) || /^\/[\\/]/.test(s)) return fallback;
  try {
    const u = new URL(s, "https://karnaf.invalid");
    if (u.origin !== "https://karnaf.invalid") return fallback;
    if (u.username || u.password) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
