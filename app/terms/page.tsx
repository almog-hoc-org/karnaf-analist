import Link from "next/link";
import { BUSINESS } from "@/lib/legal";

/**
 * Terms of use.
 *
 * Reviewed and approved by counsel (August 2026).
 *
 * The one clause that is NOT boilerplate is the disclaimer: this site publishes
 * property price estimates derived from government transaction data, and people
 * will make six- and seven-figure decisions after reading them. Saying plainly
 * that this is research and not advice — and that the underlying data can be
 * incomplete or wrong — is both the honest thing to do and the clause that
 * actually matters if anything goes wrong.
 */
export const metadata = { title: "תנאי שימוש | קרנף אנליסט" };

const UPDATED = "3 באוגוסט 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-black text-slate-900">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <main className="min-h-screen page-wrap py-10">
      <div className="mx-auto max-w-3xl px-4">
        <h1 className="mb-2 text-3xl font-black tracking-tight">
          <span className="text-gradient-hero">תנאי שימוש</span>
        </h1>
        <p className="mb-8 text-xs text-slate-500">עודכן: {UPDATED}</p>

        <div className="mb-8 rounded-xl border-2 border-red-200 bg-red-50 p-4">
          <h2 className="mb-2 text-base font-black text-red-900">⚠️ זה אינו ייעוץ</h2>
          <p className="text-sm leading-relaxed text-red-900">
            קרנף אנליסט הוא <strong>כלי מחקר</strong>. המספרים באתר הם עיבוד סטטיסטי של
            עסקאות שדווחו לרשות המסים, ואינם הערכת שווי, שמאות, ייעוץ השקעות או ייעוץ
            משכנתאות.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-red-900">
            <strong>אל תקבלו החלטת קנייה או מכירה על סמך האתר הזה בלבד.</strong> התייעצו עם
            שמאי מקרקעין, עורך דין ויועץ משכנתאות.
          </p>
        </div>

        <Section title="על הנתונים">
          <p>
            הנתונים מגיעים ממקורות ציבוריים — רשות המסים, הלשכה המרכזית לסטטיסטיקה ומשרד
            הבינוי והשיכון. אנו מעבדים אותם בכלים המתועדים ב
            <Link href="/methodology" className="font-bold text-indigo-700 hover:underline">מתודולוגיה</Link>.
          </p>
          <p>מגבלות שחשוב להכיר:</p>
          <ul className="list-inside list-disc space-y-1.5">
            <li>דיווח עסקאות לרשות המסים מתעכב — החודשים האחרונים תמיד חלקיים.</li>
            <li>עסקאות חריגות מסוננות אוטומטית; הסינון אינו מושלם ועלול להשמיט או להשאיר.</li>
            <li>בערים או שכונות עם מעט עסקאות, ממוצע יחיד יכול להטעות. האתר מסמן מדגם דק.</li>
            <li>עסקה שדווחה בטעות תופיע כפי שדווחה.</li>
          </ul>
          <p>
            אם נתקלתם במספר שנראה שגוי — <strong>נשמח שתדווחו</strong> דרך כפתור המשוב. זו
            הדרך הטובה ביותר לשפר את הדיוק.
          </p>
        </Section>

        <Section title="שימוש מותר">
          <ul className="list-inside list-disc space-y-1.5">
            <li>עיון, חיפוש והשוואה — חופשי.</li>
            <li>ציטוט נתונים תוך <strong>אזכור המקור וקישור לאתר</strong>.</li>
            <li>שימוש בסביבה האישית לניהול עבודתכם.</li>
          </ul>
        </Section>

        <Section title="שימוש אסור">
          <ul className="list-inside list-disc space-y-1.5">
            <li>גריפה אוטומטית (scraping) או העמסה מכוונת על השרת.</li>
            <li>ניסיון לעקוף מגבלות גישה או להגיע לנתוני משתמשים אחרים.</li>
            <li>הצגת נתוני האתר כשלכם, או מכירתם כמוצר.</li>
            <li>הזנת מידע על אנשים אחרים ללא בסיס חוקי לכך.</li>
          </ul>
        </Section>

        <Section title="יצירת קשר">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p><strong>{BUSINESS.name}</strong> · ח.פ {BUSINESS.companyId}</p>
            <p className="mt-1">
              דוא״ל: <a href={`mailto:${BUSINESS.email}`} className="font-bold text-indigo-700 hover:underline" dir="ltr">{BUSINESS.email}</a>
              {" · "}
              טלפון: <a href={`tel:${BUSINESS.phoneHref}`} className="font-bold text-indigo-700 hover:underline" dir="ltr">{BUSINESS.phone}</a>
            </p>
          </div>
        </Section>

        <Section title="חשבונות">
          <p>
            אתם אחראים לשמירת הסיסמה. אם הזנתם מידע על לקוחות — <strong>האחריות כלפיהם
            עליכם</strong>, לרבות הבסיס החוקי להחזקת המידע.
          </p>
        </Section>

        <Section title="זמינות">
          <p>
            השירות ניתן כמות שהוא (AS IS). איננו מתחייבים לזמינות רציפה, ורשאים לשנות או
            להפסיק אותו. נשתדל להודיע מראש על שינוי מהותי.
          </p>
        </Section>

        <Section title="הגבלת אחריות">
          <p>
            השירות ניתן ללא תשלום וכמות שהוא. אנו עושים מאמץ סביר לדיוק הנתונים, אך אין
            באפשרותנו להתחייב לכך שהם מלאים, מעודכנים או נקיים משגיאות — הם נגזרים ממקורות
            ציבוריים שאיננו שולטים בהם.
          </p>
          <p>
            <strong>{BUSINESS.name}</strong>, בעליה ומי מטעמה לא יישאו באחריות לנזק ישיר או
            עקיף שייגרם מהסתמכות על תוכן האתר, לרבות החלטת רכישה, מכירה או השקעה. השימוש
            באתר נעשה על אחריות המשתמש בלבד.
          </p>
          <p>
            אין באמור כדי לגרוע מזכויות שאינן ניתנות להתניה לפי דין, לרבות חוק הגנת הצרכן.
          </p>
          <p className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs">
            מצאתם נתון שגוי? <strong>דווחו לנו</strong> דרך כפתור המשוב. אנו מתקנים
            שגיאות שמדווחות לנו, וזו הדרך היעילה ביותר לשפר את הדיוק עבור כולם.
          </p>
        </Section>

        <Section title="דין וסמכות שיפוט">
          <p>
            על תנאים אלה יחולו דיני מדינת ישראל בלבד. סמכות השיפוט הייחודית בכל עניין
            הנוגע להם נתונה לבתי המשפט המוסמכים ב{BUSINESS.jurisdiction}.
          </p>
        </Section>

        <div className="mt-10 flex flex-wrap gap-3 border-t border-slate-200 pt-6 text-sm">
          <Link href="/privacy" className="font-bold text-indigo-700 hover:underline">מדיניות פרטיות ←</Link>
          <Link href="/accessibility" className="font-bold text-indigo-700 hover:underline">הצהרת נגישות ←</Link>
        </div>
      </div>
    </main>
  );
}
