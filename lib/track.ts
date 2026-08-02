"use client";

import { withBasePath } from "./basePath";
import type { EventName } from "./events";

/**
 * Client-side event sender.
 *
 * Uses navigator.sendBeacon where available: it survives the page being closed
 * or navigated away from, which is exactly when the last and most interesting
 * event of a visit tends to fire. fetch(keepalive) is the fallback.
 *
 * Every failure path is swallowed. Analytics must never be able to break a page
 * or block an interaction — if the request is lost, the event is lost, and that
 * is the correct trade.
 */

const SESSION_KEY = "karnaf_sid";

/**
 * A random id for THIS TAB, held in sessionStorage.
 *
 * Deliberately not a cookie and not a device id: it disappears when the tab
 * closes, is not shared between tabs, and cannot be joined to anything else.
 * It exists only to tell "one person clicked five things" apart from "five
 * people clicked once", which is the difference between a usable funnel and a
 * meaningless one.
 */
function sessionId(): string | null {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? String(Math.random()).slice(2)).replace(/-/g, "").slice(0, 24);
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return null; // private mode, storage disabled — tracking still works, just ungrouped
  }
}

export interface TrackOptions {
  subject?: string | null;
  detail?: string | null;
}

export function track(name: EventName, opts: TrackOptions = {}): void {
  if (typeof window === "undefined") return;
  try {
    const payload = JSON.stringify({
      name,
      path: window.location.pathname,
      subject: opts.subject ?? null,
      detail: opts.detail ?? null,
      sessionId: sessionId(),
    });
    const url = withBasePath("/api/events");

    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
      return;
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never let instrumentation surface to the user */
  }
}

/**
 * Record a search and, when it found nothing, record that separately.
 *
 * Both search boxes call this. `search_no_results` is the reason this helper
 * exists as a helper: the site has two independent search inputs, and only one
 * of them had any notion of "no matches". Routing both through one function is
 * what stops the more-used box from being the untracked one.
 */
export function trackSearch(term: string, resultCount: number, where: string): void {
  const t = term.trim();
  if (!t) return;
  track("search", { subject: where, detail: t });
  if (resultCount === 0) track("search_no_results", { subject: where, detail: t });
}
