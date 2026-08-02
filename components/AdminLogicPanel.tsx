import { getRuleNum } from "@/lib/systemRules";

/**
 * Transparent view of the FULL computation pipeline — every raw deal → the
 * numbers on the site — with the LIVE rule values. Server component (reads the
 * rules directly). Answers "how is each number computed and what got filtered".
 */
export default function AdminLogicPanel() {
  const minSqm = getRuleNum("min_sqm_price", 2000), maxSqm = getRuleNum("max_sqm_price", 200000);
  const minArea = getRuleNum("min_area", 20), maxArea = getRuleNum("max_area", 500);
  const anomPct = getRuleNum("anomaly_deviation_pct", 35);
  const shAge = getRuleNum("secondhand_min_age", 4);
  const minN = getRuleNum("min_deals_per_year", 10);
  const r3 = `${getRuleNum("room3_area_min", 55)}-${getRuleNum("room3_area_max", 85)}`;
  const r4 = `${getRuleNum("room4_area_min", 75)}-${getRuleNum("room4_area_max", 130)}`;
  const dupWin = getRuleNum("dupe_window_days", 7);
  const dupBld = getRuleNum("dupe_same_building_max", 2);
  const luxMin = getRuleNum("luxury_min_price", 4_500_000);
  const luxPct = getRuleNum("luxury_sqm_premium_pct", 20);

  const steps: { n: number; icon: string; title: string; body: string; param?: string }[] = [
    { n: 1, icon: "🏛️", title: "מקור — רשות המסים (10 שנים)", body: "כל עסקה היא עסקת-אמת סגורה מרשות המסים, בשני ערוצים: nadlan (API חתום — כולל שנת בנייה) ו-govmap (שכבת מפה — כולל רחוב+קומה). כל החישובים על 10 השנים האחרונות בלבד." },
    { n: 2, icon: "🔗", title: "מיזוג כפילויות בין-ערוציות", body: "אותה עסקה נאספת פעמיים — nadlan מחזיק שנת-בנייה, govmap מחזיק רחוב+קומה. ממזגים לשורה אחת שלמה (שנת-בנייה + כתובת + קומה יחד) ומוחקים את הכפילות — כדי שלא תיספר פעמיים.", param: "מפתח: עיר+תאריך+מחיר+שטח+חדרים" },
    { n: 3, icon: "📐", title: "סיווג חדרים לפי שטח", body: "השטח אמין יותר מדיווח מספר-החדרים. עסקה שהשטח שלה מחוץ לטווח של החדרים המדווחים מסווגת-מחדש לפי השטח (למשל 4 חד׳ ב-60מ״ר → 3 חד׳). כל חישובי טיפוס-הדירה משתמשים בחדרים המתוקנים.", param: `למשל 3 חד׳=${r3}מ"ר · 4 חד׳=${r4}מ"ר (עריך)` },
    { n: 4, icon: "👯", title: "כפילויות דיווח (אותה עסקה, יומיים)", body: "רשות המסים מפרסמת את אותה מכירה פעמיים בהפרש ימים בודדים. מחיר, שטח, חדרים ושנת-בנייה זהים בתוך החלון = דיווח כפול; נשמרת הרשומה המפורטת ביותר והשאר יוצאות מהספירות ומהמחירים. הגנה: כשהקומה או הכתובת שונות מדובר בדירות שונות — מקבץ קטן באותו בניין נשאר, מעבר לכך זה כבר לא שוק.", param: `חלון ${dupWin} ימים · עד ${dupBld} באותו בניין` },
    { n: 5, icon: "🧹", title: "סינון שפיות", body: "עסקאות מחוץ לטווחים (שטח 0/חסר, ₪/מ\"ר לא-אפשרי) מוחרגות — כדי שהמאגר הפעיל == המאגר השמיש שמזין את הגרפים.", param: `₪/מ"ר ${minSqm.toLocaleString("he-IL")}–${maxSqm.toLocaleString("he-IL")} · שטח ${minArea}–${maxArea} מ"ר` },
    { n: 6, icon: "⚠️", title: "אנומליות מחיר (סטייה מהחציון)", body: 'לכל קבוצה עיר × שנה × טיפוס-דירה (חדרים לפי שטח) × יד-2/חדשה נלקח חציון ה-₪/מ"ר. עסקה שחורגת מעל האחוז הזה מהחציון = אנומליה (חלק-נכס/נומינלי בזנב התחתון, שגיאת-שטח בעליון) ולא נכנסת לממוצעים/גרפים. ניתן לכוונון.', param: `סטייה > ${anomPct}% מחציון הטיפוס` },
    { n: 7, icon: "💎", title: "עסקאות יוקרה (יוצאות מהמחירים בלבד)", body: "עסקה יקרה מעוותת ממוצע רק אם היא יקרה גם ביחס לקטגוריה שלה. שני תנאים במצטבר: מחיר מעל הסף, וגם ₪/מ\"ר גבוה מעל האחוז הזה מחציון אותה עיר × שנה × חדרים × סוג. דירה יקרה שהמחיר-למ\"ר שלה תקין לקטגוריה נשארת בחישוב. עסקת יוקרה קרתה — היא ממשיכה להיספר ולהופיע בפירוט עם תווית, ורק אינה קובעת ממוצע.", param: `מעל ₪${(luxMin/1e6).toFixed(1)}M וגם +${luxPct}% מחציון הקטגוריה` },
    { n: 8, icon: "🧮", title: "חישוב מחיר (nadlan בלבד)", body: 'לכל עיר × שנה × טיפוס-דירה × סוג: ממוצע וחציון ₪/מ"ר ו-₪-עסקה. המחירים מ-nadlan בלבד — govmap רועש למחיר (נשאר רק לכתובות).' },
    { n: 9, icon: "🏷️", title: "סיווג יד-2 / חדשה", body: "עסקה מסווגת יד-שנייה אם חלפו לפחות כך שנים משנת הבנייה; פחות — דירה חדשה.", param: `שנת עסקה − שנת בנייה ≥ ${shAge} שנים` },
    { n: 10, icon: "🚪", title: "גייט מדגם", body: "שנה/קבוצה עם מעט מדי עסקאות לא מקבלת נקודת מחיר — לעולם לא מתמחרים מרעש.", param: `מינימום ${minN} עסקאות` },
    { n: 11, icon: "🛡️", title: "בקרת אמינות + עוגן רשמי", body: "audit לילי מסמן תאים חשודים ומשווה מול החציון הרשמי של רשות המסים (nadlan_price_trends). המשתמש בוחר מקור (מערכת/רשמי) וסטטיסטיקה (ממוצע/חציון) לכל מחיר." },
    { n: 12, icon: "📊", title: "תצוגה", body: "רק אחרי כל השלבים המספרים מגיעים לגרפים, לטבלת הערים, לדירוגים ולהשוואות — כולם צורכים את אותו מאגר מנוקה." },
  ];

  return (
    <div className="space-y-3">
      <div className="glass-card p-4">
        <h3 className="text-sm font-black text-slate-900">🧮 צינור החישוב — מעסקה גולמית למספר באתר</h3>
        <p className="mt-1 text-2xs text-slate-500">כל שלב עם הפרמטר החי שלו (ניתן לעריכה בטאב "חוקי המערכת"). כך כל מספר באתר ניתן להסבר מלא.</p>
      </div>
      <ol className="space-y-2">
        {steps.map((s) => (
          <li key={s.n} className="glass-card flex gap-3 p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-sm font-black text-white">{s.n}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-base">{s.icon}</span>
                <h4 className="text-sm font-black text-slate-900">{s.title}</h4>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{s.body}</p>
              {s.param && (
                <div className="mt-1.5 inline-block rounded-md bg-slate-100 px-2 py-0.5 font-mono text-2xs font-bold text-slate-700">{s.param}</div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="text-2xs text-slate-400">
        לבחינת המאגר עצמו: טאב "דפדפן עסקאות" (סינון/מיון/החרגה, כולל "⚠️ חריגים"). לפרמטרים: טאב "חוקי המערכת". דוח מלא: /methodology.
      </p>
    </div>
  );
}
