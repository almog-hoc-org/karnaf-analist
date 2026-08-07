/**
 * Google sign-in, step 1: send the visitor to Google's consent screen.
 *
 * Hand-rolled OAuth (no next-auth) on top of lib/auth.ts — ~60 lines beats a
 * framework dependency for exactly one provider. state is a random nonce kept
 * in an httpOnly cookie and echoed back by Google; the callback rejects any
 * response whose state does not match (CSRF: an attacker cannot splice their
 * own Google code into the victim's session). next/ref ride along inside the
 * same cookie rather than through Google, so they cannot be tampered with
 * en route.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { withBasePath } from "@/lib/basePath";
import { OAUTH_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

function siteUrl(req: Request): string {
  return (process.env.KARNAF_SITE_URL ?? new URL(req.url).origin).replace(/\/$/, "");
}

export async function GET(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "Google sign-in is not configured" }, { status: 503 });
  }
  const url = new URL(req.url);
  const nextRaw = url.searchParams.get("next") ?? "/deals";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/deals";
  const refRaw = (url.searchParams.get("ref") ?? "").toUpperCase();
  const ref = /^[A-Z2-9]{4,16}$/.test(refRaw) ? refRaw : "";

  const state = crypto.randomBytes(16).toString("hex");
  cookies().set(OAUTH_COOKIE, JSON.stringify({ state, next, ref }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    maxAge: 600, path: "/",
  });

  const redirectUri = `${siteUrl(req)}${withBasePath("/api/auth/google/callback")}`;
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "openid email profile");
  auth.searchParams.set("state", state);
  auth.searchParams.set("prompt", "select_account");
  return NextResponse.redirect(auth);
}
