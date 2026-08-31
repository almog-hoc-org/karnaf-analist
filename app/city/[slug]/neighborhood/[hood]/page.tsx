import Link from "next/link";
import { redirect } from "next/navigation";
import Icon from "@/components/Icon";
import InfoTip from "@/components/InfoTip";
import HoodTrendStudio from "@/components/HoodTrendStudio";
import HoodDealsTable from "@/components/HoodDealsTable";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getRuleBool, getRuleText } from "@/lib/systemRules";
import { isCityUnlocked } from "@/lib/credits";
import { anonId, isAnonCityUnlocked } from "@/lib/anonAccess";
import { canonicalCityName } from "@/lib/cityAliases";
import { neighborhoodMinDeals, neighborhoodSummary } from "@/lib/neighborhoods";
import { loadHoodPage, loadHoodDeals, loadHoodSeries } from "@/lib/neighborhoodPage";

/**
 * A city page, one level down: one neighbourhood's price history and deals.
 *
 * THE FIRST NESTED DYNAMIC ROUTE IN THE APP, and both segments are Hebrew.
 * The rules the city page learned the hard way apply verbatim: no
 * generateStaticParams (Next encodes params itself — prerendering Hebrew
 * slugs double-encoded every one of them, and not one city ever matched its
 * own prerendered page), decode on read, encode exactly once on write.
 *
 * OPEN TO EVERYONE, BY OPERATOR DECISION (8/2026) — including crawlers, with
 * a sitemap entry. The admin rule neighborhood_pages_public flips that: off,
 * this page requires exactly what its parent city requires. Deliberately no
 * anonymous free-slot spending here in either mode: a visitor landing on a
 * neighbourhood from a search result must not burn a free CITY slot on it.
 */

export const dynamic = "force-dynamic";

interface PageProps { params: { slug: string; hood: string } }

export async function generateMetadata({ params }: PageProps) {
  const cityName = decodeURIComponent(params.slug);
  const hood = decodeURIComponent(params.hood);
  const title = `מחירי דירות ב${hood}, ${cityName} — מחיר למ״ר, עסקאות ומגמות`;
  const description = `כמה עולה דירה בשכונת ${hood} ב${cityName}? מחיר ממוצע למ״ר, מגמת מחירים לאורך שנים והיסטוריית עסקאות — מעסקאות אמת שדווחו לרשות המסים.`;
  const path = `/city/${encodeURIComponent(cityName)}/neighborhood/${encodeURIComponent(hood)}`;
  return {
    title, description,
    alternates: { canonical: path },
    openGraph: { title, description, type: "article", locale: "he_IL", url: path },
  };
}

