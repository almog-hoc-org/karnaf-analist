import type { Metadata, Viewport } from "next";
import { Rubik } from "next/font/google";
import "./globals.css";
import RefreshDataButton from "@/components/RefreshDataButton";
import TopNav from "@/components/TopNav";
import { getCurrentUser } from "@/lib/auth";
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

  return (
    <html lang="he" dir="rtl">
      <body
        className={`${rubik.variable} font-heebo text-slate-900 antialiased min-h-screen relative`}
      >
        {/* Subtle grid texture overlay for depth */}
        <div
          className="fixed inset-0 pointer-events-none opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,23,42,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.7) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <TopNav cities={cityNames} user={getCurrentUser()} />
        <div className="relative">{children}</div>
        <SiteFooter />
        <RefreshDataButton />
      </body>
    </html>
  );
}
