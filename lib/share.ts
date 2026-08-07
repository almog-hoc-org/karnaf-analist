/**
 * Share-link building — every outbound share carries the sharer's referral
 * code, so "send to a friend" and "earn referral credits" are the same action.
 */
import { referralCodeFor } from "./credits";
import { withBasePath } from "./basePath";

/** The canonical public origin (same source of truth the logout redirect uses). */
export function siteUrl(): string {
  return (process.env.KARNAF_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
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