export default async function NeighborhoodPage({ params }: PageProps) {
  const requestedCity = decodeURIComponent(params.slug);
  const cityName = canonicalCityName(requestedCity);
  const hoodParam = decodeURIComponent(params.hood);

  // ── access — the parent city's gate, only when the operator closed the rule ──
  if (!getRuleBool("neighborhood_pages_public", true)) {
    const paywallOn = getRuleBool("paywall_on", true);
    const demoCity = getRuleText("demo_city", "חיפה");
    if (paywallOn && cityName !== demoCity) {
      const viewer = getCurrentUser();
      // A signed-out visitor who already spent a free slot on this city HAS
      // this city — the allowance buys the city, not one page of it. Without
      // this check the neighbourhood link on their own open city page bounced
      // them back to the city page, which reads as a wall arriving early.
      const aid = viewer ? null : anonId();
      const anonHasCity = !!aid && isAnonCityUnlocked(aid, cityName);
      // Still walled → the city page, which owns the public summary and the
      // wall. A redirect, not a wall copy: one gate, maintained once.
      if (!anonHasCity && (!viewer || !isCityUnlocked(viewer.id, cityName))) {
        redirect(`/city/${encodeURIComponent(cityName)}`);
      }
    }
  }

  const scope = "secondhand" as const;
  const { data, canonical } = await loadHoodPage(cityName, hoodParam, scope);

  // A reader's spelling of a real neighbourhood lands on the canonical URL —
  // one address per page, exactly like the city aliases.
  if (canonical && (canonical !== hoodParam || cityName !== requestedCity)) {
    redirect(`/city/${encodeURIComponent(cityName)}/neighborhood/${encodeURIComponent(canonical)}`);
  }

  if (!data) {
    // Not a 404 page: the visitor asked a reasonable question about a real
    // city, and the useful answer is which neighbourhoods DO have enough data.
    const cityExists = await prisma.city
      .findUnique({ where: { city_name: cityName }, select: { city_name: true } })
      .catch(() => null);
    const siblings = cityExists ? await neighborhoodSummary(cityName, { scope }) : null;
    return (
      <main className="page-wrap py-16 text-center">
        <div className="glass-card mx-auto max-w-xl p-8">
          <h1 className="text-2xl font-black text-slate-900">{hoodParam}</h1>
          <p className="mt-3 text-sm text-slate-600">
            {cityExists
              ? `אין לשכונה הזו מספיק עסקאות במאגר כדי להציג עמוד (הרף: ${neighborhoodMinDeals()}+ עסקאות בשנה).`
              : "העיר לא נמצאה במאגר."}
          </p>
          {siblings && siblings.rows.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {siblings.rows.slice(0, 12).map((r) => (
                <Link
                  key={r.neighborhood}
                  href={`/city/${encodeURIComponent(cityName)}/neighborhood/${encodeURIComponent(r.neighborhood)}`}
                  className="chip-action border-slate-300 text-slate-600 hover:bg-slate-50"
                >
                  {r.neighborhood}
                </Link>
              ))}
            </div>
          )}
          <Link
            href={`/city/${encodeURIComponent(cityName)}`}
            className="mt-5 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100"
          >
            ← חזרה ל{cityName}
          </Link>
        </div>
      </main>
    );
  }

  const [firstDeals, series] = await Promise.all([
    loadHoodDeals(cityName, data.neighborhood, scope),
    loadHoodSeries(cityName, data.neighborhood),
  ]);
  const cityHref = `/city/${encodeURIComponent(cityName)}`;

  return (
    <main className="page-wrap py-8">
      {/* ── header — the city page's shape, one level down ── */}
      <header className="mb-6">
        <nav className="mb-3 flex items-center justify-between text-sm">
          <Link href={cityHref} className="inline-flex items-center gap-1.5 text-slate-600 transition-colors hover:text-indigo-700">
            <span>←</span><span>כל השכונות ב{cityName}</span>
          </Link>
          <Link href="/" className="text-slate-500 transition-colors hover:text-indigo-700">דף הבית ←</Link>
        </nav>
        <h1 className="text-2xl font-black leading-tight text-slate-900 sm:text-3xl">
          מחירי דירות ב{data.neighborhood}
          <span className="font-bold text-slate-400"> · {cityName}</span>
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          עסקאות יד שנייה שדווחו לרשות המסים · שם השכונה כפי שדווח
          {data.refYear ? ` · נתוני הכותרת: ${data.refYear}` : ""}
          <InfoTip
            label="על העמוד"
            text={`מוצגות רק שנים שבהן לשכונה ${neighborhoodMinDeals()}+ עסקאות — שנה דלה אינה מוצגת ואינה מוצעת כמגמה. ההשוואה לעיר מחושבת מאותם תאי שכונה בדיוק.`}
          />
        </p>
      </header>

      {/* headline numbers + filters + chart — one client component, all the
          scope×rooms series shipped from here so filtering is local */}
      <HoodTrendStudio data={data} series={series} />

      {/* ── the receipts ── */}
      <section className="mb-8">
        <div className="section-header">
          <div className="section-header-icon"><Icon name="document" size="1em" /></div>
          <div>
            <h2>היסטוריית העסקאות</h2>
            <p>{firstDeals.total.toLocaleString("he-IL")} עסקאות יד שנייה בשכונה, מהחדשה לישנה</p>
          </div>
        </div>
        {/* How active is this hood, in one sentence (operator, 8/2026): the
            last year's count against the average of the years before it —
            both from the same published cells, so the floor rule applies. */}
        {(() => {
          if (data.refYear == null || data.n == null) return null;
          const prev = data.trend.filter((p) => p.year < data.refYear!);
          const prevAvg = prev.length ? Math.round(prev.reduce((t, p) => t + p.n, 0) / prev.length) : null;
          return (
            <p className="mb-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-2 text-center text-sm text-slate-700">
              בשנת <b>{data.refYear}</b> בוצעו בשכונה <b>{data.n.toLocaleString("he-IL")}</b> עסקאות
              {prevAvg != null && (
                <> · ממוצע השנים הקודמות: <b>{prevAvg.toLocaleString("he-IL")}</b> עסקאות בשנה</>
              )}
            </p>
          );
        })()}
        <HoodDealsTable
          cityName={cityName}
          neighborhood={data.neighborhood}
          scope={scope}
          initialDeals={firstDeals.deals}
          total={firstDeals.total}
        />
      </section>

      {/* ── the rest of the city ── */}
      {data.siblings.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-500">שכונות נוספות ב{cityName}</h2>
          <div className="flex flex-wrap gap-1.5">
            {data.siblings.map((s) => (
              <Link
                key={s}
                href={`/city/${encodeURIComponent(cityName)}/neighborhood/${encodeURIComponent(s)}`}
                className="chip-action border-slate-300 text-slate-600 hover:bg-slate-50"
              >
                {s}
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className="text-2xs leading-relaxed text-slate-400">
        <Icon name="source-own" size="1em" /> מחושב מהעסקאות שנאספו ונוקו — שם השכונה כפי שדווח לרשות המסים.
        {" "}<Link href="/methodology" className="underline hover:text-indigo-700">מתודולוגיה →</Link>
      </p>
    </main>
  );
}

