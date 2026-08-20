import type { Metadata, Viewport } from "next";
import { SITE_ORIGIN } from "@/lib/siteOrigin";
import { Rubik } from "next/font/google";
import "./globals.css";
import RefreshDataButton from "@/components/RefreshDataButton";
import FeedbackWidget from "@/components/FeedbackWidget";
import Analytics from "@/components/Analytics";
import PageViewTracker from "@/components/PageViewTracker";
import WebVitalsReporter from "@/components/WebVitalsReporter";
import AccessibilityWidget from "@/components/AccessibilityWidget";
import TopNav from "@/components/TopNav";
import { getCurrentUser } from "@/lib/auth";
import { balance, isUnlimited } from "@/lib/credits";
import { isAdminRequest } from "@/lib/adminAuth";
import SiteFooter from "@/components/SiteFooter";
import { prisma } from "@/lib/db";

// Rubik — the same family yad2 uses: excellent Hebrew, tight numerals.
const rubik = Rubik({
  subsets: ["hebrew", "latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-heebo",
  display: "swap",
});

export const metadata: Metadata = {
  // metadataBase is what makes every relative OG image, canonical and alternate
  // resolve to a real URL. Without it Next emits relative values that crawlers
  // and WhatsApp resolve against the wrong origin — which is why the city page
  // had to hand-roll its own absolute URLs.
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: 'קרנף אנליסט | מחקר שוק הדיור בישראל',
    // Every page's own title flows through this, so the brand is never lost
    // and no page has to repeat it.
    template: '%s | קרנף אנליסט',
  },
  description: 'פורטל מחקר לשוק הנדל"ן בישראל — מחירי דירות לפי עיר, עסקאות אמת מרשות המסים, היצע וביקוש, היתרי בנייה ונתוני אוכלוסייה.',
  applicationName: 'קרנף אנליסט',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'he_IL',
    siteName: 'קרנף אנליסט',
    title: 'קרנף אנליסט | מחקר שוק הדיור בישראל',
    description: 'מחירי דירות לפי עיר, עסקאות אמת מרשות המסים, והיצע מול ביקוש — עם מקור לכל מספר.',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'קרנף אנליסט | מחקר שוק הדיור בישראל',
    description: 'מחירי דירות לפי עיר, עסקאות אמת מרשות המסים, והיצע מול ביקוש.',
  },
  robots: { index: true, follow: true },
};

/**
 * Organization + WebSite structured data.
 *
 * A statistics site is the textbook case for this: it tells Google what the
 * entity is, and the SearchAction wires the site's own search into the result
 * card. There was no JSON-LD anywhere before this.
 */
const ORG_JSONLD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_ORIGIN}/#organization`,
      name: "קרנף אנליסט",
      url: SITE_ORIGIN,
      description: 'פורטל מחקר לשוק הנדל"ן בישראל',
      areaServed: { "@type": "Country", name: "Israel" },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_ORIGIN}/#website`,
      url: SITE_ORIGIN,
      name: "קרנף אנליסט",
      inLanguage: "he-IL",
      publisher: { "@id": `${SITE_ORIGIN}/#organization` },
    },
  ],
};

// Explicit (was relying on Next's default). Deliberately NO maximumScale —
// pinch-zoom stays available; iOS focus-zoom is prevented by 16px mobile inputs.
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // city list for the global search (server-side, cached per request)
  let cityNames: string[] = [];
  try {
    const rows = await prisma.city.findMany({
      select: { city_name: true },
      orderBy: { population_2026: "desc" },
    });
    cityNames = rows.map((r) => r.city_name);
  } catch {
    cityNames = [];
  }

  const isAdmin = isAdminRequest();
  const currentUser = getCurrentUser();

  return (
    <html lang="he" dir="rtl">
      <body
        className={`${rubik.variable} font-heebo text-slate-900 antialiased min-h-screen relative`}
      >
        {/* Skip link — the first focusable element on the page, so a keyboard
            user can jump past the nav instead of tabbing through it on every
            page. WCAG 2.4.1. */}
        <a href="#main-content" className="skip-link">דלג לתוכן הראשי</a>
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSONLD) }}
        />
        {/* Subtle grid texture overlay for depth */}
        <div
          className="fixed inset-0 pointer-events-none opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,23,42,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.7) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <TopNav cities={cityNames} user={currentUser} credits={currentUser ? balance(currentUser.id) : null} unlimited={currentUser ? isUnlimited(currentUser.id) : false} />
        {/* The landmark the skip link targets. tabIndex={-1} lets it receive
            focus programmatically without entering the tab order itself. */}
        <div id="main-content" tabIndex={-1} className="relative">{children}</div>
        <SiteFooter />
        {/* Operator tool, not a visitor feature — the API behind it is admin-gated,
            so showing the button to everyone would only offer a 401. */}
        {isAdmin && <RefreshDataButton />}
        {/* bottom-start; RefreshDataButton holds bottom-end, and for an admin both show */}
        <FeedbackWidget />
        {/* Inert until NEXT_PUBLIC_CLARITY_ID is set, and never loads on /deals
            or /admin — see the note in the component. */}
        <Analytics />
        {/* First-party page_view. Renders nothing; excludes the same routes as
            Analytics, because the privacy notice promises /deals appears in
            neither the recordings nor the event log. */}
        <PageViewTracker />
        <WebVitalsReporter />
        {/* end-side, clear of the feedback button at start-side */}
        <AccessibilityWidget />
      </body>
    </html>
  );
}
