import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";
import RefreshDataButton from "@/components/RefreshDataButton";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-heebo",
  display: "swap",
});

export const metadata: Metadata = {
  title: 'מחקר נדל"ן ישראל | לוח מידע',
  description: 'לוח מידע לניתוח שוק הנדל"ן בישראל — מחירים, היצע, ביקוש ונתוני בנייה',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl">
      <body
        className={`${heebo.variable} font-heebo text-slate-900 antialiased min-h-screen relative`}
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
        <div className="relative">{children}</div>
        <RefreshDataButton />
      </body>
    </html>
  );
}
