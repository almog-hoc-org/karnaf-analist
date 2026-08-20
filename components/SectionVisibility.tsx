"use client";

import { useEffect } from "react";
import { trackSections } from "@/lib/track";

/**
 * Measures which marked sections of the page were actually looked at.
 *
 * Mounted once per page that wants it. Everything it needs is on the page
 * already: any element carrying `data-track-section="<slug>"` is observed, so
 * marking a new section is a one-attribute change and this file never has to
 * learn the layout.
 *
 * `subject` is what the sections belong to — the city name on a city page —
 * so the dashboard can answer both "which parts of a city page get read" and
 * "which parts get read in Haifa specifically".
 *
 * The effect re-runs when `subject` changes, which is what makes it correct
 * across client-side navigation between two city pages: the previous page's
 * measurements flush in the cleanup, and the new page starts from zero rather
 * than inheriting the last one's totals.
 */
export default function SectionVisibility({ subject }: { subject: string }) {
  useEffect(() => trackSections(subject), [subject]);
  return null;
}
