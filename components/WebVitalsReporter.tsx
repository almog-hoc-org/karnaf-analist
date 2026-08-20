"use client";

import { useReportWebVitals } from "next/web-vitals";
import { trackWebVital } from "@/lib/track";

/**
 * Real-user speed, from the browsers that actually load the site.
 *
 * WHY THIS AND NOT A LAB SCORE
 * A Lighthouse run on a developer machine measures a fast laptop on a fast
 * connection. The visitors this site loses are on phones on cellular data,
 * loading a page whose data comes from a 300MB SQLite file — and a page that
 * takes six seconds there is abandoned before anything in the usage dashboard
 * would explain why. Field data is the only kind that answers "is the site
 * slow for the people leaving it".
 *
 * Next ships the collection (`useReportWebVitals`, since 13.5), so this adds
 * no dependency and no third-party script. The three metrics that matter:
 * LCP (when the main content appeared), INP (how fast it answered a tap), CLS
 * (how much the layout jumped while loading). Everything else Next reports is
 * forwarded too — the dashboard filters, so a future metric name needs no
 * change here.
 *
 * Mounted in the root layout. It emits through the same track() as every other
 * event, which means it inherits the same exclusions: /deals, /admin, /login
 * and /register produce rows here as they do nowhere else — so those are
 * filtered at the query, and the panel says so.
 */
export default function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    trackWebVital(metric.name, metric.value);
  });
  return null;
}
