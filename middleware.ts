import { NextRequest, NextResponse } from "next/server";

// Simple HTTP Basic Auth gate.
// Enabled only when SITE_PASSWORD is set (so local dev stays open).
// Configure SITE_USER (optional, default "karnaf") and SITE_PASSWORD on Vercel.
export function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();

  const expectedUser = process.env.SITE_USER || "karnaf";
  const header = req.headers.get("authorization");

  if (header?.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const idx = decoded.indexOf(":");
    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);
    if (user === expectedUser && pass === password) {
      return NextResponse.next();
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
