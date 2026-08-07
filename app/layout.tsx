import type { Metadata, Viewport } from "next";
import { Rubik } from "next/font/google";
import "./globals.css";
import RefreshDataButton from "@/components/RefreshDataButton";
import FeedbackWidget from "@/components/FeedbackWidget";
import Analytics from "@/components/Analytics";
import PageViewTracker from "@/components/PageViewTracker";
import AccessibilityWidget from "@/components/AccessibilityWidget";
import TopNav from "@/components/TopNav";
import { getCurrentUser } from "@/lib/auth";
import { balance } from "@/lib/credits";
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
  title: 'קרנף אנליסט | מחקר שוק הדיור בישראל',
  description: 'פורטל מחקר לשוק הנדל"ן בישראל — מחירים, עסקאות, היצע, ביקוש ונתוני בנייה',
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
        {/* Subtle grid texture overlay for depth */}
        <div
          className="fixed inset-0 pointer-events-none opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,23,42,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.7) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <TopNav cities={cityNames} user={currentUser} credits={currentUser ? balance(currentUser.id) : null} />
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
        {/* end-side, clear of the feedback button at start-side */}
        <AccessibilityWidget />
      </body>
    </html>
  );
}
