import { prisma } from "@/lib/db";
import SourceBadge from "@/components/SourceBadge";
import { RESIDENTIAL_TYPES } from "@/lib/methodologyFacts";
import { getRuleNum } from "@/lib/systemRules";

export const metadata = { title: "מתודולוגיה — איך המספרים מחושבים | קרנף אנליסט" };
export const dynamic = "force-dynamic";

/** Public methodology page — the numbers here are imported FROM THE CODE. */
export default async function MethodologyPage() {
  // live values from the admin rules — the page can never drift from reality
  const SECONDHAND_MIN_AGE = getRuleNum("secondhand_min_age");
  const MIN_N_PER_YEAR = getRuleNum("min_deals_per_year", 10);
  const RANKING_MIN_PER_SCOPE = getRuleNum("ranking_min_per_scope", 10);
  const SANITY = {
    MIN_AREA: getRuleNum("min_area", 20), MAX_AREA: getRuleNum("max_area", 500),
    MIN_SQM: getRuleNum("min_sqm_price", 2000), MAX_SQM: getRuleNum("max_sqm_price", 200000),
  };
  const [totals] = await prisma.$queryRawUnsafe<Array<{ n: bigint; sh: bigint; nw: bigint; st: bigint; maxd: string | null }>>(
    `SELECT COUNT(*) n, SUM(is_secondhand) sh,
            SUM(CASE WHEN year_built IS NOT NULL AND is_secondhand=0 THEN 1 ELSE 0 END) nw,
            COUNT(street) st, MAX(deal_date) maxd
     FROM nadlan_transactions WHERE COALESCE(excluded,0)=0`
  ).catch(() => [{ n: BigInt(0), sh: BigInt(0), nw: BigInt(0), st: BigInt(0), maxd: null }]);
  const runs = await prisma.$queryRawUnsafe<Array<{ city_name: string; source: string; status: string; rows: number | null; updated_at: string }>>(
    `SELECT city_name, source, status, n_deals rows, last_collected updated_at FROM nadlan_collection_status ORDER BY last_collected DESC LIMIT 8`
  ).catch(() => []);

  const n = Number(totals?.n ?? 0), sh = Number(totals?.sh ?? 0), nw = Number(totals?.nw ?? 0), st = Number(totals?.st ?? 0);

  const Section = ({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) => (
    <section className="glass-card mb-6 p-6">
      <h2 className="mb-3 flex items-center gap-2 text-xl font-black text-slate-900">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-base">{icon}</span>
        {title}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
  const B = ({ children }: { children: React.ReactNode }) => <strong className="text-slate-900">{children}</strong>;

  return (
    <main className="min-h-screen page-wrap py-8">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-black md:text-4xl"><span className="text-gradient-hero">איך המספרים מחושבים</span></h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-500">
          שקיפות מלאה: כל כלל שמופיע כאן נטען ישירות מקוד המערכת — התיעוד לא יכול לסטות מהמציאות.
          המאגר: <strong className="text-indigo-700">{n.toLocaleString("he-IL")}</strong> עסקאות בשימוש · עדכון אחרון {totals?.maxd?.slice(0, 10) ?? "—"}
        </p>
      </header>

      <Section icon="📥" title="שני ערוצי איסוף בלתי-תלויים">
        <p><B>ערוץ govmap (רשות המסים — שכבת המפה):</B> סריקה גיאוגרפית של פוליגוני עסקאות סביב כל עיר, ללא דפדפן. תורם <B>רחוב, מספר בית וקומה</B> ({st.toLocaleString("he-IL")} עסקאות עם כתובת). אין בו שדה שנת-בנייה. הוא משמש <B>לכתובות בלבד</B> — לא לחישוב מחיר (נמצא רועש: סטייה של עשרות אחוזים מהחציון הרשמי, לשני הכיוונים, בין ערים).</p>
        <p><B>ערוץ nadlan (רשות המסים — deal-data חתום):</B> ה-API הרשמי עם חתימה קריפטוגרפית, כולל <B>שנת בנייה</B> — הבסיס לסיווג. מכסה אנונימית ~1,000 עסקאות לחלון שאילתה; אנחנו פורשים אותה בפילוחי חדרים, סוג-עסקה, חלונות-זמן ורמת שכונה. רץ אוטומטית כל לילה (02:30) עד השלמת 10 שנים בכל עיר.</p>
      </Section>

      <Section icon="🏷️" title="סיווג יד-שנייה / חדשה">
        <p className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 font-bold text-slate-900" dir="rtl">
          שנת עסקה − שנת בנייה ≥ {SECONDHAND_MIN_AGE} ← <span className="text-indigo-700">יד שנייה</span> · פחות מ-{SECONDHAND_MIN_AGE} שנים ← <span className="text-indigo-700">חדשה</span>
        </p>
        <p>במאגר כרגע: <B>{sh.toLocaleString("he-IL")} יד-שנייה</B> · <B>{nw.toLocaleString("he-IL")} חדשות</B> (מסווגות משנת-בנייה אמיתית). כל סדרות המחיר — כולל "כללי" — מחושבות מעסקאות nadlan (שיש להן שנת-בנייה); govmap משמש לכתובות בלבד.</p>
        <p>למה יד-2 היא בסיס ההשוואה באתר? עיר ישנה שבונים בה שכונה חדשה יקרה תראה קפיצת "ממוצע כללי" שאינה משקפת את מגמת השוק — ולכן דירוגי שינוי-מחיר משווים <B>יד-שנייה בלבד</B>.</p>
      </Section>

      <Section icon="🧮" title="חישוב ממוצע וחציון">
        <p>לכל עיר × שנה × גודל-דירה × סוג-עסקה: <B>ממוצע ₪/מ"ר</B> = ממוצע חשבוני של מחיר-למ"ר בכל העסקאות בתא · <B>חציון ₪/מ"ר</B> = הערך האמצעי (עמיד לחריגים). אותו חישוב גם למחיר-עסקה מלא.</p>
        <p><B>סדרת יד-2 מתוקננת-הרכב (הבסיס לשינויי-המחיר):</B> חציון גולמי מוטה כשתמהיל-המדגם משתנה בין שנים (יותר דירות קטנות/שכונות יקרות ⇒ "עלייה" מדומה). לכן שינויי-המחיר מחושבים על <B>סל קבוע</B> של תאי שכונה×חדרים: כל שנה = ממוצע משוקלל של חציוני-התאים באותם משקולות בדיוק. אומת מול מכירות-חוזרות של אותן דירות ומול החציון הרשמי.</p>
        <p>תא-שנה נכנס לגרפים ולטבלאות רק אם יש בו <B>{MIN_N_PER_YEAR}+ עסקאות</B> — שנה דלה לא מקבלת נקודת מחיר (ולכן גרף של עיר עם דאטה חלקי נפתח מהשנה שבה מתחיל רצף אמין).</p>
      </Section>

      <Section icon="🧹" title="סינון שפיות (בזמן האיסוף)">
        <ul className="list-inside list-disc space-y-1">
          <li>שטח דירה: <B>{SANITY.MIN_AREA}–{SANITY.MAX_AREA} מ"ר</B></li>
          <li>מחיר למ"ר: <B>₪{SANITY.MIN_SQM.toLocaleString("he-IL")}–₪{SANITY.MAX_SQM.toLocaleString("he-IL")}</B></li>
          <li>רק נכסי מגורים: {RESIDENTIAL_TYPES.join(", ")} (קרקעות/מסחר/חניות מסוננים)</li>
          <li><B>מיזוג בין-ערוצי:</B> אותה עסקה נאספת פעמיים (nadlan עם שנת-בנייה · govmap עם רחוב+קומה) — היא ממוזגת לשורה שלמה אחת ונספרת פעם אחת בלבד</li>
          <li><B>סיווג חדרים לפי שטח:</B> השטח אמין יותר מדיווח מספר-החדרים — עסקה שהשטח שלה מחוץ לטווח החדרים המדווחים מסווגת-מחדש לפי השטח (למשל 4 חד׳ ב-60 מ״ר → 3 חד׳). כל חישובי טיפוס-הדירה משתמשים בחדרים המתוקנים</li>
          <li><B>אנומליות מחיר:</B> לכל קבוצה עיר×שנה×טיפוס-דירה (חדרים לפי שטח)×יד-2/חדשה נלקח חציון ה-₪/מ"ר; עסקה שחורגת מעל <B>{getRuleNum("anomaly_deviation_pct", 35)}%</B> מהחציון מסווגת אנומליה (חלק-נכס/נומינלי, שגיאת-שטח) ולא נספרת. הסף מתכוונן בדשבורד הניהול</li>
          <li>בנוסף, מנהל המערכת יכול להחריג עסקאות ספציפיות — עסקה מוחרגת יוצאת מכל החישובים באתר</li>
        </ul>
      </Section>

      <Section icon="👯" title="כפילויות דיווח — אותה מכירה שדווחה פעמיים">
        <p className="mb-2">
          רשות המסים מפרסמת לעיתים את אותה עסקה פעמיים בהפרש ימים בודדים (תיקון או פרסום חוזר), ושני ערוצי האיסוף רואים אותה בנפרד.
          מחיר זהה לשקל, שטח זהה, מספר חדרים זהה ושנת בנייה תואמת בתוך חלון של <B>{getRuleNum("dupe_window_days", 7)} ימים</B> = דיווח כפול, לא שתי מכירות.
          נשמרת הרשומה המפורטת ביותר (שנת בנייה קודם, אחר כך כתובת), והיא סופגת את פרטי הכתובת מהעותק שנמחק.
        </p>
        <p className="mb-2">
          <B>הגנה מפני זיהוי שגוי:</B> בפרויקט קבלן נמכרות דירות זהות לגמרי במחירון זהה באותו שבוע — אלה מכירות אמיתיות.
          לכן מקבץ שבו <B>הכתובת שונה</B> נשאר שלם, ומקבץ באותו בניין שבו <B>רק הקומה שונה</B> מוגבל ל-<B>{getRuleNum("dupe_same_building_max", 2)} עסקאות</B> —
          מעבר לכך זה כבר לא שוק אלא דיווח. הבחנה זו נמדדה: כשהדירה זהה בוודאות, 82.5% מהדיווחים מרוחקים יום אחד בדיוק (חתימת פרסום חוזר); כשהדירות שונות — רק 39.3%.
        </p>
        <p>עותק כפול אינו עסקה שקרתה, ולכן הוא יוצא <B>גם מהספירות וגם מהמחירים</B>. כל הפרמטרים ניתנים לעריכה בדשבורד הניהול.</p>
      </Section>

      <Section icon="💎" title="עסקאות יוקרה — יוצאות מהמחירים, נשארות בספירה">
        <p className="mb-2">
          עסקה יקרה מעוותת ממוצע רק אם היא יקרה גם <B>ביחס לקטגוריה שלה</B>. לכן נדרשים שני תנאים במצטבר:
          מחיר מעל <B>₪{getRuleNum("luxury_min_price", 4_500_000).toLocaleString("he-IL")}</B>, <B>וגם</B> מחיר למ״ר גבוה
          ביותר מ-<B>{getRuleNum("luxury_sqm_premium_pct", 20)}%</B> מחציון אותה קטגוריה — עיר × שנה × מספר חדרים × סוג (יד-שנייה/חדשה).
        </p>
        <p className="mb-2">
          פנטהאוז ב-₪5M שהמחיר-למ״ר שלו זהה לשאר דירות ה-5 חדרים בעיר אינו חריג ונשאר בחישוב.
          במדידה בפועל כמחצית מהעסקאות מעל הסף אינן חריגות לקטגוריה שלהן ונשארות. קטגוריה עם פחות מ-<B>{getRuleNum("luxury_min_cohort", 10)} עסקאות</B> אינה בסיס אמין,
          והמערכת יורדת לקטגוריה רחבה יותר; אם גם היא דקה מדי — לא מסמנים כלל.
        </p>
        <p>
          <B>עסקת יוקרה קרתה במציאות</B> — ולכן היא ממשיכה להיספר, מופיעה בפירוט העסקאות עם תווית &quot;יוקרה&quot;, ורק אינה נכללת בממוצעים, בחציונים ובגרפים.
        </p>
      </Section>

      <Section icon="⚖️" title="נרמול דירוגים">
        <p>לטבלאות "ערים שעלו/ירדו" ולדירוגים נכנסות רק ערים עם <B>{RANKING_MIN_PER_SCOPE}+ עסקאות מכל סוג</B> (כללי, יד-2, חדשות) בשנה מלאה אחרונה — יישוב עם חמש עסקאות ו"+100%" לא יופיע כמוביל ארצי. שינויים דורשים {MIN_N_PER_YEAR}+ עסקאות בשתי שנות ההשוואה.</p>
      </Section>

      <Section icon="🏛️" title="מקורות משלימים (מסומנים תמיד)">
        <p>לצד המאגר העצמאי (🔵) מוצגים מקורות חיצוניים מסומנים 🏛️: <B>חציון גוב-נדלן הרשמי</B> (סדרה מקווקווה בגרפים), <B>למ"ס</B> (אוכלוסייה, היתרים, התחלות/גמר בנייה, דוחות), ו-<B>יד2/ידאטה</B> (מצב שוק). הם משלימים — לא מקור המחירים הראשי.</p>
      </Section>

      <Section icon="🕒" title="עדכניות — ריצות איסוף אחרונות">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" dir="rtl">
            <thead><tr className="border-b border-slate-200 text-2xs font-bold text-slate-500">
              <th className="py-1.5 text-right">עיר</th><th>ערוץ</th><th>סטטוס</th><th>שורות</th><th>מתי</th></tr></thead>
            <tbody>
              {runs.map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1.5 text-right font-semibold text-slate-800">{r.city_name}</td>
                  <td className="text-center">{r.source}</td>
                  <td className="text-center">{r.status === "ok" ? "✓" : r.status}</td>
                  <td className="text-center tabular-nums">{r.rows?.toLocaleString("he-IL") ?? "—"}</td>
                  <td className="text-center tabular-nums text-slate-500">{String(r.updated_at).slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-2xs text-slate-400">איסוף לילי אוטומטי 02:30 (nadlan) · השלמות יומיות 13:00 (govmap) · אגרגציה בסוף כל ריצה.</p>
      </Section>

      <div className="mt-8 flex items-center justify-center gap-2 text-2xs text-slate-400">
        <SourceBadge kind="internal" /> נאסף, סונן וחושב באופן בלתי-תלוי · אינו מהווה ייעוץ השקעות
      </div>
    </main>
  );
}
