import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { withBasePath } from "@/lib/basePath";

/**
 * Behind Traefik the app sees plain HTTP, so `req.url` is `http://…` — and a
 * redirect built from it points at an origin no router serves (the 404 every
 * logout hit in production). KARNAF_SITE_URL is the canonical public origin;
 * req.url remains only the local-dev fallback.
 */
function homeUrl(req: Request): URL {
  const base = process.env.KARNAF_SITE_URL?.replace(/\/$/, "") || req.url;
  return new URL(withBasePath("/"), base);
}

/**
 * Logging out mutates state, so it lives on POST: browsers and Next prefetch
 * GET links, and a prefetched /logout silently ended the session of anyone
 * whose pointer hovered near the nav.
 */
export async function POST(req: Request) {
  destroySession();
  // 303 turns the follow-up request into a GET of the home page.
  return NextResponse.redirect(homeUrl(req), 303);
}

/** Old bookmarks and prefetches land here — send them home, session intact. */
export async function GET(req: Request) {
  return NextResponse.redirect(homeUrl(req));
}
