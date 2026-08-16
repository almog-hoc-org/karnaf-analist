import Icon from "@/components/Icon";
import SourceBadge from "@/components/SourceBadge";
import type { DwellingRow } from "@/lib/dwellings";

/**
 * Dwelling stock and how densely it is occupied.
 *
 * THE ONE THING THIS CARD MUST NOT LET A READER BELIEVE
 * that 2.11 in Tel Aviv means Tel Aviv families have two people in them. The
 * denominator is every dwelling in the city — empty ones, investment flats,
 * holiday apartments — so a low number means "a lot of homes per resident",
 * which in Tel Aviv is a statement about second homes and one-person
 * households, not about family size. The card says so in a sentence rather
 * than leaving the reader to assume the obvious wrong thing.
 *
 * Both benchmarks are shown because they answer different questions: the
 * national ratio is the headline everyone quotes, and the 50k-plus ratio is
 * the fair peer group for a city that is itself in that list.
 */
export default function DwellingStockCard({
  cityName, row, national, bigCity, rank, provenance,
}: {
  cityName: string;
  row: DwellingRow;
  national: number | null;
  bigCity: number | null;
  rank: { rank: number; of: number } | null;
  provenance: string;
}) {
  const vsNational = national ? ((row.ratio / national - 1) * 100) : null;
  const denser = national != null && row.ratio > national;

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-xl text-white shadow">
          <Icon name="building" size="1em" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-extrabold leading-tight text-slate-900 sm:text-2xl">
            מלאי הדירות ב{cityName}
          </h2>
          <p className="mt-1 text-xs text-slate-500">{provenance}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-2xs font-bold uppercase tracking-wide text-slate-400">דירות בעיר</p>
          <p className="mt-1 text-3xl font-black tabular-nums text-slate-900">
            {row.dwellings.toLocaleString("he-IL")}
          </p>
          <p className="mt-1 text-2xs text-slate-500">סך הדירות ביישוב</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-2xs font-bold uppercase tracking-wide text-slate-400">תושבים</p>
          <p className="mt-1 text-3xl font-black tabular-nums text-slate-900">
            {row.population.toLocaleString("he-IL")}
          </p>
          <p className="mt-1 text-2xs text-slate-500">האוכלוסייה שממנה חושב היחס</p>
        </div>

        <div className={`rounded-2xl border p-4 ${denser ? "border-amber-200 bg-amber-50/60" : "border-emerald-200 bg-emerald-50/60"}`}>
          <p className="text-2xs font-bold uppercase tracking-wide text-slate-500">נפשות לדירה</p>
          <p className="mt-1 text-3xl font-black tabular-nums text-slate-900">{row.ratio.toFixed(2)}</p>
          <p className="mt-1 text-2xs text-slate-600">
            {vsNational != null && (
              <>{vsNational >= 0 ? "+" : ""}{vsNational.toFixed(0)}% מול הממוצע הארצי</>
            )}
            {rank && <> · מקום {rank.rank} מתוך {rank.of}</>}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
        <p className="text-sm leading-relaxed text-slate-700">
          על כל דירה ב{cityName} יש <b>{row.ratio.toFixed(2)}</b> תושבים, לעומת{" "}
          <b>{national?.toFixed(2) ?? "—"}</b> בממוצע הארצי
          {bigCity != null && <> ו-<b>{bigCity.toFixed(2)}</b> בממוצע הערים מעל 50 אלף תושבים</>}.
          {denser
            ? " ככל שהמספר גבוה יותר, כך מלאי הדיור בעיר צפוף יותר ביחס לאוכלוסייה."
            : " מספר נמוך מעיד על מלאי דיור רחב יחסית לאוכלוסייה."}
        </p>
        <p className="mt-2 text-2xs leading-relaxed text-slate-500">
          <Icon name="warning" size="1em" /> <b>זה אינו גודל משק בית.</b> המכנה הוא כל הדירות ביישוב —
          כולל דירות ריקות, דירות להשקעה ודירות נופש. לכן ערים עם הרבה דירות שאינן דירת מגורים
          ראשית מציגות מספר נמוך, גם כשגודל המשפחה בהן דומה לממוצע.
        </p>
        <div className="mt-2"><SourceBadge kind="external" /></div>
      </div>
    </section>
  );
}
