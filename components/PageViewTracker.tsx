"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { track, trackPageTime, trackPageDepth, trackSessionStart, watchRageClicks, isTrackedPath } from "@/lib/track";

/**
 * Emits `page_view` on every navigation.
 *
 * WHY THIS EXISTS AS ITS OWN COMPONENT
 * `page_view` was defined in EVENT_NAMES and sent from nowhere. That is worse
 * than not defining it: every other event is a ratio whose denominator is page
 * views, so without it "40 searches" cannot be read as a lot or a little. The
 * event log shipped with the launch precisely because behavioural data cannot be
 * backfilled — and its baseline was the one signal missing.
 *
 * ⚠️ The exclusion list moved to lib/track.ts (isTrackedPath) and is enforced
 * inside track() itself, so every emitter inherits it — including the Web
 * Vitals reporter, which fires from the root layout on routes this component
 * never sees.
 *
 * App Router note: this fires on pathname changes only. Query-string changes do
 * not produce a new view, which is correct — the site uses no query params to
 * select content on tracked pages.
 */

/**
 * The thing the page is about, for grouping. Only ever a value already visible
 * in the URL — a city name, a ranking type — never anything derived about the
 * visitor.
 */
function subjectFor(path: string): string | null {
  const seg = path.split("/").filter(Boolean);
  if (seg.length < 2) return null;
  if (["city", "rankings", "sources", "stats", "reports"].includes(seg[0])) {
    try {
      return decodeURIComponent(seg[1]);
    } catch {
      return seg[1]; // malformed escape in the URL — keep the raw form rather than throwing
    }
  }
  return null;
}

export default function PageViewTracker() {
  const pathname = usePathname();
  // React StrictMode runs effects twice in development, and a remount on the
  // same route would double-count. One ref makes the emit idempotent per path.
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    if (!isTrackedPath(pathname)) return;
    if (lastSent.current === pathname) return;
    lastSent.current = pathname;
    track("page_view", { subject: subjectFor(pathname) });
  }, [pathname]);

  // Time on page, as its own effect keyed on the path: a client-side
  // navigation unmounts nothing, so the cleanup here IS the "left the page"
  // moment for every route change after the first.
  //
  // The path is passed EXPLICITLY. By the time this cleanup runs the router has
  // already swapped window.location, so a sender that read the location would
  // file the dwell against the page the visitor went to rather than the one
  // they read. Scroll depth and the fold measurement ride the same effect
  // for the same reason.
  useEffect(() => {
    if (!pathname) return;
    if (!isTrackedPath(pathname)) return;
    const stopTime = trackPageTime(pathname, subjectFor(pathname));
    const stopDepth = trackPageDepth(pathname);
    return () => { stopDepth(); stopTime(); };
  }, [pathname]);

  // Visit-level, once per tab: where the visit came from, and the rage-click
  // watcher. Both are mounted here rather than in the layout so that the whole
  // instrumentation surface stays in one file — including the exclusion list,
  // which is a published promise and must not be enforced in two places that
  // can drift.
  useEffect(() => {
    if (!pathname) return;
    if (!isTrackedPath(pathname)) return;
    trackSessionStart();
  }, [pathname]);

  useEffect(() => watchRageClicks(), []);

  return null;
}
