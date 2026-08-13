import { withBasePath } from "@/lib/basePath";
import BrandMark from "./BrandMark";
import CourseBanner from "./CourseBanner";

export default function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white/60">
      {/* mobile pb-24: clearance so the floating refresh button never sits on the links */}
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-2 px-4 py-8 pb-24 text-center md:px-6 md:pb-8">
        <div className="flex items-center gap-2">
          <BrandMark size={26} />
          <span className="text-sm font-bold text-slate-800">
            קרנף אנליסט — מחקר שוק הדיור בישראל
          </span>
        </div>
        <p className="text-xs text-slate-500">
          הנתונים מבוססים על מקורות רשמיים: רשות המסים (נדל״ן), הלמ״ס, data.gov.il ומאגר העסקאות הפנימי במערכת.
        </p>
        <p className="text-2xs text-slate-400">
          כלי מחקר · אינו מהווה ייעוץ השקעות · <a href={withBasePath("/methodology")} className="font-bold text-indigo-600 hover:underline">איך המספרים מחושבים ←</a>
        </p>
        {/* Site navigation — "מקורות" lives HERE, not in the top bar (operator
            spec 8/2026): reference material earns a footer slot, daily
            destinations earn the header. */}
        <nav aria-label="ניווט תחתון" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs font-semibold text-slate-500">
          <a href={withBasePath("/cities")} className="hover:text-indigo-600 hover:underline">ערים</a>
          <span aria-hidden>·</span>
          <a href={withBasePath("/compare")} className="hover:text-indigo-600 hover:underline">השוואה</a>
          <span aria-hidden>·</span>
          <a href={withBasePath("/national")} className="hover:text-indigo-600 hover:underline">ארצי</a>
          <span aria-hidden>·</span>
          <a href={withBasePath("/calculators")} className="hover:text-indigo-600 hover:underline">מחשבונים</a>
          <span aria-hidden>·</span>
          <a href={withBasePath("/sources")} className="hover:text-indigo-600 hover:underline">מקורות הנתונים</a>
          <span aria-hidden>·</span>
          <a href={withBasePath("/deals")} className="hover:text-indigo-600 hover:underline">העסקאות שלי</a>
        </nav>
        {/* Course + WhatsApp, compact. On every page but below everything —
            see the note in CourseBanner on why this never sits above the data. */}
        <div className="mt-2 border-t border-slate-100 pt-3">
          <CourseBanner compact />
        </div>
        {/* Required notices. A privacy policy that exists but is not reachable
            from every page is not a notice — this footer is on every page. */}
        <nav aria-label="מידע משפטי" className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-2xs text-slate-400">
          <a href={withBasePath("/privacy")} className="hover:text-indigo-600 hover:underline">מדיניות פרטיות</a>
          <span aria-hidden>·</span>
          <a href={withBasePath("/terms")} className="hover:text-indigo-600 hover:underline">תנאי שימוש</a>
          <span aria-hidden>·</span>
          <a href={withBasePath("/accessibility")} className="hover:text-indigo-600 hover:underline">הצהרת נגישות</a>
        </nav>
      </div>
    </footer>
  );
}
