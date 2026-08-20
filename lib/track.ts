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

/**
 * A random id for THIS BROWSER, in localStorage, expiring after 180 days.
 *
 * WHY IT EXISTS, STATED PLAINLY
 * The tab id above cannot answer "how many people" or "how many came back" —
 * the same person tomorrow is a new tab and a new id, so 376 visits might be
 * 376 people or forty. Without something that survives the tab, every returning
 * visitor is invisible and every unique-visitor number is a guess. The operator
 * asked for both (8/2026), and this is the minimum that answers them.
 *
 * WHAT IT IS AND IS NOT: a random number. Not derived from the browser, the
 * screen, the fonts or anything else — so it is not a fingerprint and cannot be
 * reconstructed if cleared. Not a cookie, so it is never sent to any other
 * host. Not linked to an identity; for a signed-in account the account id is
 * recorded separately and server-side. It expires after 180 days rather than
 * living forever: a "returning visitor" measured over years is not a number
 * anyone acts on, and an identifier with no horizon is harder to justify than
 * one with a stated end.
 */
const VISITOR_KEY = "karnaf_vid";
const VISITOR_TTL_DAYS = 180;

function visitorId(): string | null {
  try {
    const raw = localStorage.getItem(VISITOR_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { id?: string; at?: number };
      const ageDays = parsed.at ? (Date.now() - parsed.at) / 86_400_000 : Infinity;
      if (parsed.id && ageDays < VISITOR_TTL_DAYS) return parsed.id;
    }
    const id = (crypto.randomUUID?.() ?? String(Math.random()).slice(2)).replace(/-/g, "").slice(0, 24);
    localStorage.setItem(VISITOR_KEY, JSON.stringify({ id, at: Date.now() }));
    return id;
  } catch {
    return null; // storage blocked — the visit is counted, just not attributed
  }
}

/**
 * Paths that produce NO events at all.
 *
 * ⚠️ A PUBLISHED COMMITMENT, NOT A PREFERENCE. app/privacy/page.tsx states
 * that the personal workspace "אינה נכללת בהקלטות מסך או בלוג האירועים" — not
 * in recordings AND not in the event log. The path alone carries no client
 * data, but the promise was made about the log as a whole.
 *
 * It lives here rather than in components/PageViewTracker because it is no
 * longer one caller's business: the Web Vitals reporter fires from the root
 * layout on every route, so a copy of this list in only the page tracker would
 * have quietly written /deals rows through the other door. One rule, one
 * place, every emitter.
 *
 * components/Analytics.tsx keeps its own copy for the Clarity script, because
 * that decision is made server-side before any of this code loads. The two
 * must stay in step.
 */
const UNTRACKED_PREFIXES = ["/deals", "/admin", "/login", "/register"];

