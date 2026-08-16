import Link from "next/link";
import Icon from "@/components/Icon";

/**
 * Branded 404.
 *
 * Until this file existed, a mistyped city name — the single most likely wrong
 * URL on a site whose paths are Hebrew city names — rendered Next's stock
 * black-and-white "404 | This page could not be found", in English, LTR, with
 * no way back. The recovery links matter more than the apology: someone who
 * lands here was looking for a city, so hand them the search.
 */
export const metadata = { title: "הדף לא נמצא · קרנף אנליסט" };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-4 text-center">
      <p className="text-5xl" aria-hidden><Icon name="search" size="1em" /></p>
      <h1 className="mt-4 text-2xl font-black text-slate-900">הדף לא נמצא</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        ייתכן שהקישור ישן, או ששם העיר נכתב אחרת. אפשר לחפש עיר מהעמוד הראשי,
        או לעבור לטבלת כל הערים.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link href="/" className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700">
          לעמוד הראשי
        </Link>
        <Link href="/cities" className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">
          כל הערים
        </Link>
        <Link href="/methodology" className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">
          איך מחושבים הנתונים
        </Link>
      </div>
    </main>
  );
}
