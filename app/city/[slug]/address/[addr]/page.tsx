import Link from "next/link";
import { ADDRESS_COVERAGE_NOTE } from "@/lib/addressCoverage";
import { redirect } from "next/navigation";
import Icon from "@/components/Icon";
import TrendValue from "@/components/TrendValue";
import AreaMap from "@/components/AreaMap";
import { canonicalCityName } from "@/lib/cityAliases";
import { gateAreaPage } from "@/lib/areaPageGate";
import { loadBuildingPage } from "@/lib/addressPages";
import { buildCityMap, loadCityMapGeometry } from "@/lib/cityMap";
import { neighborhoodSummary } from "@/lib/neighborhoods";
import { addressSlug, parseAddressSlug } from "@/lib/buildingRules";

/**
 * One building: every deal ever reported at this address, the flats that
 * sold more than once, and whether it was a developer's project.
 *
 * THIS IS THE PAGE THE NUMBERS ARE FOR. A neighbourhood's ₪/m² is a claim; a
 * list of what the flats in THIS building sold for, with floors and dates,
 * is evidence anyone can check against the listing in their hand. It needs
 * no coordinates — only the address the Tax Authority reported — so it
 * exists wherever the address campaign has reached.
 *
 * The URL is one segment, "street number" (lib/buildingRules.parseAddressSlug).
 */
export const dynamic = "force-dynamic";

interface PageProps { params: { slug: string; addr: string } }

export async function generateMetadata({ params }: PageProps) {
  const cityName = decodeURIComponent(params.slug);
  const addr = decodeURIComponent(params.addr);
  const title = `${addr}, ${cityName} — היסטוריית העסקאות בבניין`;
  const description = `כל העסקאות שדווחו לרשות המסים בכתובת ${addr}, ${cityName}: קומות, גדלים, מחירים ומחיר למ״ר לאורך השנים, דירות שנמכרו יותר מפעם אחת, והשוואה לשכונה.`;
  const path = `/city/${encodeURIComponent(cityName)}/address/${encodeURIComponent(addr)}`;
  return { title, description, alternates: { canonical: path }, openGraph: { title, description, type: "article", locale: "he_IL", url: path } };
}

