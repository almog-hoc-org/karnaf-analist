import Link from "next/link";
import { notFound } from "next/navigation";
import Icon from "@/components/Icon";
import TrendValue from "@/components/TrendValue";
import DealSeriesChart from "@/components/DealSeriesChart";
import TrackableOutboundLink from "@/components/TrackableOutboundLink";
import { buttonClass } from "@/components/ui/Button";
import { gateAreaPage } from "@/lib/areaPageGate";
import { pageMeta } from "@/lib/seo";
import { getCurrentUser } from "@/lib/auth";
import { whatsappShareUrl } from "@/lib/share";
import { addressSlug } from "@/lib/buildingRules";
import { analyzeDeal, type DealAnalysis } from "@/lib/dealAnalysisDb";
import { CONFIDENCE_LABEL, COMP_MIN, COMP_WINDOW_MONTHS, RUNG_LABEL, verdictTone } from "@/lib/dealAnalysis";
import type { AddressDeal } from "@/lib/buildingRules";

/**
 * One reported sale, judged against the sales that were really comparable to
 * it at the time (lib/dealAnalysis.ts). Reached by clicking any deal row on
 * the site.
 *
 * Open on the same rule as the building pages (street_pages_public), never
 * indexed: thousands of near-identical pages per street would compete with
 * the building page they belong to, so the canonical points there.
 */
export const dynamic = "force-dynamic";

interface PageProps { params: { id: string } }

const idOf = (raw: string) => (/^\d{1,10}$/.test(raw) ? Number(raw) : NaN);
const nis = (v: number | null | undefined) => (v == null ? "—" : `₪${Math.round(v).toLocaleString("he-IL")}`);
const cityHref = (c: string) => `/city/${encodeURIComponent(c)}`;

function homeOf(a: DealAnalysis): { href: string; label: string } {
  const c = a.deal.cityName;
  if (a.building) return { href: `${cityHref(c)}/address/${encodeURIComponent(addressSlug(a.building.street, a.building.houseLabel))}`, label: `${a.building.street} ${a.building.houseLabel}` };
  if (a.deal.street) return { href: `${cityHref(c)}/street/${encodeURIComponent(a.deal.street)}`, label: `רחוב ${a.deal.street}` };
  return { href: cityHref(c), label: c };
}

function titleOf(a: DealAnalysis): string {
  const d = a.deal;
  const where = d.street ? `${d.street}${d.houseNum ? ` ${d.houseNum}` : ""}, ${d.cityName}` : d.cityName;
  return `עסקה: ${where} — ${d.rooms ? `${d.rooms} חד׳ · ` : ""}${nis(d.price)} (${d.dealDate.slice(0, 7)})`;
}

export async function generateMetadata({ params }: PageProps) {
  const id = idOf(params.id);
  const a = Number.isFinite(id) ? await analyzeDeal(id) : null;
  if (!a) return { title: "עסקה לא נמצאה", robots: { index: false, follow: false } };
  const meta = pageMeta({ path: homeOf(a).href, title: titleOf(a), description: "ניתוח עסקה אחת מול עסקאות דומות באותה תקופה, השכונה והעיר.", index: false });
  return meta;
}

