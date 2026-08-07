/**
 * Google sign-in, step 2: Google redirects back here with a one-time code.
 *
 * The code is exchanged server-to-server (client_secret never leaves the box)
 * for an id_token. The token's payload is trusted WITHOUT signature
 * verification deliberately: it arrives on a direct TLS response from
 * oauth2.googleapis.com in exchange for our client_secret — verifying
 * Google's signature on a token Google just handed us over TLS adds a JWKS
 * fetch and no security. (If this token ever came from anywhere else — a
 * header, a form — it MUST be verified.)
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { findOrCreateGoogleUser, createSession, OAUTH_COOKIE } from "@/lib/auth";
import { grantSignupBonus, applyReferral } from "@/lib/credits";
import { withBasePath } from "@/lib/basePath";

export const dynamic = "force-dynamic";

function siteUrl(req: Request): string {
  return (process.env.KARNAF_SITE_URL ?? new URL(req.url).origin).replace(/\/$/, "");
}

function fail(req: Request, msg: string): NextResponse {
  return NextResponse.redirect(
    new URL(`${withBasePath("/login")}?err=${encodeURIComponent(msg)}`, siteUrl(req))
  );
}

export async function GET(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail(req, "כניסת גוגל אינה מוגדרת");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";

  const jar = cookies();
  let saved: { state?: string; next?: string; ref?: string } = {};
  try { saved = JSON.parse(jar.get(OAUTH_COOKIE)?.value ?? "{}"); } catch { /* treated as missing */ }
  jar.delete(OAUTH_COOKIE);

  if (!code || !state || state !== saved.state) return fail(req, "אימות גוגל נכשל — נסה שוב");

  const redirectUri = `${siteUrl(req)}${withBasePath("/api/auth/google/callback")}`;
  let idToken: string | undefined;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return fail(req, "אימות גוגל נכשל — נסה שוב");
    idToken = (await res.json())?.id_token;
  } catch {
    return fail(req, "לא הצלחנו לדבר עם גוגל — נסה שוב");
  }
  if (!idToken) return fail(req, "אימות גוגל נכשל — נסה שוב");

  let claims: { sub?: string; email?: string; email_verified?: boolean; name?: string };
  try {
    claims = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return fail(req, "אימות גוגל נכשל — נסה שוב");
  }
  if (!claims.sub || !claims.email || claims.email_verified === false) {
    return fail(req, "חשבון הגוגל חסר אימייל מאומת");
  }

  const result = findOrCreateGoogleUser(claims.email, claims.name ?? "", claims.sub);
  if (!result) return fail(req, "אימות גוגל נכשל — נסה שוב");

  if (result.created) {
    grantSignupBonus(result.user.id);
    // Google-verified account — exactly the "verified friend" the referral
    // bonus was scoped to. Caps enforced inside.
    if (saved.ref) applyReferral(saved.ref, result.user.id);
  }
  createSession(result.user);

  const next = saved.next && saved.next.startsWith("/") && !saved.next.startsWith("//") ? saved.next : "/deals";
  return NextResponse.redirect(new URL(withBasePath(next), siteUrl(req)));
}
