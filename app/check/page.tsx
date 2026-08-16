import Link from "next/link";
import { prisma } from "@/lib/db";
import Icon from "@/components/Icon";
import { computeStreetComp, compMatchNote } from "@/lib/streetComps";
import { rowAddress } from "@/lib/compTypes";
import { whatsappShareUrl } from "@/lib/share";
import { getCurrentUser } from "@/lib/auth";
import CheckForm from "@/components/CheckForm";

/**
 * "בדיקת מחיר" — is this apartment priced above or below its own street?
 *
 * WHY THIS PAGE EXISTS
 * The comparison engine (lib/streetComps) has been in this codebase for months,
 * with a twelve-rung ladder that widens from street→neighbourhood→city and from
 * exact-size→±20%→same-rooms→any, reporting at every step WHICH rung it landed
 * on. It was reachable only from inside the private /deals workspace. The single
 * most shareable thing this dataset can produce — a verdict on a specific
 * apartment, with the comparable deals underneath it — was behind a login.
 *
 * The verdict and its evidence are public here on purpose. The URL carries the
 * whole query, so a result is a link someone can send; the deeper city analysis
 * stays behind the wall, which is where the paid value actually lives.
 *
 * The rung is always stated. "12% above the market" computed from four
 * city-wide deals of any size is a different claim from the same number
 * computed from eleven deals on the same street, and the page says which.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "בדיקת מחיר דירה — האם המחיר גבוה או נמוך מהשוק?",
  description:
    "הזינו עיר, רחוב, גודל ומחיר מבוקש — וקבלו השוואה לעסקאות אמת שנסגרו באותו רחוב ובאותו גודל, מדיווחי רשות המסים. ללא הרשמה.",
  alternates: { canonical: "/check" },
};

interface Props {
  searchParams?: {
    city?: string; street?: string; neighborhood?: string;
    rooms?: string; size?: string; price?: string;
  };
}

const num = (v: string | undefined): number | null => {
  if (!v) return null;
  const n = Number(String(v).replace(/[,\s₪]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export default async function CheckPage({ searchParams }: Props) {
  const cities = (await prisma.city.findMany({ select: { city_name: true }, orderBy: { city_name: "asc" } }))
    .map((c) => c.city_name);

  const city = (searchParams?.city ?? "").trim();
  const street = (searchParams?.street ?? "").trim();
  const neighborhood = (searchParams?.neighborhood ?? "").trim();
  const rooms = num(searchParams?.rooms);
  const size = num(searchParams?.size);
  const price = num(searchParams?.price);

  // A city we do not hold is not a "no comparable deals" answer — it is a
  // different answer, and conflating them would tell someone their price is
  // unverifiable when in fact we never had their town.
  const knownCity = city ? cities.includes(city) : false;
  const comp = knownCity ? await computeStreetComp(city, street || null, neighborhood || null, rooms, size) : null;

  const askSqm = price && size ? price / size : null;
  const deltaPct = comp?.medianSqm && askSqm ? (askSqm / comp.medianSqm - 1) * 100 : null;

  const verdict = (() => {
    if (deltaPct == null) return null;
    const abs = Math.abs(deltaPct);
    if (abs < 5) return { text: "בטווח השוק", tone: "bg-slate-100 text-slate-700 border-slate-200" };
    if (deltaPct > 0)
      return {
        text: `${abs.toFixed(0)}% מעל השוק`,
        tone: abs >= 15 ? "bg-rose-100 text-rose-800 border-rose-200" : "bg-amber-100 text-amber-800 border-amber-200",
      };
    return {
      text: `${abs.toFixed(0)}% מתחת לשוק`,
      tone: abs >= 15 ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-teal-100 text-teal-800 border-teal-200",
    };
  })();

  const nis = (v: number | null) => (v == null ? "—" : `₪${Math.round(v).toLocaleString("he-IL")}`);
  const viewer = getCurrentUser();
  const selfPath = `/check?${new URLSearchParams(
    Object.entries({ city, street, neighborhood, rooms: rooms ?? "", size: size ?? "", price: price ?? "" })
      .filter(([, v]) => v !== "" && v != null)
      .map(([k, v]) => [k, String(v)])
  ).toString()}`;

  return (
    <main className="page-wrap min-h-screen py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-black leading-tight text-slate-900 sm:text-4xl">בדיקת מחיר דירה</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
          מבקשים עליכם מחיר — והשאלה היחידה שחשובה היא במה נסגרו דירות דומות באותו רחוב.
          כאן זה נבדק מול עסקאות אמת שדווחו לרשות המסים, בלי הרשמה.
        </p>
      </header>

      <CheckForm
        cities={cities}
        initial={{ city, street, neighborhood, rooms: searchParams?.rooms ?? "", size: searchParams?.size ?? "", price: searchParams?.price ?? "" }}
      />

      {city && !knownCity && (
        <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          אין לנו עדיין מאגר עסקאות עבור &ldquo;{city}&rdquo;. בחרו יישוב מהרשימה — היא כוללת {cities.length} יישובים.
        </p>
      )}

      {comp && (
        <section className="mt-6">
          <div className="glass-card p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <h2 className="text-xl font-extrabold text-slate-900">
                {street ? `${street}, ${city}` : city}
              </h2>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-2xs font-bold text-slate-500">
                {compMatchNote(comp)} · {comp.n.toLocaleString("he-IL")} עסקאות · {comp.years} שנים
              </span>
            </div>

            {comp.n === 0 ? (
              <p className="mt-3 text-sm text-slate-600">{comp.label}</p>
            ) : (
              <>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <div>
                    <div className="text-2xs font-bold uppercase tracking-wide text-slate-400">חציון השוואה</div>
                    <div className="text-2xl font-black tabular-nums text-slate-900">{nis(comp.medianSqm)}</div>
                    <div className="text-2xs text-slate-500">₪ למ״ר</div>
                  </div>
                  {askSqm && (
                    <div>
                      <div className="text-2xs font-bold uppercase tracking-wide text-slate-400">המחיר שנבדק</div>
                      <div className="text-2xl font-black tabular-nums text-slate-900">{nis(askSqm)}</div>
                      <div className="text-2xs text-slate-500">₪ למ״ר · {nis(price)} ל-{size} מ״ר</div>
                    </div>
                  )}
                  {verdict && (
                    <div>
                      <div className="text-2xs font-bold uppercase tracking-wide text-slate-400">פסק דין</div>
                      <div className={`mt-1 inline-block rounded-xl border px-3 py-1.5 text-lg font-black ${verdict.tone}`}>
                        {verdict.text}
                      </div>
                    </div>
                  )}
                </div>

                {!askSqm && (
                  <p className="mt-3 text-sm text-slate-500">
                    הוסיפו גודל במ״ר ומחיר מבוקש כדי לקבל פסק דין, ולא רק את רמת המחירים באזור.
                  </p>
                )}

                <p className="mt-4 text-2xs leading-relaxed text-slate-500">
                  {comp.label}
                  {comp.areaRange && ` · טווח שטח בהשוואה: ${comp.areaRange[0]}–${comp.areaRange[1]} מ״ר`}
                </p>

                {comp.recent.length > 0 && (
                  <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[520px] text-2xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-right font-bold">תאריך</th>
                          <th scope="col" className="px-3 py-2 text-right font-bold">כתובת</th>
                          <th scope="col" className="px-3 py-2 text-right font-bold">חד׳</th>
                          <th scope="col" className="px-3 py-2 text-right font-bold">מ״ר</th>
                          <th scope="col" className="px-3 py-2 text-right font-bold">מחיר</th>
                          <th scope="col" className="px-3 py-2 text-right font-bold">₪/מ״ר</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comp.recent.slice(0, 8).map((d, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{d.deal_date}</td>
                            <td className="px-3 py-1.5 text-right">{rowAddress(d) ?? "—"}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{d.rooms ?? "—"}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{d.area ?? "—"}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{nis(d.price)}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-right font-bold tabular-nums">{nis(d.price_sqm)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <a
                    href={whatsappShareUrl(
                      selfPath,
                      viewer?.id,
                      verdict ? `בדקתי מחיר דירה ב${city} — ${verdict.text}:` : `רמת המחירים ב${city} לפי עסקאות אמת:`
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-700"
                  >
                    <Icon name="chat" size="1em" /> שיתוף בוואטסאפ
                  </a>
                  <Link
                    href={`/city/${encodeURIComponent(city)}`}
                    className="text-sm font-bold text-indigo-700 hover:underline"
                  >
                    כל הנתונים על {city} →
                  </Link>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      <p className="mt-8 max-w-3xl text-2xs leading-relaxed text-slate-400">
        <Icon name="source-own" size="1em" /> ההשוואה מבוססת על עסקאות שדווחו לרשות המסים, נאספו ונוקו במאגר שלנו.
        המערכת מרחיבה את החיפוש בשלבים — רחוב ← שכונה ← יישוב, וגודל מדויק ← ±20% ← אותו מספר חדרים —
        ותמיד מציינת באיזה שלב נעצרה. זו אינה הערכת שמאי ואינה ייעוץ.
        {" "}<Link href="/methodology" className="underline hover:text-indigo-700">מתודולוגיה →</Link>
      </p>
    </main>
  );
}
