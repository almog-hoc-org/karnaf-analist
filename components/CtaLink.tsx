"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { trackCta, type CtaName } from "@/lib/track";

/**
 * An internal link that records the click as a `cta_click`.
 *
 * WHY A COMPONENT AND NOT A GLOBAL CLICK LISTENER
 * A listener on every anchor would produce a table of hundreds of rows nobody
 * reads, and a privacy posture that cannot be stated in one sentence. The
 * closed list in lib/track.ts (CtaName) is the whole surface — adding a button
 * to it is a deliberate act, and anything not on it is not recorded.
 *
 * The pages this is used on are the ones the funnel needs a denominator for.
 * `/register` itself emits nothing at all (components/PageViewTracker excludes
 * it, and the privacy notice promises that), so the click on the way in is the
 * only place the intent is visible. The outcome still comes from
 * `users.created_at` — a click can be blocked or lost, a row cannot.
 */
export default function CtaLink({
  href, cta, context, className, children, prefetch,
}: {
  href: string;
  cta: CtaName;
  /** where the button was — the city name, the page, the placement */
  context?: string | null;
  className?: string;
  children: ReactNode;
  prefetch?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={className}
      onClick={() => trackCta(cta, context)}
    >
      {children}
    </Link>
  );
}
