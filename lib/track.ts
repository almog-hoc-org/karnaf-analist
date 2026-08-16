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
  /** milliseconds the page was open — only meaningful on page_leave */
  dwellMs?: number | null;
}

/**
 * Which kind of screen this is — mobile / tablet / desktop.
 *
 * Derived from viewport width and pointer type, NOT from the user-agent. The
 * operator's question is "does this need to work on a phone", and a bucket
 * answers it; a UA string would answer it too while also handing the event log
 * a fingerprint it has no use for. The breakpoints match the ones the layout
 * itself uses, so the answer describes the layout people actually saw.
 */
function deviceBucket(): "mobile" | "tablet" | "desktop" {
  try {
    const w = window.innerWidth || 1024;
    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
    if (w < 640) return "mobile";
    if (w < 1024) return coarse ? "tablet" : "desktop";
    return "desktop";
  } catch {
    return "desktop";
  }
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
      device: deviceBucket(),
      dwellMs: opts.dwellMs ?? null,
      // NOTE: no account id here on purpose. The API route reads it from the
      // session cookie instead — a client-supplied user id would let anyone
      // write events attributed to anyone.
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


/**
 * Start measuring time on the current page, and report it when the visitor
 * leaves. Returns a cleanup function for the caller's effect.
 *
 * WHY IT IS NOT A TIMER
 * The obvious implementation polls every few seconds and adds up. This one
 * measures only the spans in which the tab was actually VISIBLE, because a tab
 * left open behind another one is not a person reading — and on a phone,
 * switching apps and coming back an hour later is the normal case, not the
 * edge case. Backgrounded time is excluded rather than clamped away later.
 *
 * `pagehide` rather than `unload`: unload is unreliable on mobile Safari and
 * blocks the back/forward cache. Both handlers flush through sendBeacon, which
 * is the one request kind that survives a page being closed.
 */
export function trackPageTime(path?: string): () => void {
  if (typeof window === "undefined") return () => {};
  let visibleSince = document.visibilityState === "visible" ? Date.now() : 0;
  let accumulated = 0;
  let sent = false;

  const settle = () => {
    if (visibleSince) {
      accumulated += Date.now() - visibleSince;
      visibleSince = 0;
    }
  };

  const flush = () => {
    settle();
    // A sub-second view is a redirect or a mis-click, not a read. Recording it
    // would drag every average down while telling nobody anything.
    if (sent || accumulated < 1000) return;
    sent = true;
    track("page_leave", { subject: path ?? null, dwellMs: accumulated });
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      visibleSince = Date.now();
    } else {
      // Flush on hide too: on mobile, "hidden" is very often the last event a
      // page gets, and waiting for pagehide loses the whole visit.
      flush();
    }
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", flush);

  return () => {
    flush();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", flush);
  };
}
