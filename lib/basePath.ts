/**
 * basePath-aware URL builder for the places Next.js does NOT handle for you.
 *
 * WHY THIS EXISTS
 * The site is likely to move under a path on the main domain
 * (karnafnadlan.com/analist). Setting `basePath` in next.config.mjs rewrites
 * routing and `<Link href>` automatically — but it does NOT touch:
 *
 *   - `fetch("/api/…")` from client components (13 call sites in 6 files)
 *   - raw `<a href="/…">` anchors (4)
 *   - `new URL("/", req.url)` in route handlers
 *   - `window.history.replaceState` with a hand-built path
 *   - links to files under public/ built as strings (report PDFs)
 *
 * Every one of those keeps pointing at the domain root and 404s the moment a
 * basePath is set. Because a URL change after launch is effectively
 * irreversible — Google has indexed them, people have shared them — the code is
 * made basePath-ready NOW, while the switch itself stays a config change.
 *
 * WITH THE ENV VAR UNSET (the default, and the state today) withBasePath() is
 * the identity function, so wiring it in changes nothing observable. That is
 * the point: the risky part is decoupled from the mechanical part.
 *
 * WHAT NOT TO WRAP — wrapping these BREAKS them:
 *   - `<Link href>` — Next prefixes it already; wrapping doubles the prefix
 *   - `revalidatePath("/deals")` — takes an internal route, not a URL
 *   - middleware matchers — matched before the basePath is stripped
 */

/**
 * Configured base path, normalised to either "" or "/segment" (no trailing slash).
 *
 * Read from NEXT_PUBLIC_BASE_PATH so the same value is available in server and
 * client bundles. It must be inlined at build time, so it is referenced as a
 * full literal `process.env.NEXT_PUBLIC_BASE_PATH` — destructuring or dynamic
 * indexing would defeat Next's replacement and yield undefined in the browser.
 */
export const BASE_PATH: string = (() => {
  const raw = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  if (!raw || raw === "/") return "";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
})();

/**
 * Prefix an app-absolute path with the base path.
 *
 * Absolute URLs, protocol-relative URLs, and anything already prefixed are
 * returned untouched, so this is safe to apply more than once.
 */
export function withBasePath(path: string): string {
  if (!BASE_PATH) return path;
  if (!path.startsWith("/")) return path;        // relative or a fragment — leave it
  if (path.startsWith("//")) return path;        // protocol-relative
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) return path; // idempotent
  return `${BASE_PATH}${path}`;
}

/**
 * The path the browser is on, with the base path removed.
 *
 * `usePathname()` already strips the base path, so building a URL from it and
 * handing that to history.replaceState silently drops the prefix. This exists
 * so the round trip through withBasePath() is explicit at those call sites.
 */
export function stripBasePath(path: string): string {
  if (!BASE_PATH) return path;
  if (path === BASE_PATH) return "/";
  return path.startsWith(`${BASE_PATH}/`) ? path.slice(BASE_PATH.length) : path;
}
