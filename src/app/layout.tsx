import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-heebo",
  display: "swap",
});

export const metadata: Metadata = {
  title: 'מחקר נדל"ן ישראל | לוח מידע',
  description: 'לוח מידע לניתוח שוק הנדל"ן בישראל',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl" className="dark">
      <body
        className={`${heebo.variable} font-heebo bg-[#0a0a0a] text-white antialiased min-h-screen`}
      >
        {children}
      </body>
    </html>
  );
}
