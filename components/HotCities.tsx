import CtaLink from "@/components/CtaLink";
import Sparkline from "@/components/Sparkline";
import TrendValue from "@/components/TrendValue";
import type { HotCitiesResult, HotCity } from "@/lib/hotCities";

/**
 * The first thing on the home page: three cities with real numbers on them.
 *
 * WHAT PROBLEM IT SOLVES
 * The page used to open with a search box and nothing to search for, which
 * helps only a visitor who already knows what they want. Three concrete cities
 * turn "what is this site" into a click. It sits ABOVE the search box on
 * purpose (operator, 8/2026); whoever does know what they want finds the box
 * directly below, on the same screen, without scrolling.
 *
 * EVERY FIGURE CARRIES ITS OWN LABEL. The first version printed "320" and
 * "₪2,116,125" and left the reader to infer what they measured — on a site
 * whose entire product is numbers, an unlabelled number is decoration. The
 * three metrics are now a labelled row, which also happens to occupy the same
 * two lines the unlabelled wrapping text did, so the card keeps its height.
 *
 * THE CAPTION IS TIED TO THE DATA, NOT WRITTEN ONCE. When the operator picks
 * the three cities by hand, this says so. Only when the ranking is measured
 * from real searches does it claim to be the most-searched — because a
 * decorative claim standing next to real figures costs more than the sentence
 * is worth. `source` carries the mode so the two cannot drift.
 *
 * ONE ROW PER CITY ON A PHONE, three cards on a wider screen. The phone layout
 * is not a shrunken card: the requirement is that all three AND the search box
 * below them are visible without scrolling, and three stacked cards cannot do
 * that in ~640px of viewport. A row can, at ~70px each.
 */

/**
 * One labelled figure. The label is not optional — that is the point.
 *
 * The labels are SHORT because they have to survive a third of a phone card,
 * and the full wording lives one line up, under the section heading, where it
 * is stated once for all three cities instead of truncated three times.
 */
function Figure({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0" title={title}>
      <p className="truncate text-[9px] leading-tight text-slate-400">{label}</p>
      <p className="truncate text-2xs font-bold leading-tight text-slate-800 sm:text-xs">{children}</p>
    </div>
  );
}

/**
 * The price, short enough for a third of a 375px card.
 *
 * ₪2,200,770 does not fit there, and a truncated price is worse than a rounded
 * one: "…,200,770" is unreadable, while "2.20 מ׳ ₪" is the number a person
 * would say out loud. The exact figure is shown wherever there is room for it,
 * and is one click away on the city page.
 *
 * TWO BIDI DECISIONS, BOTH LEARNED THE HARD WAY:
 *  - the unit is the Hebrew מ׳ and not a Latin "M". A strong-LTR character
 *    inside an RTL run reorders the whole run under the bidi algorithm — the
 *    same rule that once rendered "₪0.67M" backwards on this site.
 *  - the ₪ goes at the END, not the front. As a leading NEUTRAL character it
 *    is resolved into the surrounding RTL run and displayed after the digits,
 *    which came out as "מ׳ 2.20₪" — the unit read before the amount. Placing
 *    it last makes the visual order right.
 */
function shortShekel(value: string): string {
  const n = Number(value.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n < 1_000_000) return value;
  return `${(n / 1_000_000).toFixed(2)} מ׳ ₪`;
}

function YearChip({ city }: { city: HotCity }) {
  if (city.changeFromYear == null || city.changeToYear == null) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-px text-[9px] font-bold tabular-nums text-slate-500"
      dir="ltr"
      title={
        city.partial
          ? `הנתונים מתייחסים לשנים ${city.changeFromYear}–${city.changeToYear}. ${city.changeToYear} היא שנה חלקית — עד העסקאות שנקלטו עד כה.`
          : `הנתונים מתייחסים לשנים ${city.changeFromYear}–${city.changeToYear}`
      }
    >
      {city.changeFromYear}–{city.changeToYear}
      {city.partial && <span className="font-normal text-amber-600">חלקית</span>}
    </span>
  );
}

/** The chart window, in words, for the caption. */
const TREND_SPAN = 3;

