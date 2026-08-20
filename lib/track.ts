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
  /**
   * Override the path the event is attributed to.
   *
   * WHY THIS IS NOT OPTIONAL SUGAR
   * `page_leave` fires from an effect cleanup during a client-side navigation,
   * and by then the App Router has ALREADY replaced window.location.pathname
   * with the destination. Every dwell measurement was therefore filed against
   * the page the visitor went TO, not the one they had been reading — so the
   * time-on-page column described the wrong page, silently and consistently.
   * Nothing about that is visible in the output; it just looks like people
   * spend a long time on whatever they navigate to. The page being left is now
   * captured at mount and passed in explicitly.
   */
  path?: string | null;
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
      path: opts.path ?? window.location.pathname,
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
export function trackPageTime(path: string, subject?: string | null): () => void {
  if (typeof window === "undefined") return () => {};
  let visibleSince = document.visibilityState === "visible" ? Date.now() : 0;
  let accumulated = 0;
  let reported = 0;

  const settle = () => {
    if (visibleSince) {
      accumulated += Date.now() - visibleSince;
      visibleSince = 0;
    }
  };

  /**
   * Sends only the time not sent yet.
   *
   * The first version latched after one flush, so a visit that went hidden and
   * came back reported the first span and threw the rest away — which on a
   * phone, where switching apps mid-read is the normal case rather than the
   * edge case, meant systematically under-reporting exactly the longest reads.
   * Reporting the DELTA keeps the sum right however many times the visitor
   * comes and goes.
   */
  const flush = () => {
    settle();
    const delta = accumulated - reported;
    // A sub-second span is a redirect or a mis-click, not a read. Recording it
    // would drag every average down while telling nobody anything.
    if (delta < 1000) return;
    reported = accumulated;
    track("page_leave", { path, subject: subject ?? null, dwellMs: delta });
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


/* ── the rest of the instrumentation the usage dashboard needs ──────────────
 *
 * WHAT IS DELIBERATELY NOT MEASURED, and why it is written here rather than
 * assumed: every click that is not on the closed list below, the contents of
 * any form field, the IP address, the user-agent, and the full referring URL.
 * A referrer is reduced to its DOMAIN before it leaves the browser, because a
 * full search-engine referrer can carry the query the visitor typed, and this
 * log has no business holding that.
 */

/** The one visit-level event: where the visit came from, and where it landed. */
export function trackSessionStart(): void {
  try {
    const KEY = "karnaf_session_started";
    if (sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY, "1");
    let source = "direct";
    const ref = document.referrer;
    if (ref) {
      const host = new URL(ref).hostname.replace(/^www\./, "");
      // Internal navigation is not a traffic source; it is the same visit.
      source = host === window.location.hostname.replace(/^www\./, "") ? "internal" : host;
    }
    if (source === "internal") return;
    track("session_start", { subject: source, detail: window.location.pathname });
  } catch { /* storage blocked — the visit is simply unattributed */ }
}

/**
 * The closed list of buttons worth counting.
 *
 * A closed list rather than a global click handler: "every click" produces a
 * table nobody reads and a privacy posture nobody can describe in a sentence.
 * These are the actions that mean something happened.
 */
export type CtaName =
  | "register" | "login" | "check_price" | "calculator"
  | "course_banner" | "open_deals" | "all_rankings";
/*
 * Sharing, following a city, unlocking, comparing and chart interaction are
 * DELIBERATELY absent: each already has its own event (share_click,
 * follow_city_click, unlock_done, compare_select, chart_action). A second name
 * for the same moment would split one signal across two columns and leave both
 * understating it.
 */

export function trackCta(name: CtaName, context?: string | null): void {
  track("cta_click", { subject: name, detail: context ?? null });
}

/**
 * Depth thresholds, once each per view.
 *
 * A page whose readers stop at 25% is not a page people dislike — it is often
 * a page whose useful part is below the fold. That is a layout finding, and it
 * cannot be recovered from view counts.
 */
export function trackScrollDepth(path: string): () => void {
  if (typeof window === "undefined") return () => {};
  const hit = new Set<number>();
  const onScroll = () => {
    try {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      if (scrollable < 200) return; // a page that does not scroll has no depth to report
      const pct = ((window.scrollY || 0) / scrollable) * 100;
      for (const mark of [25, 50, 75, 100]) {
        if (pct >= mark - 1 && !hit.has(mark)) {
          hit.add(mark);
          track("scroll_depth", { path, detail: String(mark) });
        }
      }
    } catch { /* ignore */ }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  return () => window.removeEventListener("scroll", onScroll);
}

/**
 * Three or more clicks on the same element within 1.5s, with no navigation.
 *
 * This is the "looks clickable and isn't" detector. It is the one signal here
 * that finds a broken affordance the operator would otherwise only hear about
 * if a visitor bothered to write in — which almost none do.
 */
export function watchRageClicks(): () => void {
  if (typeof window === "undefined") return () => {};
  let last: EventTarget | null = null;
  let count = 0;
  let firstAt = 0;
  let reportedFor: EventTarget | null = null;

  const label = (el: Element): string => {
    const t = el.closest("a,button,[role=button]") ?? el;
    const text = (t.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    return text || t.tagName.toLowerCase();
  };

  const onClick = (ev: MouseEvent) => {
    try {
      const target = ev.target as Element | null;
      if (!target) return;
      const now = Date.now();
      if (target !== last || now - firstAt > 1500) {
        last = target; count = 1; firstAt = now; reportedFor = null;
        return;
      }
      count++;
      if (count >= 3 && reportedFor !== target) {
        reportedFor = target;
        track("rage_click", { subject: label(target), detail: String(count) });
      }
    } catch { /* ignore */ }
  };

  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}

/** A search that ended in the visitor actually choosing something. */
export function trackSearchSelect(city: string, term: string): void {
  track("search_select", { subject: city, detail: term.trim().slice(0, 60) || null });
}