export default async function AddressPage({ params }: PageProps) {
  const requestedCity = decodeURIComponent(params.slug);
  const cityName = canonicalCityName(requestedCity);
  const addr = decodeURIComponent(params.addr);
  gateAreaPage(cityName, "street_pages_public");

  const parsed = parseAddressSlug(addr);
  const data = parsed ? await loadBuildingPage(cityName, parsed.street, parsed.house) : null;
  const cityHref = `/city/${encodeURIComponent(cityName)}`;
  if (!parsed || !data) {
    return (
      <main className="page-wrap py-16 text-center">
        <div className="glass-card mx-auto max-w-xl p-8">
          <h1 className="text-2xl font-black text-slate-900">{addr}</h1>
          <p className="mt-3 text-sm text-slate-600">
            {parsed ? `אין במאגר עסקאות בכתובת הזו ב${cityName}.` : "כתובת צריכה להיות בצורה ״רחוב מספר״, למשל ״הרצל 12״."}
          </p>
          {parsed && <p className="mt-2 text-2xs leading-relaxed text-slate-500">{ADDRESS_COVERAGE_NOTE}</p>}
          {parsed && (
            <Link href={`${cityHref}/street/${encodeURIComponent(parsed.street)}`} className="mt-4 inline-block text-sm font-bold text-indigo-700 hover:underline">כל העסקאות ברחוב {parsed.street} →</Link>
          )}
          <div><Link href={cityHref} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100">← חזרה ל{cityName}</Link></div>
        </div>
      </main>
    );
  }
  const canonical = addressSlug(data.street, data.houseLabel);
  if (canonical !== addr || cityName !== requestedCity) {
    redirect(`${cityHref}/address/${encodeURIComponent(canonical)}`);
  }

  const [geometry, summary] = await Promise.all([
    loadCityMapGeometry(cityName),
    neighborhoodSummary(cityName, { scope: "secondhand", years: 3 }),
  ]);
  const hasMap = buildCityMap(geometry, summary.rows) !== null;

  const nis = (v: number | null) => (v == null ? "—" : `₪${Math.round(v).toLocaleString("he-IL")}`);
  const vsHood = new Map(data.perDealVsHood.map((p) => [p.id, p.vsHoodPct]));
  const streetHref = `${cityHref}/street/${encodeURIComponent(data.street)}`;
  const hoodHref = data.hood ? `${cityHref}/neighborhood/${encodeURIComponent(data.hood)}` : null;

  return (
    <main className="page-wrap py-8">
      <header className="mb-6">
        <nav className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
          <Link href={cityHref} className="hover:text-indigo-700">{cityName}</Link>
          {hoodHref && data.hood && (<><span className="text-slate-300">/</span><Link href={hoodHref} className="hover:text-indigo-700">{data.hood}</Link></>)}
          <span className="text-slate-300">/</span>
          <Link href={streetHref} className="hover:text-indigo-700">{data.street}</Link>
          <span className="text-slate-300">/</span>
          <span className="font-bold text-slate-800">{data.houseLabel}</span>
        </nav>
        <h1 className="text-2xl font-black leading-tight text-slate-900 sm:text-3xl">
          {data.street} {data.houseLabel}
          <span className="font-bold text-slate-400"> · {cityName}</span>
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          {data.deals.length.toLocaleString("he-IL")} עסקאות שדווחו לרשות המסים בכתובת הזו{data.years ? ` · ${data.years[0]}–${data.years[1]}` : ""}
          {data.yearBuilt ? ` · שנת בנייה ${data.yearBuilt}` : ""}
          {data.floors ? ` · ${data.floors} קומות עם עסקאות` : ""}
          {data.sizes ? ` · ${Math.round(data.sizes[0])}–${Math.round(data.sizes[1])} מ״ר` : ""}
        </p>
        <p className="mt-1 text-2xs leading-relaxed text-slate-400">{ADDRESS_COVERAGE_NOTE}</p>
      </header>

      {data.project.isProject && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>פרויקט קבלן.</b> {data.project.newDeals} דירות נמכרו כאן חדשות
          {data.project.firstSale ? ` החל מ-${data.project.firstSale.slice(0, 7)}` : ""}
          {data.project.lastSale ? ` ועד ${data.project.lastSale.slice(0, 7)}` : ""}.
          מחירי המכירה הראשונה הם מחירון קבלן ולא שוק יד שנייה — ההשוואה לשכונה מוצגת לכל עסקה בנפרד.
        </div>
      )}

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card label="₪ למ״ר חציוני בבניין" value={nis(data.medianSqm)} hint="כל השנים · ללא עסקאות יוקרה" />
        <Card label="דירות שנמכרו יותר מפעם" value={String(data.threads.length)} hint="לפי קומה, חדרים ושטח" />
        <Card label="עסקאות" value={data.deals.length.toLocaleString("he-IL")} hint={data.hood ? `בשכונת ${data.hood}` : undefined} />
      </section>

      <div className={hasMap ? "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]" : ""}>
        <div>
          {data.threads.length > 0 && (
            <section className="mb-8">
              <div className="section-header">
                <div className="section-header-icon"><Icon name="refresh" size="1em" /></div>
                <div><h2>אותה דירה, פעמיים</h2><p>דירות שנמכרו יותר מפעם אחת — מה קרה למחיר בין המכירות</p></div>
              </div>
              <div className="space-y-2">
                {data.threads.map((t) => (
                  <div key={t.key} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-extrabold text-slate-900">קומה {t.floor} · {t.rooms} חד׳ · {Math.round(t.area)} מ״ר</span>
                      <span className="text-slate-500">
                        {t.deals.length} מכירות{t.yearsApart ? ` · ${t.yearsApart} שנים` : ""}
                        {t.changePct != null && <> · <TrendValue pct={t.changePct} /></>}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-slate-600">
                      {t.deals.map((d) => <span key={d.id} className="tabular-nums">{d.dealDate} — {nis(d.price)}{d.priceSqm ? ` (${nis(d.priceSqm)}/מ״ר)` : ""}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mb-8">
            <div className="section-header">
              <div className="section-header-icon"><Icon name="document" size="1em" /></div>
              <div><h2>כל העסקאות בבניין</h2><p>מהחדשה לישנה · ״מול השכונה״ = ₪ למ״ר לעומת חציון היד-שנייה בשכונה באותה שנה</p></div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-slate-200 bg-slate-50 text-2xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 text-right font-bold">תאריך</th><th className="px-2 py-2 text-center font-bold">קומה</th>
                  <th className="px-2 py-2 text-center font-bold">חד׳</th><th className="px-2 py-2 text-center font-bold">מ״ר</th>
                  <th className="px-3 py-2 text-center font-bold">מחיר</th><th className="px-3 py-2 text-center font-bold">₪/מ״ר</th>
                  <th className="px-3 py-2 text-center font-bold">מול השכונה</th>
                </tr></thead>
                <tbody>{data.deals.map((d) => {
                  const v = vsHood.get(d.id) ?? null;
                  return (
                    <tr key={d.id} className="border-b border-slate-100 last:border-0">
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-500">{d.dealDate}{!d.isSecondHand && <span className="mr-1 rounded bg-amber-100 px-1 text-2xs font-bold text-amber-800">חדשה</span>}{d.luxury && <span className="mr-1 rounded bg-slate-100 px-1 text-2xs font-bold text-slate-600">יוקרה</span>}</td>
                      <td className="px-2 py-1.5 text-center tabular-nums">{d.floor ?? "—"}</td>
                      <td className="px-2 py-1.5 text-center tabular-nums">{d.rooms ?? "—"}</td>
                      <td className="px-2 py-1.5 text-center tabular-nums">{d.area == null ? "—" : Math.round(d.area)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-center font-bold tabular-nums text-slate-800">{nis(d.price)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-center tabular-nums">{nis(d.priceSqm)}</td>
                      <td className="px-3 py-1.5 text-center">{v == null ? <span className="text-slate-300">—</span> : <TrendValue pct={v} />}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </section>
        </div>
        {hasMap && (
          <aside>
            <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-slate-500">על המפה</h2>
            <AreaMap cityName={cityName} hood={data.hood} street={data.street} house={data.house} hasMap={hasMap} />
          </aside>
        )}
      </div>

      <p className="text-2xs leading-relaxed text-slate-400">
        <Icon name="source-own" size="1em" /> הכתובת, הקומה והשטח כפי שדווחו לרשות המסים. ״אותה דירה״ היא הערכה לפי קומה, חדרים ושטח — לא זיהוי ודאי.
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
