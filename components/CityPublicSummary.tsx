import Link from "next/link";
import Icon from "@/components/Icon";

/**
 * The PUBLIC half of a city page: real numbers, visible to everyone including
 * Googlebot, with the depth still behind the wall.
 *
 * WHY THIS EXISTS
 * The wall was total — 167 of 168 city pages served a ~40-word registration
 * interstitial to any visitor without a session. Googlebot has no session, so
 * Google's index of this site was 167 near-identical signup screens and one
 * real city page. A site whose entire long tail is "מחירי דירות ב-X" cannot
 * rank on those queries while the answer is invisible to the crawler.
 *
 * The split is chosen so the free half is genuinely useful and the paid half
 * is genuinely worth paying for:
 *   free  — the headline price, the trend, the sample size, and how it compares
 *           nationally: enough to answer "what does an apartment cost here?"
 *   paid  — the chart studio, per-room and per-neighborhood breakdowns, the
 *           deal-level drill-down, comparisons, supply/demand, insights.
 *
 * Every number here is already computed for other surfaces, so the public half
 * costs nothing new to render.
 */
export interface CityPublicSummaryData {
  cityName: string;
  /** ₪/m², the site's price axis */
  sqm: number | null;
  /** the year those prices are quoted for */
  priceYear: number | null;
  /** deals behind the quoted year */
  n: number | null;
  /** headline change window */
  changePct: number | null;
  changeFromYear: number | null;
  changeToYear: number | null;
  population: number | null;
  /** national median ₪/m², for context */
  nationalSqm: number | null;
}

const fmt = (n: number) => Math.round(n).toLocaleString("he-IL");

export default function CityPublicSummary({
  data,
  children,
}: {
  data: CityPublicSummaryData;
  /** the wall CTA — rendered under the free numbers */
  children: React.ReactNode;
}) {
  const { cityName, sqm, priceYear, n, changePct, changeFromYear, changeToYear, population, nationalSqm } = data;
  const up = (changePct ?? 0) >= 0;
  const vsNational =
    sqm && nationalSqm ? ((sqm / nationalSqm - 1) * 100) : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      {/* The h1 is the query. It used to be the bare city name on a locked
          screen; now it says what the page answers. */}
      <h1 className="text-3xl font-black leading-tight text-slate-900">
        מחירי דירות ב{cityName}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        {sqm && priceYear ? (
          <>
            מחיר ממוצע למ״ר ב{cityName} עומד על <b>₪{fmt(sqm)}</b> לפי עסקאות {priceYear}
            {n ? <> ({fmt(n)} עסקאות)</> : null}
            {changePct !== null && changeFromYear && changeToYear ? (
              <>, {up ? "עלייה" : "ירידה"} של <b>{Math.abs(changePct).toFixed(1)}%</b> בין {changeFromYear} ל-{changeToYear}</>
            ) : null}
            {vsNational !== null ? (
              <> — {Math.abs(vsNational) < 3 ? "בקו עם" : vsNational > 0 ? `${Math.abs(vsNational).toFixed(0)}% מעל` : `${Math.abs(vsNational).toFixed(0)}% מתחת ל`}הממוצע הארצי</>
            ) : null}
            .
          </>
        ) : (
          <>הנתונים ל{cityName} נאספים ממאגר עסקאות רשות המסים ומפרסומי הלמ״ס.</>
        )}
      </p>

      {/* Free KPI strip */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="glass-card p-4">
          <p className="stat-label mb-1">מחיר למ״ר</p>
          <p className="text-xl font-black text-slate-900 tabular-nums">{sqm ? `₪${fmt(sqm)}` : "—"}</p>
          {priceYear && <p className="mt-0.5 text-2xs text-slate-400">{priceYear}</p>}
        </div>
        <div className="glass-card p-4">
          <p className="stat-label mb-1">שינוי מחיר</p>
          <p className={`text-xl font-black tabular-nums ${changePct === null ? "text-slate-900" : up ? "text-emerald-700" : "text-red-600"}`}>
            {changePct === null ? "—" : `${up ? "+" : "−"}${Math.abs(changePct).toFixed(1)}%`}
          </p>
          {changeFromYear && changeToYear && (
            <p className="mt-0.5 text-2xs text-slate-400">{changeFromYear}–{changeToYear}</p>
          )}
        </div>
        <div className="glass-card p-4">
          <p className="stat-label mb-1">עסקאות בשנה</p>
          <p className="text-xl font-black text-slate-900 tabular-nums">{n ? fmt(n) : "—"}</p>
          <p className="mt-0.5 text-2xs text-slate-400">מדגם</p>
        </div>
        <div className="glass-card p-4">
          <p className="stat-label mb-1">אוכלוסייה</p>
          <p className="text-xl font-black text-slate-900 tabular-nums">{population ? fmt(population) : "—"}</p>
          <p className="mt-0.5 text-2xs text-slate-400">תושבים</p>
        </div>
      </div>

      <p className="mt-4 text-2xs leading-relaxed text-slate-500">
        <Icon name="check" size="1em" /> המחירים מחושבים מעסקאות שדווחו לרשות המסים, אחרי ניקוי כפילויות,
        חריגי מחיר ועסקאות יוקרה. <Link href="/methodology" className="font-bold text-indigo-700 hover:underline">איך זה מחושב</Link>
      </p>

      {/* What's behind the wall — and the CTA */}
      <div className="mt-8">{children}</div>
    </main>
  );
}
