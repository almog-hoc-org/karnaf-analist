import Link from "next/link";
import { BUSINESS, RETENTION_HE } from "@/lib/legal";
import Icon from "@/components/Icon";

/**
 * Privacy notice. Reviewed and approved by counsel (August 2026).
 *
 * The inventory below is written FROM THE DATABASE SCHEMAS, not from memory:
 * every column in users, client_deals, events and feedback is accounted for. If
 * a new field starts being collected, this page has to change with it —
 * otherwise the notice becomes false, which is worse than having none.
 *
 * Retention periods are not prose. They come from RETENTION in lib/legal.ts,
 * the same constants scripts/prune-retention.ts enforces nightly, so the stated
 * policy and the actual database cannot drift apart.
 */
export const metadata = { title: "מדיניות פרטיות | קרנף אנליסט" };

const UPDATED = "3 באוגוסט 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-black text-slate-900">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen page-wrap py-10">
      <div className="mx-auto max-w-3xl px-4">
        <h1 className="mb-2 text-3xl font-black tracking-tight">
          <span className="text-gradient-hero">מדיניות פרטיות</span>
        </h1>
        <p className="mb-8 text-xs text-slate-500">עודכן: {UPDATED}</p>

        <Section title="בקצרה">
          <ul className="list-inside list-disc space-y-1.5">
            <li>אפשר להשתמש בכל נתוני המחקר באתר <strong>בלי להירשם ובלי למסור פרטים</strong>.</li>
            <li>אנחנו <strong>לא</strong> שומרים כתובות IP ולא מזהי מכשיר.</li>
            <li>אנחנו <strong>לא</strong> מוכרים מידע ולא מעבירים אותו למפרסמים.</li>
            <li>חשבון נדרש רק לסביבת העבודה האישית ב-<code className="font-mono text-xs">/deals</code>.</li>
          </ul>
        </Section>

        <Section title="מי אנחנו">
          <p>
            קרנף אנליסט הוא כלי מחקר של שוק הדיור בישראל. לשאלות בנושא פרטיות, או לבקשת
            עיון, תיקון או מחיקה של מידע — ניתן לפנות בכתובת המופיעה בתחתית האתר.
          </p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p><strong>{BUSINESS.name}</strong> · ח.פ {BUSINESS.companyId}</p>
            <p className="mt-1">
              דוא״ל: <a href={`mailto:${BUSINESS.email}`} className="font-bold text-indigo-700 hover:underline" dir="ltr">{BUSINESS.email}</a>
            </p>
            <p className="mt-1">
              טלפון: <a href={`tel:${BUSINESS.phoneHref}`} className="font-bold text-indigo-700 hover:underline" dir="ltr">{BUSINESS.phone}</a>
            </p>
          </div>
        </Section>

        <Section title="מה אנחנו אוספים">
          <p className="font-bold text-slate-900">1. גלישה רגילה — ללא חשבון</p>
          <p>
            כשאתם צופים בעמודי המחקר נרשם לוג פעילות מצומצם: שם הפעולה (צפייה בעמוד, חיפוש,
            פתיחת גרף), הנתיב באתר, העיר או המדד שנצפו, ומונח החיפוש שהוקלד.
          </p>
          <p>
            <strong>מה שלא נרשם:</strong> כתובת IP, סוג דפדפן או מערכת הפעלה, מזהה מכשיר,
            עוגיית מעקב. מזהה הסשן הוא ערך אקראי שנשמר בכרטיסייה בלבד ונמחק עם סגירתה —
            הוא משמש רק כדי להבחין בין ביקור אחד לחמישה ביקורים, ואינו ניתן לקישור אליכם.
          </p>

          <p className="mt-4 font-bold text-slate-900">2. טופס משוב</p>
          <p>
            נשמרים: סוג הפנייה, תוכן ההודעה, דירוג (אם נבחר), <strong>כתובת דוא״ל אם בחרתם
            למסור</strong> (אינה חובה), העמוד שממנו נשלחה הפנייה, העיר והתצוגה שהיו פתוחות,
            וגודל החלון. ההקשר נאסף כדי שנוכל לשחזר את מה שראיתם.
          </p>

          <p className="mt-4 font-bold text-slate-900">3. חשבון משתמש</p>
          <p>
            נשמרים: כתובת דוא״ל, שם, ותאריך הצטרפות. <strong>הסיסמה אינה נשמרת</strong> —
            נשמר ממנה גיבוב חד-כיווני (scrypt) עם מלח ייחודי, שלא ניתן להפוך בחזרה לסיסמה.
          </p>

          <p className="mt-4 font-bold text-slate-900">4. סביבת העבודה האישית</p>
          <p>
            אם תזינו עסקאות ב-<code className="font-mono text-xs">/deals</code>, יישמרו הפרטים
            שהזנתם: עיר, שכונה, רחוב ומספר בית, שטח, חדרים, קומה, מחיר, מרפסת, חניה, מחסן,
            סטטוס, קישור למודעה, והערות חופשיות.
          </p>
          <p className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs">
            <Icon name="warning" size="1em" /> <strong>אם אתם מזינים פרטים על לקוחות</strong> — אתם אחראים למידע הזה כלפי
            אותם אנשים. הסביבה נגישה <strong>אך ורק לחשבון שיצר אותה</strong>, ואינה נכללת
            בהקלטות מסך או בלוג האירועים.
          </p>
        </Section>

        <Section title="כלים של צד שלישי">
          <p>
            אנו עשויים להשתמש ב-<strong>Microsoft Clarity</strong> לניתוח שימוש (מפות חום
            והקלטות מסך אנונימיות) בעמודי המחקר בלבד.
          </p>
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <strong>Clarity אינו נטען כלל</strong> בעמודי <code className="font-mono text-xs">/deals</code>,{" "}
            <code className="font-mono text-xs">/admin</code>, ההתחברות וההרשמה. זו אינה הגדרה
            שניתן לשנות בטעות — הסקריפט פשוט לא נשלח לדפדפן בעמודים האלה.
          </p>
          <p>
            מידע שנאסף ב-Clarity מעובד על ידי Microsoft ומאוחסן <strong>בשרתים מחוץ
            לישראל</strong>. מדיניות הפרטיות של Microsoft:{" "}
            <a href="https://privacy.microsoft.com/privacystatement" target="_blank" rel="noopener noreferrer"
               className="font-bold text-indigo-700 hover:underline">privacy.microsoft.com</a>
          </p>
          <p className="text-xs text-slate-500">
            אם וכאשר נוסיף כלים נוספים של צד שלישי, נעדכן סעיף זה לפני הפעלתם.
          </p>
        </Section>

        <Section title="למה אנחנו משתמשים במידע">
          <ul className="list-inside list-disc space-y-1.5">
            <li><strong>לתפעול</strong> — התחברות ושמירת הסביבה האישית שלכם.</li>
            <li><strong>לשיפור</strong> — להבין אילו נתונים מחפשים ולא מוצאים.</li>
            <li><strong>לתיקון תקלות</strong> — לשחזר באגים שדווחו.</li>
            <li><strong>לאבטחה</strong> — הגבלת קצב מול ניסיונות פריצה.</li>
          </ul>
          <p>
            <strong>איננו</strong> משתמשים במידע לפרסום ממוקד, ואיננו מוכרים או משכירים אותו
            לאיש.
          </p>
        </Section>

        <Section title="אבטחה">
          <ul className="list-inside list-disc space-y-1.5">
            <li>כל התעבורה מוצפנת ב-HTTPS.</li>
            <li>סיסמאות נשמרות כגיבוב scrypt עם מלח ייחודי לכל משתמש.</li>
            <li>הסביבה האישית מבודדת ברמת מסד הנתונים — חשבון אינו יכול לגשת לנתוני חשבון אחר.</li>
            <li>גיבויים יומיים.</li>
          </ul>
        </Section>

        <Section title="הזכויות שלכם">
          <p>לפי חוק הגנת הפרטיות התשמ״א-1981, אתם רשאים:</p>
          <ul className="list-inside list-disc space-y-1.5">
            <li><strong>לעיין</strong> במידע שנשמר עליכם</li>
            <li><strong>לתקן</strong> מידע שגוי</li>
            <li><strong>לבקש מחיקה</strong> של המידע והחשבון</li>
          </ul>
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm">
            <p>
              לפנייה: <a href={`mailto:${BUSINESS.email}`} className="font-bold text-indigo-700 hover:underline" dir="ltr">{BUSINESS.email}</a>
            </p>
            <p className="mt-1 text-xs text-slate-600">
              נשיב תוך <strong>{BUSINESS.responseDays} ימי עסקים</strong>. כדי שנוכל לאתר את
              המידע, נבקש לציין את כתובת הדוא״ל שאיתה נרשמתם.
            </p>
          </div>
        </Section>

        <Section title="שמירת מידע">
          <ul className="list-inside list-disc space-y-1.5">
            <li><strong>לוג אירועים</strong> — {RETENTION_HE.events}, ואז נמחק אוטומטית.</li>
            <li><strong>פניות משוב</strong> — {RETENTION_HE.feedback}, ואז נמחקות אוטומטית.</li>
            <li><strong>סשנים שפגו</strong> — {RETENTION_HE.sessions}.</li>
            <li><strong>גיבויים</strong> — {RETENTION_HE.backups}.</li>
            <li>
              <strong>חשבון והסביבה האישית</strong> — כל עוד החשבון פעיל. בבקשת מחיקה,
              נמחק תוך {BUSINESS.responseDays} ימי עסקים.
            </li>
          </ul>
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
            <Icon name="check" size="1em" /> התקופות האלה <strong>נאכפות אוטומטית</strong> על ידי משימה לילית, ואינן הצהרה
            בלבד. אותם ערכים עצמם מגדירים גם את המסמך הזה וגם את המחיקה בפועל.
          </p>
        </Section>

        <Section title="שינויים">
          <p>
            נעדכן מסמך זה בעת הצורך. תאריך העדכון האחרון מופיע בראש העמוד. שינוי מהותי יוצג
            באתר.
          </p>
        </Section>

        <div className="mt-10 flex flex-wrap gap-3 border-t border-slate-200 pt-6 text-sm">
          <Link href="/terms" className="font-bold text-indigo-700 hover:underline">תנאי שימוש ←</Link>
          <Link href="/accessibility" className="font-bold text-indigo-700 hover:underline">הצהרת נגישות ←</Link>
          <Link href="/methodology" className="font-bold text-indigo-700 hover:underline">מתודולוגיה ←</Link>
        </div>
      </div>
    </main>
  );
}
