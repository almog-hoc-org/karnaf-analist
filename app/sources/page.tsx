import Link from "next/link";
import {
  CATEGORIES,
  SOURCES,
  getSourcesByCategory,
  nextExpectedPublication,
  formatScheduleHe,
  type SourceColor,
} from "@/lib/sources";
import { COVERAGE_MATRIX, SOURCE_DOCUMENTS } from "@/lib/source-documents";

export const metadata = {
  title: 'מקורות מידע | קרנף אנליסט',
  description: 'רשימה מלאה של כל המקורות, הדוחות והממשקים בהם השתמשנו',
};

// Unified brand accent — every category renders the same indigo chrome.
const INDIGO_ACCENT = {
  bar: "from-indigo-500 to-indigo-600",
  bg: "bg-indigo-50",
  text: "text-indigo-700",
  hover: "hover:border-indigo-300",
};
const accentClasses: Record<SourceColor, { bar: string; bg: string; text: string; hover: string }> = {
  cyan:    INDIGO_ACCENT,
  emerald: INDIGO_ACCENT,
  amber:   INDIGO_ACCENT,
  purple:  INDIGO_ACCENT,
  rose:    INDIGO_ACCENT,
};

function formatHeDate(d: Date | string | null): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("he-IL", { year: "numeric", month: "short", day: "numeric" });
}

