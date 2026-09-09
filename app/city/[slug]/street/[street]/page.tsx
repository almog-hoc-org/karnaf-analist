import Link from "next/link";
import { ADDRESS_COVERAGE_NOTE } from "@/lib/addressCoverage";
import { redirect } from "next/navigation";
import Icon from "@/components/Icon";
import TrendValue from "@/components/TrendValue";
import AreaMap from "@/components/AreaMap";
import AddressDealsTable from "@/components/AddressDealsTable";
import { canonicalCityName } from "@/lib/cityAliases";
import { gateAreaPage } from "@/lib/areaPageGate";
import { loadStreetPage } from "@/lib/addressPages";
import { buildCityMap, loadCityMapGeometry } from "@/lib/cityMap";
import { neighborhoodSummary } from "@/lib/neighborhoods";
import { addressSlug } from "@/lib/buildingRules";

/**
 * One street: every building on it, every year, and where it sits.
 *
 * WHY A STREET PAGE. "מחירי דירות ברחוב X" is what people search when they
 * are looking at one listing, and the neighbourhood page answers a broader
 * question than they asked. This page is built from addresses alone — the
 * Tax Authority's street and house number — so it exists for every street
 * with deals, whether or not the map's geocodes have reached it.
 *
 * SPELLING: the URL accepts any spelling the deals carry ("שד' רוטשילד",
 * "שדרות רוטשילד") and redirects to the most common one — one address per
 * page, exactly like the city aliases and the neighbourhood pages.
 */
export const dynamic = "force-dynamic";

interface PageProps { params: { slug: string; street: string } }

export async function generateMetadata({ params }: PageProps) {
  const cityName = decodeURIComponent(params.slug);
  const street = decodeURIComponent(params.street);
  const title = `מחירי דירות ברחוב ${street}, ${cityName} — כל העסקאות לפי בניין`;
  const description = `כמה עולה דירה ברחוב ${street} ב${cityName}? מחיר למ״ר לפי שנה, כל הבניינים ברחוב עם מספר העסקאות בכל אחד, והשוואה לשכונה ולעיר — מעסקאות אמת שדווחו לרשות המסים.`;
  const path = `/city/${encodeURIComponent(cityName)}/street/${encodeURIComponent(street)}`;
  return { title, description, alternates: { canonical: path }, openGraph: { title, description, type: "article", locale: "he_IL", url: path } };
}

