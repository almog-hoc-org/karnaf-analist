/**
 * Share-link building — every outbound share carries the sharer's referral
 * code, so "send to a friend" and "earn referral credits" are the same action.
 */
import { headers } from "next/headers";
import { referralCodeFor } from "./credits";
import { withBasePath } from "./basePath";

/**
 * The canonical public origin. KARNAF_SITE_URL first; when it's unset, fall
 * back to the request's own Host header — a share link is worthless pointing
 * at localhost, and the OAuth routes already anticipate exactly this
 * misconfiguration by using the request origin.
 */
export function siteUrl(): string {
  const configured = process.env.KARNAF_SITE_URL?.replace(/\/$/, "");
  if (configured) return configured;
  try {
    const h = headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
  } catch { /* outside a request scope (scripts) — fall through */ }
  return "http://localhost:3000";
}

/** Absolute URL for an app path, with the sharer's ref code when signed in. */
export function shareUrlFor(path: string, userId?: string | null): string {
  const code = userId ? referralCodeFor(userId) : "";
  const sep = path.includes("?") ? "&" : "?";
  return `${siteUrl()}${withBasePath(path)}${code ? `${sep}ref=${code}` : ""}`;
}

/** wa.me link with a short Hebrew pitch + the (ref-tagged) URL. */
export function whatsappShareUrl(path: string, userId?: string | null, text?: string): string {
  const url = shareUrlFor(path, userId);
  const msg = `${text ?? "שווה הצצה — נתוני אמת על שוק הנדל״ן:"}\n${url}`;
  return `https://wa.me/?text=${encodeURIComponent(msg)}`;
}