export default function HotCities({ data }: { data: HotCitiesResult }) {
  const { cities, source } = data;
  if (!cities.length) return null;

  // Identical for every card — one cutoff, one query — so it belongs in the
  // caption rather than repeated (and clipped) three times.
  const buyersWindow = cities.find((c) => c.buyers)?.buyers?.windowLabel ?? null;

  return (
    /* The rubric: the section is framed and tinted in the site's indigo, and
       the white cards sit ON it. Same language as the dashboard's insight
       board, so this reads as part of the system rather than a new element. */
    <section
      aria-labelledby="hot-cities-title"
      className="mt-3 rounded-2xl border border-indigo-200 bg-indigo-50/50 p-2 md:mt-5 md:p-3"
    >
      <div className="mb-1.5 px-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="hot-cities-title" className="text-sm font-black text-slate-900 md:text-base">
            <span aria-hidden className="me-1">🔥</span>ערים חמות
          </h2>
          <p className="text-2xs text-slate-500 md:text-xs">
            {source === "searched"
              ? "הערים שהכי חיפשו באתר ב-30 הימים האחרונים"
              : "שלוש ערים להתחיל מהן"}
          </p>
        </div>
        {/* What the three figures on every card actually are, said ONCE. Per
            card there is room for a two-word label and no more, and three
            truncated captions explain less than one full sentence here. */}
        <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
          מגמת מחיר יד-2 ב-{TREND_SPAN} השנים האחרונות · כמות קונים יד-2
          {buyersWindow ? ` בחודשים ${buyersWindow} מול אותה תקופה אשתקד` : " מול אשתקד"} ·
          מחיר ממוצע לדירת 4 חדרים
        </p>
      </div>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3 sm:gap-3">
        {cities.map((c) => {
          const rising = c.changePct == null ? undefined : c.changePct >= 0;
          const values = c.trend.map((p) => p.value);
          const years = c.trend.map((p) => p.year);
          return (
            <CtaLink
              key={c.cityName}
              href={`/city/${encodeURIComponent(c.cityName)}`}
              cta="hot_city"
              context={c.cityName}
              className="group flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2 transition-colors hover:border-indigo-400 hover:shadow-sm sm:flex-col sm:items-stretch sm:gap-2 sm:px-4 sm:py-3.5"
            >
              <div className="min-w-0 flex-1 sm:flex-none">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="truncate text-sm font-black text-slate-900 sm:text-base">
                    {c.cityName}
                  </span>
                  <YearChip city={c} />
                </div>

                {/* three labelled figures, in the two lines the unlabelled
                    wrapping text used to take */}
                <div className="mt-1 grid grid-cols-3 gap-x-2">
                  <Figure
                    label="מגמת יד-2"
                    title={`שינוי מחיר יד-2 למ״ר בין ${c.changeFromYear ?? "?"} ל-${c.changeToYear ?? "?"}${c.partial ? " (שנה חלקית)" : ""}`}
                  >
                    <TrendValue pct={c.changePct} className="text-2xs font-bold sm:text-xs" />
                  </Figure>
                  <Figure
                    label="קונים"
                    title={
                      c.buyers
                        ? `כמות רוכשי יד-2 ב-${c.buyers.windowLabel} השנה (${c.buyers.current}) מול אותה תקופה אשתקד (${c.buyers.previous})`
                        : "כמות רוכשי יד-2 מול אותה תקופה אשתקד"
                    }
                  >
                    {c.buyers?.pct == null
                      ? <span className="text-slate-300">—</span>
                      : <TrendValue pct={c.buyers.pct} className="text-2xs font-bold sm:text-xs" />}
                  </Figure>
                  <Figure
                    label="ממוצע 4 חד׳"
                    title={c.extra ? `${c.extra.label}${c.extra.year ? ` — ${c.extra.year}` : ""}` : "מחיר ממוצע לדירת 4 חדרים"}
                  >
                    {c.extra ? (
                      <>
                        <span className="sm:hidden">{shortShekel(c.extra.value)}</span>
                        <span className="hidden sm:inline">{c.extra.value}</span>
                      </>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </Figure>
                </div>
              </div>

              {/* Two sizes rather than one stretched one: an SVG scaled by CSS
                  would stretch the stroke with it. Only the wide one has room
                  for axis labels; both carry the axes themselves. */}
              <Sparkline points={values} rising={rising} className="shrink-0 sm:hidden" />
              <Sparkline
                points={values}
                labels={years}
                rising={rising}
                width={240}
                height={58}
                showValues
                className="hidden sm:block"
              />

              <span
                aria-hidden
                className="shrink-0 text-slate-300 transition-colors group-hover:text-indigo-500 sm:hidden"
              >
                ‹
              </span>
              <span className="hidden text-xs font-bold text-indigo-700 group-hover:underline sm:block">
                לנתוני העיר ‹
              </span>
            </CtaLink>
          );
        })}
      </div>
    </section>
  );
}
