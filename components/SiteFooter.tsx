export default function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white/60">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-2 px-4 py-8 text-center md:px-6">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-600 text-[11px] font-black text-white">
            ק
          </span>
          <span className="text-sm font-bold text-slate-800">
            קרנף אנליסט — מחקר שוק הדיור בישראל
          </span>
        </div>
        <p className="text-xs text-slate-500">
          הנתונים מבוססים על מקורות רשמיים: רשות המסים (נדל״ן), הלמ״ס, data.gov.il ומאגר העסקאות הפנימי במערכת.
        </p>
        <p className="text-[11px] text-slate-400">
          כלי מחקר פנימי · אינו מהווה ייעוץ השקעות
        </p>
      </div>
    </footer>
  );
}
