/**
 * The canonical public origin, usable OUTSIDE a request scope.
 *
 * lib/share.ts has siteUrl(), but it falls back to headers() — which throws in
 * sitemap.ts, robots.ts and generateMetadata during static generation. Those
 * need an answer without a request, so this is the constant-only version:
 * KARNAF_SITE_URL if set, otherwise the production domain.
 *
 * Hardcoding the fallback is deliberate. A sitemap or a canonical tag pointing
 * at localhost is worse than useless — it actively tells Google the wrong
 * thing — and unlike a share link there is no request to learn the host from.
 */
export const SITE_ORIGIN = (process.env.KARNAF_SITE_URL || "https://analyst.karnafnadlan.com").replace(/\/$/, "");

/** Absolute URL for an app path (no ref code — that is share.ts's job). */
export function absoluteUrl(path: string): string {
  return `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}
