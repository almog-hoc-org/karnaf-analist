"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

/**
 * Microsoft Clarity — heatmaps and session recordings.
 *
 * ⚠️ NEVER LOADS ON /deals. That is the single most important line in this file.
 *
 * Clarity records the screen. /deals is the personal workspace where a broker
 * types real clients' addresses, asking prices, and private notes about
 * negotiations. Recording that would ship identifiable third-party personal
 * data — belonging to people who never visited the site and cannot consent — to
 * Microsoft's servers outside Israel.
 *
 * Clarity does offer input masking, and it is on by default. It is not relied
 * on here. Masking is a setting someone can change, and a setting is a promise;
 * not loading the script at all is a property. The research pages, which are
 * what this analytics is actually for, keep full coverage.
 *
 * Inert until NEXT_PUBLIC_CLARITY_ID is set, so nothing loads until the project
 * ID is deliberately configured — and no third-party script reaches visitors
 * before the privacy policy that discloses it is published.
 */

/** Route prefixes that must never be recorded. */
const EXCLUDED_PREFIXES = [
  "/deals",   // client data: addresses, prices, private notes
  "/admin",   // operator screens, and the dashboard controls the archive
  "/login",
  "/register",
];

export default function Analytics() {
  const pathname = usePathname();
  const id = process.env.NEXT_PUBLIC_CLARITY_ID;

  if (!id) return null;
  // usePathname() already has any base path stripped, so these compare cleanly
  // against the route names regardless of where the site is mounted.
  if (EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  return (
    <Script id="clarity" strategy="afterInteractive">
      {`(function(c,l,a,r,i,t,y){
          c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
          t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
          y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
        })(window, document, "clarity", "script", ${JSON.stringify(id)});`}
    </Script>
  );
}