export default async function DealPage({ params }: PageProps) {
  const id = idOf(params.id);
  if (!Number.isFinite(id)) notFound();
  const a = await analyzeDeal(id);
  if (!a) notFound();
  const d = a.deal;
  gateAreaPage(d.cityName, "street_pages_public");

  const home = homeOf(a);
  const hood = a.baseline.hood;
  const viewer = getCurrentUser();
  const c = a.comps;
  const place = d.street ? `ברחוב ${d.street}, ${d.cityName}` : `ב${d.cityName}`;
  const shareText = c?.verdict ? `עסקה ${place} — ${c.verdict.text} מול עסקאות דומות:` : `עסקה ${place} מול עסקאות דומות:`;

  return (
    <main className="page-wrap py-8">
      <header className="mb-6">
        <nav className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
          <Link href={cityHref(d.cityName)} className="hover:text-indigo-700">{d.cityName}</Link>
          {hood && (<><span className="text-slate-300">/</span><Link href={`${cityHref(d.cityName)}/neighborhood/${encodeURIComponent(hood)}`} className="hover:text-indigo-700">{hood}</Link></>)}
          {d.street && (<><span className="text-slate-300">/</span><Link href={`${cityHref(d.cityName)}/street/${encodeURIComponent(a.building?.street ?? d.street)}`} className="hover:text-indigo-700">{a.building?.street ?? d.street}</Link></>)}
          {a.building && (<><span className="text-slate-300">/</span><Link href={home.href} className="hover:text-indigo-700">{a.building.houseLabel}</Link></>)}
          <span className="text-slate-300">/</span>
          <span className="font-bold text-slate-800">עסקה</span>
        </nav>
        <h1 className="text-2xl font-black leading-tight text-slate-900 sm:text-3xl">
          {nis(d.price)}
          <span className="font-bold text-slate-400"> · {d.street ? `${d.street}${d.houseNum ? ` ${d.houseNum}` : ""}, ` : ""}{d.cityName}</span>
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          {d.dealDate}
          {d.rooms ? ` · ${d.rooms} חד׳` : ""}
          {d.area ? ` · ${Math.round(d.area)} מ״ר` : ""}
          {d.floor ? ` · קומה ${d.floor}` : ""}
          {d.priceSqm ? ` · ${nis(d.priceSqm)} למ״ר` : ""}
          {d.yearBuilt ? ` · נבנה ${d.yearBuilt}` : ""}
          {" · "}{d.isSecondHand ? "יד שנייה" : "חדשה מקבלן"}
          {d.luxury && <span className="mr-2 rounded bg-slate-100 px-1.5 text-2xs font-bold text-slate-600">יוקרה</span>}
        </p>
        {a.register && (
          <p className="mt-1 text-2xs text-slate-400">
            בפנקס מיסוי מקרקעין: {a.register.nature ?? "—"}
            {a.register.declaredAmount ? ` · סכום מוצהר ${nis(a.register.declaredAmount)}` : ""}
            {a.register.portion != null && a.register.portion < 1 ? ` · נמכר ${Math.round(a.register.portion * 100)}% מהנכס` : ""}
          </p>
        )}
      </header>

      {d.excluded && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>העסקה הזו לא נספרת בסטטיסטיקות.</b> {d.exclusionReason ?? "הוחרגה בסינון הנתונים."}
          {" "}היא מוצגת כאן כפי שדווחה, אבל לא משמשת להשוואה ולא לממוצעים.{" "}
          <Link href="/methodology" className="underline">איך מסננים →</Link>
        </div>
      )}

      <section className="mb-6 glass-card p-5">
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">מול עסקאות דומות באותה תקופה</h2>
        {!c ? (
          <p className="mt-2 text-sm text-slate-600">לא נמצאו עסקאות דומות (אותו סוג, אותו מספר חדרים, שטח דומה) ב-{COMP_WINDOW_MONTHS} החודשים שסביב העסקה.</p>
        ) : (
          <>
            {c.verdict ? (
              <div className={`mt-2 inline-block rounded-xl border px-3 py-1.5 text-lg font-black ${verdictTone(c.verdict)}`}>{c.verdict.text}</div>
            ) : (
              <div className="mt-2 inline-block rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-base font-black text-slate-700">
                {c.enough ? "אין ₪ למ״ר לעסקה הזו" : `מעט עסקאות להשוואה (${c.n}) — אין פסיקה`}
              </div>
            )}
            <p className="mt-2 text-sm text-slate-700">
              חציון {nis(c.medianSqm)} למ״ר ב-{c.n.toLocaleString("he-IL")} עסקאות {RUNG_LABEL[c.rung]}
              {c.spread ? ` · מחצית מהן בין ${nis(c.spread[0])} ל-${nis(c.spread[1])}` : ""}
              {c.percentile != null ? ` · העסקה יקרה מ-${c.percentile}% מהן` : ""}
            </p>
            <p className="mt-1 text-2xs text-slate-500">
              {CONFIDENCE_LABEL[c.confidence]} · {d.isSecondHand ? "יד שנייה" : "חדשות"}{d.rooms ? `, ${d.rooms} חד׳` : ""}{d.area ? `, ${Math.round(d.area * 0.8)}–${Math.round(d.area * 1.2)} מ״ר` : ""}
              {` · ±${COMP_WINDOW_MONTHS} חודשים, מותאם לשנת ${d.dealYear} לפי מדד האזור`}
              {c.unadjusted ? ` · ${c.unadjusted} עסקאות בלי מדד להתאמה לא נכללו` : ""}
              {!c.enough ? ` · נדרשות לפחות ${COMP_MIN} לפסיקה` : ""}
            </p>
          </>
        )}
      </section>

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card label={hood ? `שכונת ${hood} ב-${d.dealYear}` : `השכונה ב-${d.dealYear}`} value={nis(a.baseline.hoodSqm)}
          hint={a.baseline.hoodSqm && d.priceSqm && !d.luxury && d.isSecondHand ? <>העסקה <TrendValue pct={(d.priceSqm / a.baseline.hoodSqm - 1) * 100} /> · יד שנייה, למ״ר</> : "יד שנייה, למ״ר"} />
        <Card label={`${d.cityName} ב-${d.dealYear}`} value={nis(a.baseline.citySqm)}
          hint={a.baseline.citySqm && d.priceSqm && !d.luxury && d.isSecondHand ? <>העסקה <TrendValue pct={(d.priceSqm / a.baseline.citySqm - 1) * 100} /> · יד שנייה, למ״ר</> : "יד שנייה, למ״ר"} />
        <Card label={a.today ? `אותה דירה לפי המדד, ${a.today.year}` : "שווי לפי המדד היום"} value={a.today?.price ? nis(a.today.price) : a.today ? `${nis(a.today.sqm)}/מ״ר` : "—"}
          hint={a.today ? <><TrendValue pct={a.today.changePct} /> מאז העסקה · הערכה לפי מגמת האזור, לא שמאות</> : "אין עדיין שנה מאוחרת יותר במדד"} />
      </section>

      {d.priceSqm && a.series.length > 1 && (
        <section className="mb-8">
          <div className="section-header">
            <div className="section-header-icon"><Icon name="chart" size="1em" /></div>
            <div><h2>העסקה על רקע השוק</h2><p>₪ למ״ר יד שנייה לפי שנה — השכונה והעיר</p></div>
          </div>
          <DealSeriesChart series={a.series} deal={{ year: d.dealYear, sqm: d.priceSqm }} hoodName={hood} />
        </section>
      )}

      {a.building?.thread && (
        <section className="mb-8">
          <div className="section-header">
            <div className="section-header-icon"><Icon name="refresh" size="1em" /></div>
            <div><h2>אותה דירה, מכירות אחרות</h2><p>לפי קומה, חדרים ושטח — הערכה, לא זיהוי ודאי</p></div>
          </div>
          <DealTable deals={a.building.thread.deals} current={d.id} />
        </section>
      )}

      {c && c.rows.length > 0 && (
        <section className="mb-8">
          <div className="section-header">
            <div className="section-header-icon"><Icon name="scale" size="1em" /></div>
            <div><h2>העסקאות שהשוונו</h2><p>{RUNG_LABEL[c.rung]} · מחירים כפי שדווחו, לפני התאמת זמן</p></div>
          </div>
          <DealTable deals={c.rows} current={d.id} showAddress={c.rung !== "building"} />
        </section>
      )}

      {a.building && a.building.deals.length > 1 && (
        <section className="mb-8">
          <div className="section-header">
            <div className="section-header-icon"><Icon name="building" size="1em" /></div>
            <div><h2>עוד עסקאות בבניין</h2><p>{a.building.street} {a.building.houseLabel} · מהחדשה לישנה</p></div>
          </div>
          <DealTable deals={a.building.deals.slice(0, 20)} current={d.id} />
          {a.building.deals.length > 20 && (
            <Link href={home.href} className="mt-2 inline-block text-sm font-bold text-indigo-700 hover:underline">כל {a.building.deals.length} העסקאות בבניין →</Link>
          )}
        </section>
      )}

      <div className="mb-6 flex flex-wrap gap-3">
        <TrackableOutboundLink href={whatsappShareUrl(`/deal/${d.id}`, viewer?.id, shareText)} eventName="share_click" subject={d.cityName} detail="deal_page" className={buttonClass("secondary", "md")}>
          <Icon name="chat" size="1em" /> שיתוף בוואטסאפ
        </TrackableOutboundLink>
        <Link href={home.href} className={buttonClass("ghost", "md")}>{home.label} →</Link>
        <Link href="/check" className={buttonClass("ghost", "md")}>בדיקת מחיר לדירה אחרת</Link>
      </div>

      <p className="text-2xs leading-relaxed text-slate-400">
        <Icon name="source-own" size="1em" /> העסקה כפי שדווחה לרשות המסים. ״עסקאות דומות״: אותו סוג (יד שנייה/חדשה), אותו מספר חדרים, שטח ±20%,
        עד {COMP_WINDOW_MONTHS} חודשים לפני או אחרי, בלי עסקאות יוקרה וכפילויות — מהבניין, ואם אין מספיק מהרחוב, מהשכונה ומהעיר.
        {" "}<Link href="/methodology" className="underline hover:text-indigo-700">מתודולוגיה →</Link>
      </p>
    </main>
  );
}

