import Link from "next/link";
import { BUSINESS } from "@/lib/legal";
import Icon from "@/components/Icon";

/**
 * Accessibility statement.
 *
 * WHAT THIS PAGE CAREFULLY DOES NOT SAY
 * It does not claim the site "complies with IS 5568". That claim requires an
 * audit by a certified accessibility auditor (מורשה נגישות), and asserting it
 * without one would be a false published statement — the opposite of what an
 * accessibility statement is for.
 *
 * What it does say is exactly what was built: the adjustments made, the tool
 * provided, and the areas known to still need work. Naming the gaps is what
 * makes the rest of the page credible.
 */
export const metadata = { title: "הצהרת נגישות | קרנף אנליסט" };

const UPDATED = "3 באוגוסט 2026";

export default function AccessibilityPage() {
  return (
    <main className="min-h-screen page-wrap py-10">
      <div className="mx-auto max-w-3xl px-4">
        <h1 className="mb-2 text-3xl font-black tracking-tight">
          <span className="text-gradient-hero">הצהרת נגישות</span>
        </h1>
        <p className="mb-8 text-xs text-slate-500">עודכן: {UPDATED}</p>

        <section className="mb-8 space-y-3 text-sm leading-relaxed text-slate-700">
          <h2 className="mb-3 text-lg font-black text-slate-900">כלי הנגישות באתר</h2>
          <p>
            בפינת המסך יש כפתור <strong><Icon name="accessibility" size="1em" /> אפשרויות נגישות</strong>. הוא זמין בכל עמוד,
            וההעדפות נשמרות בדפדפן שלכם לביקורים הבאים:
          </p>
          <ul className="list-inside list-disc space-y-1.5">
            <li><strong>הגדלת טקסט</strong> — ארבע רמות, עד 150%.</li>
            <li><strong>ניגודיות גבוהה</strong> — הכהיית טקסט וחיזוק מסגרות.</li>
            <li><strong>הדגשת קישורים</strong> — קו תחתון לכל הקישורים.</li>
            <li><strong>עצירת אנימציות</strong> — לרגישים לתנועה.</li>
            <li><strong>גופן קריא</strong> — ריווח אותיות ושורות מוגדל.</li>
            <li><strong>סמן מוגדל</strong>.</li>
          </ul>
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
            הכלי משנה את התצוגה בפועל. הוא <strong>אינו</strong> מתיימר להחליף נגישות בקוד
            עצמו, ולכן בוצעו גם ההתאמות שלהלן.
          </p>
        </section>

        <section className="mb-8 space-y-3 text-sm leading-relaxed text-slate-700">
          <h2 className="mb-3 text-lg font-black text-slate-900">התאמות שבוצעו באתר</h2>
          <ul className="list-inside list-disc space-y-1.5">
            <li><strong>דילוג לתוכן</strong> — קישור ראשון בכל עמוד, לניווט מקלדת.</li>
            <li><strong>מבנה סמנטי</strong> — כותרות היררכיות ואזורי ניווט מסומנים.</li>
            <li><strong>תוויות <code className="font-mono text-xs">aria</code></strong> על כפתורים, שדות וקבוצות בחירה.</li>
            <li><strong>ניווט מלא במקלדת</strong> — תפריטים, חיפוש, טפסים וחלוניות. <kbd className="rounded border border-slate-300 bg-slate-100 px-1 text-2xs">Esc</kbd> סוגר.</li>
            <li><strong>סימון פוקוס גלוי</strong> על כל רכיב אינטראקטיבי.</li>
            <li><strong>כיבוד <code className="font-mono text-xs">prefers-reduced-motion</code></strong> של מערכת ההפעלה.</li>
            <li><strong>מותאם למובייל</strong>, וגודל טקסט שאינו גורם לזום אוטומטי ב-iOS.</li>
            <li><strong>תמיכה מלאה ב-RTL</strong>.</li>
          </ul>
          <p>ההתאמות בוצעו לפי הנחיות <strong>WCAG 2.0 ברמה AA</strong>.</p>
        </section>

        <section className="mb-8 space-y-3 text-sm leading-relaxed text-slate-700">
          <h2 className="mb-3 text-lg font-black text-slate-900">מה עדיין לא נבדק</h2>
          <p>
            <strong>טרם בוצעה בדיקה על ידי מורשה נגישות</strong>, ולכן איננו מצהירים על
            עמידה בתקן ישראלי 5568 — הצהרה כזו מחייבת אישור מוסמך. אנו פועלים להשלמת הבדיקה.
          </p>
          <p>אזורים שידועים לנו כדורשים שיפור:</p>
          <ul className="list-inside list-disc space-y-1.5">
            <li><strong>גרפים אינטראקטיביים</strong> — הנתונים זמינים גם כטבלה, אך נדרש שיפור בתיאור לקוראי מסך.</li>
            <li><strong>טבלאות רחבות</strong> — נגללות אופקית; הניווט בהן במקלדת דורש שיפור.</li>
            <li><strong>יחסי ניגודיות</strong> — טרם נבדקו בכל צירופי הצבעים.</li>
          </ul>
          <p className="text-xs text-slate-500">
            אנחנו מעדיפים לפרט את הפערים ולא להסתיר אותם. אם נתקלתם בקושי שאינו ברשימה —
            נשמח לשמוע.
          </p>
        </section>

        <section className="mb-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <h2 className="mb-2 font-black text-slate-900">נתקלתם בבעיה?</h2>
          <p className="leading-relaxed text-slate-700">
            אפשר לדווח דרך כפתור המשוב <Icon name="chat" size="1em" /> בפינת המסך. אנו מתייחסים לדיווחי נגישות בעדיפות.
          </p>
          <div className="mt-3 rounded-lg bg-white p-3 text-sm">
            <p className="font-bold text-slate-900">רכז נגישות</p>
            <p className="mt-1">{BUSINESS.name} · ח.פ {BUSINESS.companyId}</p>
            <p className="mt-1">
              טלפון: <a href={`tel:${BUSINESS.phoneHref}`} className="font-bold text-indigo-700 hover:underline" dir="ltr">{BUSINESS.phone}</a>
            </p>
            <p className="mt-1">
              דוא״ל: <a href={`mailto:${BUSINESS.email}`} className="font-bold text-indigo-700 hover:underline" dir="ltr">{BUSINESS.email}</a>
            </p>
            <p className="mt-2 text-xs text-slate-500">
              נשיב תוך {BUSINESS.responseDays} ימי עסקים. פניות נגישות מטופלות בעדיפות.
            </p>
          </div>
        </section>

        <div className="mt-10 flex flex-wrap gap-3 border-t border-slate-200 pt-6 text-sm">
          <Link href="/privacy" className="font-bold text-indigo-700 hover:underline">מדיניות פרטיות ←</Link>
          <Link href="/terms" className="font-bold text-indigo-700 hover:underline">תנאי שימוש ←</Link>
        </div>
      </div>
    </main>
  );
}
