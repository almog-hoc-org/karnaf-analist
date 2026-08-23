import { NextRequest, NextResponse } from "next/server";

// Simple HTTP Basic Auth gate.
// Enabled only when SITE_PASSWORD is set (so local dev stays open).
// Configure SITE_USER (optional, default "karnaf") and SITE_PASSWORD on Vercel.
const ANON_COOKIE = "karnaf_anon";
const ANON_COOKIE_DAYS = 180;

/**
 * Mint the anonymous-visitor id if this browser has none.
 *
 * WHY IT LIVES IN MIDDLEWARE and not in the city page that uses it: Next
 * forbids cookies().set() during a Server Component render, so a page cannot
 * hand itself an identity. Middleware is the only thing that runs before the
 * render and can still write a Set-Cookie header. Keeping the constants
 * duplicated here (rather than importing lib/anonAccess) is deliberate —
 * that module reaches better-sqlite3, which the edge runtime cannot load.
 *
 * httpOnly: nothing in the browser needs to read it, and a value client script
 * cannot touch is one less thing to keep out of the analytics payload.
 * SameSite=Lax: it must survive arriving from a Google result or a WhatsApp
 * link, which is the entire audience this feature exists for.
 */
function ensureAnonCookie(req: NextRequest, res: NextResponse): NextResponse {
  if (req.cookies.get(ANON_COOKIE)?.value) return res;

  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const id = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  res.cookies.set(ANON_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: ANON_COOKIE_DAYS * 24 * 60 * 60,
  });
  return res;
}

export function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return ensureAnonCookie(req, NextResponse.next());

  const expectedUser = process.env.SITE_USER || "karnaf";
  const header = req.headers.get("authorization");

  if (header?.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const idx = decoded.indexOf(":");
    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);
    if (user === expectedUser && pass === password) {
      return ensureAnonCookie(req, NextResponse.next());
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Karnaf", charset="UTF-8"' },
  });
}

// Apply to everything except Next internals, static assets, and the two
// machine endpoints.
//
// api/health is excluded because Docker's HEALTHCHECK and the CI post-deploy
// probe both call it: with SITE_PASSWORD set they would get 401, the container
// would be marked unhealthy, and Traefik would pull a perfectly healthy site
// out of rotation. api/status is excluded for the same reason — it is the
// dead-man switch an external monitor polls, and a monitor cannot log in.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/status).*)"],
};