export default async function StreetPage({ params }: PageProps) {
  const requestedCity = decodeURIComponent(params.slug);
  const cityName = canonicalCityName(requestedCity);
  const requested = decodeURIComponent(params.street);
  gateAreaPage(cityName, "street_pages_public");

  const data = await loadStreetPage(cityName, requested);
  if (!data) {
    return (
      <main className="page-wrap py-16 text-center">
        <div className="glass-card mx-auto max-w-xl p-8">
          <h1 className="text-2xl font-black text-slate-900">{requested}</h1>
          <p className="mt-3 text-sm text-slate-600">אין במאגר עסקאות עם כתובת ברחוב הזה ב{cityName}. חלק מהעסקאות מדווחות לרשות המסים ללא רחוב.</p>
          <Link href={`/city/${encodeURIComponent(cityName)}`} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100">← חזרה ל{cityName}</Link>
        </div>
      </main>
    );
  }
  if (data.street !== requested || cityName !== requestedCity) {
    redirect(`/city/${encodeURIComponent(cityName)}/street/${encodeURIComponent(data.street)}`);
  }

  const [geometry, summary] = await Promise.all([
    loadCityMapGeometry(cityName),
    neighborhoodSummary(cityName, { scope: "secondhand", years: 3 }),
  ]);
  const hasMap = buildCityMap(geometry, summary.rows) !== null;

  const nis = (v: number | null) => (v == null ? "—" : `₪${Math.round(v).toLocaleString("he-IL")}`);
  const cityHref = `/city/${encodeURIComponent(cityName)}`;
  const hoodHref = data.hood ? `${cityHref}/neighborhood/${encodeURIComponent(data.hood)}` : null;
  const stats = data.yearStatsSh.filter((y) => y.n > 0);

  return (
    <main className="page-wrap py-8">
      <header className="mb-6">
        <nav className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
          <Link href={cityHref} className="hover:text-indigo-700">{cityName}</Link>
          {hoodHref && data.hood && (<><span className="text-slate-300">/</span><Link href={hoodHref} className="hover:text-indigo-700">{data.hood}</Link></>)}
          <span className="text-slate-300">/</span>
          <span className="font-bold text-slate-800">{data.street}</span>
        </nav>
        <h1 className="text-2xl font-black leading-tight text-slate-900 sm:text-3xl">
          מחירי דירות ברחוב {data.street}
          <span className="font-bold text-slate-400"> · {cityName}</span>
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          {data.total.toLocaleString("he-IL")} עסקאות שדווחו לרשות המסים{data.years ? ` · ${data.years[0]}–${data.years[1]}` : ""}
          {data.hood ? ` · ${Math.round((data.hoodShare ?? 0) * 100)}% מהן בשכונת ${data.hood}` : ""}
          {data.spellings.length > 1 ? ` · מאוחד מ-${data.spellings.length} איותים` : ""}
        </p>
        <p className="mt-1 text-2xs leading-relaxed text-slate-400">{ADDRESS_COVERAGE_NOTE}</p>
      </header>

      {/* ── headline ── */}
      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card label={`₪ למ״ר · יד שנייה${data.refYear ? ` · ${data.refYear}` : ""}`} value={nis(data.sqm)} />
        <Card label={data.hood ? `מול שכונת ${data.hood}` : "מול השכונה"} value={data.vsHoodPct == null ? "—" : <TrendValue pct={data.vsHoodPct} />} hint="חציון הרחוב לעומת חציון השכונה באותה שנה" />
        <Card label={`מול ${cityName}`} value={data.vsCityPct == null ? "—" : <TrendValue pct={data.vsCityPct} />} hint="חציון הרחוב לעומת ממוצע העיר בשכונות המתומחרות" />
      </section>

      <div className={hasMap ? "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]" : ""}>
        <div>
          {/* ── by year ── */}
          <section className="mb-8">
            <div className="section-header">
              <div className="section-header-icon"><Icon name="chart" size="1em" /></div>
              <div><h2>לפי שנה</h2><p>עסקאות יד שנייה ברחוב · חציון ₪ למ״ר וחציון מחיר</p></div>
            </div>
            {stats.length ? (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-slate-200 bg-slate-50 text-2xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 text-right font-bold">שנה</th><th className="px-3 py-2 text-center font-bold">עסקאות</th>
                    <th className="px-3 py-2 text-center font-bold">₪ למ״ר</th><th className="px-3 py-2 text-center font-bold">מחיר חציוני</th>
                  </tr></thead>
                  <tbody>{[...stats].reverse().map((y) => (
                    <tr key={y.year} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-1.5 text-right font-bold tabular-nums">{y.year}</td>
                      <td className="px-3 py-1.5 text-center tabular-nums">{y.n}</td>
                      <td className="px-3 py-1.5 text-center font-bold tabular-nums">{nis(y.medianSqm)}</td>
                      <td className="px-3 py-1.5 text-center tabular-nums">{nis(y.medianPrice)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="text-sm text-slate-500">אין עסקאות יד שנייה ברחוב הזה.</p>}
          </section>

          {/* ── buildings ── */}
          <section className="mb-8">
            <div className="section-header">
              <div className="section-header-icon"><Icon name="building" size="1em" /></div>
              <div><h2>הבניינים ברחוב</h2><p>{data.buildings.length} בניינים עם מספר בית · לחיצה פותחת את היסטוריית הבניין</p></div>
            </div>
            {data.addressCoverage < 0.8 && (
              <p className="mb-3 text-2xs text-slate-500">{Math.round((1 - data.addressCoverage) * 100)}% מעסקאות הרחוב דווחו ללא מספר בית ואינן משויכות לבניין.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {data.buildings.map((b) => (
                <Link key={b.house} href={`${cityHref}/address/${encodeURIComponent(addressSlug(data.street, b.label))}`}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs hover:border-indigo-300 hover:bg-indigo-50">
                  <span className="font-extrabold text-slate-900">{data.street} {b.label}</span>
                  <span className="block text-2xs text-slate-500">{b.n} עסקאות{b.medianSqm ? ` · ${nis(b.medianSqm)}/מ״ר` : ""}{b.yearBuilt ? ` · נבנה ${b.yearBuilt}` : ""}</span>
                </Link>
              ))}
            </div>
          </section>

          {/* ── recent ── */}
          <section className="mb-8">
            <div className="section-header">
              <div className="section-header-icon"><Icon name="document" size="1em" /></div>
              <div><h2>העסקאות האחרונות</h2><p>{Math.min(15, data.recent.length)} מתוך {data.total.toLocaleString("he-IL")}</p></div>
            </div>
            <AddressDealsTable deals={data.recent} cityName={cityName} street={data.street} />
          </section>
        </div>
        {hasMap && (
          <aside>
            <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-slate-500">על המפה</h2>
            <AreaMap cityName={cityName} hood={data.hood} street={data.street} hasMap={hasMap} />
          </aside>
        )}
      </div>

      <p className="text-2xs leading-relaxed text-slate-400">
        <Icon name="source-own" size="1em" /> מחושב מהעסקאות שנאספו ונוקו — הכתובת כפי שדווחה לרשות המסים. עסקאות יוקרה נספרות ואינן קובעות חציון.
        {" "}<Link href="/methodology" className="underline hover:text-indigo-700">מתודולוגיה →</Link>
      </p>
    </main>
  );
}

function Card({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="kpi-card">
      <div className="text-2xs font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="stat-value mt-1 text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-2xs text-slate-500">{hint}</div>}
    </div>
  );
}