function DealTable({ deals, current, showAddress = false }: { deals: AddressDeal[]; current: number; showAddress?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-xs">
        <thead><tr className="border-b border-slate-200 bg-slate-50 text-2xs uppercase tracking-wide text-slate-500">
          <th className="px-3 py-2 text-right font-bold">תאריך</th>
          {showAddress && <th className="px-3 py-2 text-right font-bold">כתובת</th>}
          <th className="px-2 py-2 text-center font-bold">קומה</th><th className="px-2 py-2 text-center font-bold">חד׳</th>
          <th className="px-2 py-2 text-center font-bold">מ״ר</th><th className="px-3 py-2 text-center font-bold">מחיר</th>
          <th className="px-3 py-2 text-center font-bold">₪/מ״ר</th>
        </tr></thead>
        <tbody>{deals.map((r) => (
          <tr key={r.id} className={`border-b border-slate-100 last:border-0 ${r.id === current ? "bg-amber-50" : "hover:bg-slate-50"}`}>
            <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
              {r.id === current ? <span className="font-bold">{r.dealDate} (זו)</span> : <Link href={`/deal/${r.id}`} className="text-indigo-700 hover:underline">{r.dealDate}</Link>}
            </td>
            {showAddress && <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-600">{r.street ? `${r.street}${r.houseNum ? ` ${r.houseNum}` : ""}` : "—"}</td>}
            <td className="px-2 py-1.5 text-center tabular-nums">{r.floor ?? "—"}</td>
            <td className="px-2 py-1.5 text-center tabular-nums">{r.rooms ?? "—"}</td>
            <td className="px-2 py-1.5 text-center tabular-nums">{r.area == null ? "—" : Math.round(r.area)}</td>
            <td className="whitespace-nowrap px-3 py-1.5 text-center font-bold tabular-nums text-slate-800">{nis(r.price)}</td>
            <td className="whitespace-nowrap px-3 py-1.5 text-center tabular-nums">{nis(r.priceSqm)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="kpi-card">
      <div className="text-2xs font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="stat-value mt-1 text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-2xs text-slate-500">{hint}</div>}
    </div>
  );
}