export default function SourcesPage() {
  return (
    <main className="min-h-screen page-wrap py-8">
      <header className="text-center space-y-4 mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-200">
          <p className="text-2xs font-bold tracking-[0.2em] text-indigo-700 uppercase">Data Sources</p>
        </div>
        <h1 className="text-4xl md:text-5xl font-black leading-[0.95] tracking-tighter">
          <span className="text-gradient-hero">מקורות מידע</span>
        </h1>
        <p className="text-slate-600 text-base md:text-lg max-w-2xl mx-auto">
          רשימה מלאה של כל המקורות, הדוחות והממשקים שמשמשים את המערכת — לחיצה על מקור פותחת ריכוז הנתונים
        </p>
        <div className="flex flex-wrap justify-center gap-3 text-sm pt-2">
          <span className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-700 shadow-sm tabular-nums">
            <span className="font-bold text-indigo-700">{SOURCES.length}</span>
            <span className="text-slate-500 mr-1.5">מקורות</span>
          </span>
          <span className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-700 shadow-sm tabular-nums">
            <span className="font-bold text-indigo-700">{CATEGORIES.length}</span>
            <span className="text-slate-500 mr-1.5">קטגוריות</span>
          </span>
        </div>
      </header>

      <div className="space-y-8">
        {CATEGORIES.map((cat) => {
          const a = accentClasses[cat.color];
          const sources = getSourcesByCategory(cat.key);
          return (
            <section key={cat.key}>
              <div className="flex items-start gap-3 mb-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 ${a.bg}`}>
                  {cat.icon}
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">{cat.title}</h2>
                  <p className="text-sm text-slate-600 mt-0.5">{cat.description}</p>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${a.bg} ${a.text}`}>{sources.length}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {sources.map((src) => {
                  const next = nextExpectedPublication(src);
                  const isOverdue = next && next < new Date();
                  const detailHref = `/sources/${src.id}`;
                  return (
                    <Link
                      key={src.id}
                      href={detailHref}
                      className={`glass-card p-4 h-full relative overflow-hidden block group ${a.hover} transition-all duration-200 cursor-pointer`}
                    >
                      <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-l ${a.bar}`} />
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="text-sm font-bold text-slate-900 leading-tight group-hover:text-indigo-700 transition-colors">
                          {src.name}
                        </h3>
                        <span className="flex-shrink-0 text-slate-400 group-hover:text-indigo-600 transition-colors text-sm">←</span>
                      </div>
                      <p className="text-xs text-slate-600 mb-2 leading-relaxed">{src.description}</p>
                      <div className="flex items-start gap-1.5 text-2xs mb-2">
                        <span className={`font-semibold ${a.text} flex-shrink-0`}>נשתמש בו ל:</span>
                        <span className="text-slate-600">{src.usedFor}</span>
                      </div>

                      <div className="border-t border-slate-100 mt-2 pt-2 flex items-center justify-between gap-2 text-2xs">
                        <span className="text-slate-500">
                          קצב פרסום:{" "}
                          <span className="font-semibold text-slate-700">{formatScheduleHe(src.publicationSchedule)}</span>
                        </span>
                        {next && (
                          <span
                            className={`px-1.5 py-0.5 rounded font-semibold ${
                              isOverdue ? "bg-slate-100 text-slate-600 border border-slate-300" : "bg-slate-50 text-slate-600 border border-slate-200"
                            }`}
                            title="פרסום הבא צפוי"
                          >
                            {isOverdue ? "⏰ עיכוב — צפוי " : "📅 צפוי "}
                            {formatHeDate(next)}
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* CBS 10-year coverage matrix */}
      <section className="mt-12">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 bg-indigo-50">
            🗓️
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">כיסוי 10 שנים — 4 סדרות הלמ&quot;ס המרכזיות</h2>
            <p className="text-sm text-slate-600 mt-0.5">
              מטריצת מצב פר שנה לכל אחת מ-4 הסדרות שביקשת לאמת: שינוי במחירי דירות, עסקאות, מחירים ממוצעים, תשומה בבנייה
            </p>
          </div>
        </div>
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-sm" dir="rtl">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className="py-3 px-3 text-right text-xs text-slate-500 font-semibold sticky right-0 bg-slate-50">סדרה</th>
                {Array.from({ length: 11 }, (_, i) => 2016 + i).map((y) => (
                  <th key={y} className="py-3 px-2 text-center text-xs text-slate-500 font-semibold tabular-nums">{y}</th>
                ))}
                <th className="py-3 px-3 text-center text-xs text-slate-500 font-semibold">סה&quot;כ</th>
              </tr>
            </thead>
            <tbody>
              {COVERAGE_MATRIX.map((series) => {
                const total = (SOURCE_DOCUMENTS[series.sourceId] ?? []).length;
                return (
                  <tr key={series.sourceId} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-3 text-right sticky right-0 bg-white">
                      <Link href={`/sources/${series.sourceId}`} className="text-sm font-semibold text-slate-900 hover:text-indigo-700 hover:underline">
                        {series.title}
                      </Link>
                    </td>
                    {series.years.map((c) => {
                      const cls =
                        c.status === "extracted"  ? "bg-emerald-500 text-white" :
                        c.status === "referenced" ? "bg-slate-400 text-white" :
                        c.status === "indexed"    ? "bg-slate-200 text-slate-600" :
                                                    "bg-rose-100 text-rose-400";
                      const title =
                        c.status === "extracted"  ? `${c.count} מסמכים — נתונים נשאבו` :
                        c.status === "referenced" ? `${c.count} מסמכים — כיסוי עיתונאי` :
                        c.status === "indexed"    ? `${c.count} מסמכים — במעקב, טרם נשאבו נתונים` :
                                                    "אין מסמכים";
                      const label = c.status === "missing" ? "–" : c.count;
                      return (
                        <td key={c.year} className="py-2 px-1 text-center">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-xs font-bold tabular-nums ${cls}`} title={title}>
                            {label}
                          </span>
                        </td>
                      );
                    })}
                    <td className="py-3 px-3 text-center text-sm font-bold text-slate-700 tabular-nums">{total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-3 text-2xs text-slate-500 bg-slate-50/60 border-t border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-semibold text-slate-700">מקרא:</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded bg-emerald-500"></span> נתונים נשאבו
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded bg-slate-400"></span> כיסוי עיתונאי שצוטט
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded bg-slate-200"></span> במעקב — קישור לפרסום קיים
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded bg-rose-100 border border-rose-200"></span> חסר
            </span>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-3 leading-relaxed">
          המספר בכל תא = מספר המסמכים שמשתייכים לאותה שנה (חודשי = עד 12, רבעוני = עד 4).
          תא ירוק = שאבנו מספרים ישירות מהפרסום; אפור כהה = יש כיסוי עיתונאי לפרסום שצוטט;
          אפור בהיר = ה-URL הקאנוני של הפרסום נרשם במעקב לסקירה עתידית;
          ורוד = אין מסמך לאותה שנה.
        </p>
      </section>

      <div className="mt-12 p-6 rounded-2xl bg-slate-50 border border-slate-200">
        <h3 className="text-base font-bold text-slate-900 mb-2">📋 מתודולוגיה</h3>
        <ul className="text-sm text-slate-700 space-y-1.5 list-disc pr-5">
          <li><strong>אוכלוסייה:</strong> נתוני בסיס מהמפקד הרשמי של למ&quot;ס 2022; תחזיות 2024-2026 מחושבות מקצב הצמיחה השנתי הממוצע</li>
          <li><strong>מחירים:</strong> חציון רבעוני מ-nadlan.gov.il; מחיר למ&quot;ר מוערך מ-75 מ&quot;ר ממוצע לדירה כאשר לא קיים נתון ישיר</li>
          <li><strong>בנייה:</strong> נתוני התחלות והיתרים ישירות מדוחות למ&quot;ס; גמרי בנייה מנתוני לחץ של למ&quot;ס</li>
          <li><strong>השוואת עסקאות שכונות:</strong> כל העסקאות מ-govmap.gov.il (אותו מאגר של רשות המסים), עם סינון חריגים של ±2 ס.ת.</li>
          <li><strong>פערים ושדות חסרים:</strong> תאים ריקים מוצגים כ-&ldquo;—&rdquo; ולא ממולאים בנתונים מומצאים</li>
          <li><strong>ניטור אוטומטי:</strong> סקריפט המנטר את עמודי הפרסום של למ&quot;ס וכלכלן ראשי, מזהה דוחות חדשים ושולח התראות</li>
        </ul>
      </div>

    </main>
  );
}