export function isTrackedPath(path: string | null | undefined): boolean {
  if (!path) return false;
  return !UNTRACKED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
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
    // Enforced HERE, at the single exit, rather than trusted to each caller.
    // Every event of every kind passes through this function, so this is the
    // only place the promise can be kept without depending on the next
    // instrumentation being written carefully.
    const path = opts.path ?? window.location.pathname;
    if (!isTrackedPath(path)) return;
    const payload = JSON.stringify({
      name,
      path,
      subject: opts.subject ?? null,
      detail: opts.detail ?? null,
      sessionId: sessionId(),
      visitorId: visitorId(),
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
 * How far down the page the visitor actually got, and how much of it they
 * could see before scrolling at all.
 *
 * WHY AN EXACT PERCENTAGE AND NOT THE OLD 25/50/75/100 THRESHOLDS
 * The 25/50/75/100 survival curve is derivable from an exact maximum — count
 * the views whose max cleared each mark — and the exact maximum additionally
 * gives a median and an average. The reverse is not true: from four buckets
 * you cannot recover "the typical reader stops at 34%". So one event on leave
 * replaces four during the visit, and carries strictly more information.
 *
 * `fold_view` is the other half of the same question. "The median reader
 * reaches 34%" means something very different on a page where the first screen
 * already shows 30% than on one where it shows 6% — the first is a reader who
 * barely scrolled, the second is a reader who worked for it. Both numbers are
 * needed to tell those apart, which is why the fraction visible at rest is
 * recorded once per view alongside the screen-width bucket.
 */
export function trackPageDepth(path: string): () => void {
  if (typeof window === "undefined") return () => {};
  let maxPct = 0;
  let sent = false;

  const measure = () => {
    try {
      const doc = document.documentElement;
      const height = doc.scrollHeight;
      if (height <= 0) return;
      // The BOTTOM of the viewport is what was seen, not its top: on a page
      // barely taller than the screen, scrollY stays near 0 while the reader
      // has in fact seen almost all of it.
      const seen = ((window.scrollY || 0) + window.innerHeight) / height;
      maxPct = Math.max(maxPct, Math.min(100, Math.round(seen * 100)));
    } catch { /* ignore */ }
  };

  const flush = () => {
    if (sent || maxPct <= 0) return;
    sent = true;
    track("page_depth", { path, detail: String(maxPct) });
  };

  // The first measurement IS the fold: how much of the page is visible with no
  // scrolling at all. Deferred one frame so the layout has settled.
  const foldTimer = window.setTimeout(() => {
    try {
      const height = document.documentElement.scrollHeight;
      if (height <= 0) return;
      const fold = Math.min(100, Math.round((window.innerHeight / height) * 100));
      track("fold_view", { path, subject: deviceBucket(), detail: String(fold) });
    } catch { /* ignore */ }
    measure();
  }, 400);

  window.addEventListener("scroll", measure, { passive: true });
  window.addEventListener("resize", measure, { passive: true });
  window.addEventListener("pagehide", flush);

  return () => {
    window.clearTimeout(foldTimer);
    measure();
    flush();
    window.removeEventListener("scroll", measure);
    window.removeEventListener("resize", measure);
    window.removeEventListener("pagehide", flush);
  };
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

/**
 * Which parts of a long page people actually stopped on.
 *
 * WHY VISIBLE TIME AND NOT "DID IT ENTER THE VIEWPORT"
 * On a city page every section enters the viewport of anyone who scrolls to
 * the bottom, so "was seen" is nearly the same as "the page is long". Time
 * spent with the section actually on screen separates scrolling past from
 * reading — which is the difference between "they reached the dwelling-stock
 * card" and "the dwelling-stock card is what they came for".
 *
 * The same visibility rule as trackPageTime: only while the TAB is visible.
 * A section left on screen behind another window is not being read.
 *
 * Sections are found by the `data-track-section` attribute, so adding one to
 * a page is a one-attribute change and nothing here needs to know the layout.
 */
export function trackSections(subject: string): () => void {
  if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return () => {};

  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-track-section]"));
  if (!els.length) return () => {};

  // name → { since: when it became visible (0 = not visible), total: ms }
  const state = new Map<string, { since: number; total: number }>();
  const nameOf = (el: HTMLElement) => el.dataset.trackSection || "";

  const settle = (name: string, now: number) => {
    const s = state.get(name);
    if (s && s.since) { s.total += now - s.since; s.since = 0; }
  };

  const observer = new IntersectionObserver(
    (entries) => {
      const now = Date.now();
      for (const e of entries) {
        const name = nameOf(e.target as HTMLElement);
        if (!name) continue;
        const s = state.get(name) ?? { since: 0, total: 0 };
        state.set(name, s);
        if (e.isIntersecting && document.visibilityState === "visible") {
          if (!s.since) s.since = now;
        } else {
          settle(name, now);
        }
      }
    },
    // Half the section on screen, or a tall section filling the viewport —
    // a section taller than the window can never reach 50% of itself, which
    // is why the second threshold exists.
    { threshold: [0.5], rootMargin: "0px" }
  );
  for (const el of els) observer.observe(el);

  const onVisibility = () => {
    const now = Date.now();
    if (document.visibilityState === "visible") return; // re-entry handled by the observer
    for (const name of state.keys()) settle(name, now);
  };
  document.addEventListener("visibilitychange", onVisibility);

  let sent = false;
  const flush = () => {
    if (sent) return;
    sent = true;
    const now = Date.now();
    for (const [name] of state) settle(name, now);
    for (const [name, s] of state) {
      // Under a second is passing through, not looking at.
      if (s.total >= 1000) track("section_view", { subject: name, detail: subject, dwellMs: s.total });
    }
  };
  window.addEventListener("pagehide", flush);

  return () => {
    flush();
    observer.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", flush);
  };
}

/**
 * One real-user speed measurement.
 *
 * Called from components/WebVitalsReporter with Next's own hook, so no library
 * is added. The value is rounded before it is sent: a millisecond of precision
 * on a page-load metric is noise, and the dashboard reports p75 anyway.
 */
export function trackWebVital(name: string, value: number): void {
  // CLS is a ratio around 0–1 and would round to zero; it is sent scaled by
  // 1000 and divided back in the panel, which is also how Google reports it.
  const scaled = name === "CLS" ? Math.round(value * 1000) : Math.round(value);
  track("web_vital", { subject: name, detail: String(scaled) });
}
