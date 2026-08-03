import Link from "next/link";

/**
 * Accessibility statement.
 *
 * ⚠️ DRAFT. Israeli standard IS 5568 (WCAG 2.0 AA) applies to commercial
 * websites, and the statement must name a real accessibility coordinator with
 * real contact details — a placeholder is worse than nothing, because it is a
 * published commitment nobody can act on.
 *
 * Claims here are limited to what the code actually does. No conformance level
 * is asserted, because none has been audited.
 */
export const metadata = { title: "הצהרת נגישות | קרנף אנליסט" };

const UPDATED = "3 באוגוסט 2026";

export default function AccessibilityPage() {
  return (
    <main className="min-h-screen page-wrap py-10">
      <div className="mx-auto max-w-3xl px-4">
        <div className="mb-6 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-bold text-amber-900">⚠️ טיוטה — טרם בוצעה בדיקת נגישות מקצועית</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            תקן ישראלי 5568 מחייב אתרים מסחריים. נדרשת בדיקה על ידי מורשה נגישות, ומינוי
            רכז/ת נגישות עם פרטי קשר אמיתיים.
          </p>
        </div>

        <h1 className="mb-2 text-3xl font-black tracking-tight">
          <span className="text-gradient-hero">הצהרת נגישות</span>
        </h1>
        <p className="mb-8 text-xs text-slate-500">עודכן: {UPDATED}</p>

        <section className="mb-8 space-y-3 text-sm leading-relaxed text-slate-700">
          <h2 className="mb-3 text-lg font-black text-slate-900">מה כבר נעשה</h2>
          <ul className="list-inside list-disc space-y-1.5">
            <li>מבנה סמנטי — כותרות היררכיות ואזורי ניווט מסומנים.</li>
            <li>תוויות <code className="font-mono text-xs">aria</code> על כפתורים ושדות.</li>
            <li>ניווט מלא במקלדת בתפריטים, בחיפוש ובטופס המשוב.</li>
            <li>סימון מצב פוקוס גלוי.</li>
            <li>עיצוב מותאם למובייל, וגודל טקסט שאינו גורם לזום אוטומטי.</li>
            <li>תמיכה מלאה ב-RTL.</li>
          </ul>
        </section>

        <section className="mb-8 space-y-3 text-sm leading-relaxed text-slate-700">
          <h2 className="mb-3 text-lg font-black text-slate-900">מה עדיין לא נבדק</h2>
          <p>
            לא בוצעה בדיקה מקצועית, ולכן איננו מצהירים על רמת תאימות. אזורים שידועים כדורשים
            בחינה:
          </p>
          <ul className="list-inside list-disc space-y-1.5">
            <li>גרפים אינטראקטיביים — נדרש חלופה טקסטואלית לקוראי מסך.</li>
            <li>טבלאות רחבות בגלילה אופקית.</li>
            <li>יחסי ניגודיות בכל מצבי הצבע.</li>
          </ul>
        </section>

        <section className="mb-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <h2 className="mb-2 font-black text-slate-900">נתקלתם בבעיה?</h2>
          <p className="leading-relaxed text-slate-700">
            אפשר לדווח דרך כפתור המשוב 💬 בפינת המסך. אנו מתייחסים לדיווחי נגישות בעדיפות.
          </p>
          <p className="mt-3 rounded-lg bg-white p-3 text-xs text-slate-500">
            📝 להשלמה: שם רכז/ת נגישות, טלפון, דוא״ל, וזמן מענה.
          </p>
        </section>

        <div className="mt-10 flex flex-wrap gap-3 border-t border-slate-200 pt-6 text-sm">
          <Link href="/privacy" className="font-bold text-indigo-700 hover:underline">מדיניות פרטיות ←</Link>
          <Link href="/terms" className="font-bold text-indigo-700 hover:underline">תנאי שימוש ←</Link>
        </div>
      </div>
    </main>
  );
}
