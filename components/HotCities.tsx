import CtaLink from "@/components/CtaLink";
import Sparkline from "@/components/Sparkline";
import TrendValue from "@/components/TrendValue";
import type { HotCitiesResult } from "@/lib/hotCities";

/**
 * The first thing on the home page: three cities with real numbers on them.
 *
 * WHAT PROBLEM IT SOLVES
 * The page used to open with a search box and nothing to search for. A visitor
 * who has no city in mind — which is most first-time visitors — had no first
 * move, and the usage log showed the fold behaving like a dead end. Three
 * concrete cities convert "what is this site" into a click.
 *
 * IT SITS ABOVE THE SEARCH BOX, ON PURPOSE (operator, 8/2026). That inverts
 * the usual search-first hero, and the reason is that the search box only
 * helps someone who already knows what they want. Whoever does can still use
 * it — it is directly below, on the same screen, without scrolling.
 *
 * THE CAPTION IS TIED TO THE DATA, NOT WRITTEN ONCE. When the operator picks
 * the three cities by hand, this says so. Only when the ranking is measured
 * from real searches does it claim to be the most-searched — because on a site
 * whose product is numbers, a decorative claim next to real figures costs more
 * than the sentence is worth. `source` carries the mode so the two cannot drift.
 *
 * ONE ROW PER CITY ON A PHONE, three cards on a wider screen. The phone layout
 * is not a shrunken card: the requirement is that all three AND the search box
 * below them are visible without scrolling, and three stacked cards cannot do
 * that in ~640px of viewport. A row can, at ~66px each.
 */

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <b className="font-bold text-slate-700 tabular-nums">{value}</b>
      <span className="text-slate-400">{label}</span>
    </span>
  );
}

export default function HotCities({ data }: { data: HotCitiesResult }) {
  const { cities, source } = data;
  if (!cities.length) return null;

  return (
    <section aria-labelledby="hot-cities-title" className="mt-3 md:mt-5">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h2 id="hot-cities-title" className="text-sm font-black text-slate-900 md:text-base">
          <span aria-hidden className="me-1">🔥</span>ערים חמות
        </h2>
        <p className="text-2xs text-slate-400 md:text-xs">
          {source === "searched"
            ? "הערים שהכי חיפשו באתר ב-30 הימים האחרונים"
            : "שלוש ערים להתחיל מהן"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3 sm:gap-3">
        {cities.map((c) => {
          const rising = c.changePct == null ? undefined : c.changePct >= 0;
          const trend = c.trend.map((p) => p.value);
          return (
            <CtaLink
              key={c.cityName}
              href={`/city/${encodeURIComponent(c.cityName)}`}
              cta="hot_city"
              context={c.cityName}
              className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 sm:flex-col sm:items-stretch sm:gap-2 sm:px-4 sm:py-3.5"
            >
              <div className="min-w-0 flex-1 sm:flex-none">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-black text-slate-900 sm:text-base">
                    {c.cityName}
                  </span>
                  <TrendValue pct={c.changePct} className="text-sm font-black sm:text-lg" />
                </div>
                <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-2xs text-slate-500">
                  {c.changeFromYear && c.changeToYear && (
                    <span className="text-slate-400" dir="ltr">
                      {c.changeFromYear}–{c.changeToYear}
                    </span>
                  )}
                  {c.secondhandBuyers != null && (
                    <Metric label="קונים יד-2" value={c.secondhandBuyers.toLocaleString("he-IL")} />
                  )}
                  {c.extra && <Metric label={c.extra.label} value={c.extra.value} />}
                </p>
              </div>

              {/* Two sizes rather than one stretched one: an SVG scaled by CSS
                  would stretch the stroke with it. Both are pure markup. */}
              <Sparkline points={trend} rising={rising} className="shrink-0 sm:hidden" />
              <Sparkline
                points={trend}
                rising={rising}
                width={220}
                height={44}
                className="hidden w-full sm:block"
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
