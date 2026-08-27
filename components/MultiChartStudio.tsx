"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { CityGraphData, DealCountCube, NadlanDeal, RoomKey, Scope, StatPoint } from "@/lib/nadlanTransactionSeries";
import DealsDrawer from "./DealsDrawer";
import TrendValue from "./TrendValue";
import SourceBadge from "./SourceBadge";
import { GRID, AXIS, tooltipStyle, tipFmt } from "@/lib/chartColors";
import { useIsMobile } from "@/lib/useIsMobile";
import { withBasePath } from "@/lib/basePath";
import { setViewState, clearViewState } from "@/lib/viewState";
import { track } from "@/lib/track";
import Icon from "@/components/Icon";
import InfoTip from "@/components/InfoTip";
import { YearRange } from "@/components/FromTo";

/**
 * MultiChartStudio — ONE tool for exploring price trends (user spec):
 *   · pick any combination of series (up to 4) and see them SIDE-BY-SIDE:
 *     overlay on one chart, or a grid of small charts with volume bars
 *   · pick metric (₪/m² | deal ₪), room size, and any year range
 *   · trend panel: Δ% per selected series over the chosen range + quick windows
 * Sources are mixed deliberately and labeled: independent repository series
 * (🔵) alongside the official gov median (🏛️).
 */

type Metric = "sqm" | "price";
/** building-age dimension for second-hand (hierarchy: יד-2 → modern/old → rooms) */
type Ba = "all" | "modern" | "old";
const shScope = (ba: Ba) => (ba === "all" ? "secondhand" : `secondhand_${ba}`) as "secondhand" | "secondhand_modern" | "secondhand_old";
/**
 * Fallback sample floor. The LIVE floor is the `min_deals_per_year` admin rule,
 * passed in as `minSample` — this constant only covers a caller that has no
 * rule access. Hardcoding it here was a divergence waiting to happen: the
 * tables read the rule, the chart read the literal, and the moment an operator
 * changed the rule the same city would quote two different ₪/m² on one page.
 */
const DEFAULT_MIN_N = 10;

interface SeriesDef {
  key: string;
  label: string;
  short: string;
  color: string;
  external?: boolean;
  /** returns [value, n] for a year under a metric+room+building-age, or null */
  at: (data: CityGraphData, room: RoomKey, metric: Metric, year: number, ba: Ba) => [number, number] | null;
}

const pick = (p: StatPoint | undefined, metric: Metric, which: "avg" | "med"): number | null => {
  if (!p) return null;
  if (metric === "sqm") return which === "avg" ? p.avgSqm : p.medianSqm;
  return which === "avg" ? p.avgPrice : p.medianPrice;
};

const stat = (d: CityGraphData, scope: "all" | "secondhand" | "new" | "secondhand_modern" | "secondhand_old" | "secondhand_fixedmix" | "all_govmap", room: RoomKey, year: number) =>
  d.nadlan[scope][room].find((p) => p.year === year);
/** Cities whose nadlan coverage is too thin use a govmap-only "all" line for the whole
 *  decade (never spliced — mixing sources inside one city produced 40-90% phantom jumps). */
const isGovmapCity = (d: CityGraphData) => d.nadlan.all_govmap.all.length > 0;

/**
 * Is this deal type actually available in this city?
 *
 * THE BUG THIS REPLACES
 * Availability used to be `govCity && k !== "all"` — the split was disabled
 * wholesale for any city whose HEADLINE series comes from govmap, on the
 * reasoning that govmap carries no build year. True of govmap, and irrelevant
 * to the question: the second-hand and new series in those cities are built
 * from the Tax Authority rows, which do carry build years. Dimona had 102
 * second-hand and 26 new deals in 2026 and both buttons were greyed out with a
 * tooltip explaining a limitation of a channel neither series uses.
 *
 * The city's label was never the right input. The data is: a deal type is
 * offered when its own series clears the display floor in at least one year,
 * and is not offered when it does not — in a govmap city and a nadlan city
 * alike, by the same test.
 */
function dealTypeAvailable(d: CityGraphData, dt: DealType, minN: number): boolean {
  if (dt === "all") return true; // the headline series always exists
  const scope: Scope = dt === "new" ? "new" : "secondhand";
  return d.nadlan[scope].all.some((p) => p.n >= minN && (p.avgSqm != null || p.avgPrice != null));
}

/** TOP of the selection hierarchy (user spec): deal-type first — יד-2 / חדשות / כללי.
 *  Then (for יד-2 only) building modern/old, then room count. The available SERIES
 *  are derived from these choices instead of a flat fixed list. */
type DealType = "sh" | "new" | "all";
const DT_LABEL: Record<DealType, string> = { sh: "יד שנייה", new: "חדשות", all: "כללי" };
const scopeFor = (dt: DealType, ba: Ba, govCity = false) =>
  dt === "sh" ? shScope(ba) : dt === "new" ? "new" : govCity ? "all_govmap" : "all";

const OFFICIAL_DEF: SeriesDef = {
  key: "official", label: "חציון רשמי (₪ עסקה)", short: "רשמי", color: "#b45309", external: true,
  at: (d, _r, m, y) => {
    if (m !== "price") return null; // official median is a total-₪ figure only
    const p = d.median.find((x) => x.year === y);
    return p?.medianPrice != null ? [p.medianPrice, 0] : null;
  },
};

/** Series adapt to the hierarchy choice: avg + median of the chosen deal-type (+ official overlay).
 *  For יד-2, the MIX-ADJUSTED series (fixed neighborhood×rooms basket) is the headline —
 *  the raw median was inflated by sample-composition drift (verified vs repeat-sales). */
const buildSeries = (dt: DealType, minN: number): SeriesDef[] => [
  ...(dt === "sh" ? [{
    // #0f172a, the heaviest ink on the page, because the comment above says this
    // series IS the headline for second-hand — the colour now says so too. It was
    // #4338ca, a violet left over from the palette this project replaced: the one
    // stray reminder of a default theme, sitting in the charts, which are the
    // product. Moving it here forced `med` lighter, and that is the right order:
    // two related teals for the two statistics of one series, near-black for the
    // headline, amber reserved for the external source.
    key: "adj", label: "יד שנייה — מתוקנן-הרכב (₪/מ״ר)", short: "מתוקנן", color: "#0f172a",
    at: (d, r, m, y) => {
      if (m !== "sqm" || r !== "all") return null; // constant-basket construct: ₪/m², all sizes
      const p = stat(d, "secondhand_fixedmix", "all", y);
      return p?.medianSqm != null && p.n >= minN ? [p.medianSqm, p.n] : null;
    },
  } satisfies SeriesDef] : []),
  {
    key: "avg", label: `${DT_LABEL[dt]} — ממוצע`, short: "ממוצע", color: "#0e7490",
    at: (d, r, m, y, ba) => { const p = stat(d, scopeFor(dt, ba, isGovmapCity(d)), r, y); const v = pick(p, m, "avg"); return p && v != null && p.n >= minN ? [v, p.n] : null; },
  },
  {
    key: "med", label: `${DT_LABEL[dt]} — חציון`, short: "חציון", color: "#3aa6bc",
    at: (d, r, m, y, ba) => { const p = stat(d, scopeFor(dt, ba, isGovmapCity(d)), r, y); const v = pick(p, m, "med"); return p && v != null && p.n >= minN ? [v, p.n] : null; },
  },
  OFFICIAL_DEF,
];

const ROOM_CHIPS: { key: RoomKey; label: string }[] = [
  { key: "all", label: "הכל" }, { key: "3", label: "3 חד׳" }, { key: "4", label: "4 חד׳" }, { key: "5", label: "5+ חד׳" },
];

const fmtVal = (v: number, metric: Metric) =>
  metric === "sqm" ? `₪${Math.round(v).toLocaleString("he-IL")}/מ״ר` : `₪${(v / 1_000_000).toFixed(2)}M`;
const fmtAxis = (v: number, metric: Metric) =>
  metric === "sqm" ? `₪${Math.round(v / 1000)}K` : `₪${(v / 1_000_000).toFixed(1)}M`;

export default function MultiChartStudio({ data, deals, dealCounts, cleaning, cityName, modernMinYear = 2005, classificationRate = null, subsidizedYears = [], minSample = DEFAULT_MIN_N }: {
  data: CityGraphData; deals: NadlanDeal[]; dealCounts?: DealCountCube;
  /** what the two cleaning rules held back in this city — shown, never hidden */
  cleaning?: { dupes: number; luxury: number };
  cityName: string; modernMinYear?: number;
  /** share of the city's deals carrying a sale-channel class (lib/classificationRate) — gates the split's confidence */
  classificationRate?: number | null;
  /** city-years whose new-build prices are administered (מחיר למשתכן) */
  subsidizedYears?: Array<{ year: number; share: number; medLow: number | null; medSecondhand: number | null }>;
  /** the live min_deals_per_year rule — the SAME floor the price tables use */
  minSample?: number;
}) {
  const allYears = useMemo(() => {
    const s = new Set<number>([...data.median.map((m) => m.year), ...data.nadlanYears]);
    return [...s].sort((a, b) => a - b);
  }, [data]);
  const minY = allYears[0] ?? 2015, maxY = allYears[allYears.length - 1] ?? 2026;
  // The current year is usually partial (e.g. Jan–Jun) — never a trend endpoint,
  // or the % change reads a half-year against a full year and overstates it.
  const partialSet = useMemo(() => new Set(data.partialYears ?? []), [data]);
  // The endpoint cap is the last USABLE year, not the last full one. A running
  // year with enough months and enough deals is a legitimate endpoint for a
  // RATE like ₪/m² — see lib/nadlanTransactionSeries. Cities whose current year
  // is genuinely thin still fall back to the last full year.
  const maxFullY = data.lastUsableYear ?? data.lastFullYear ?? maxY;
  const endIsPartial = partialSet.has(maxFullY);
  const endMonths = data.monthsByYear?.[maxFullY];

  // Adaptive default window (user rule): until collection completes for a city,
  // open on the years that actually HAVE second-hand data — never an empty-left
  // chart. firstDataYear = earliest year in the latest contiguous run (≤1yr
  // holes tolerated) of valid secondhand points; the window widens automatically
  // as the nightly campaign fills earlier years.
  const firstDataYear = useMemo(() => {
    const years = data.nadlan.secondhand.all
      .filter((p) => p.n >= minSample && p.avgSqm != null)
      .map((p) => p.year)
      .sort((a, b) => a - b);
    if (years.length === 0) return maxY - 10;
    let runStart = years[years.length - 1];
    for (let i = years.length - 2; i >= 0; i--) {
      if (runStart - years[i] <= 2) runStart = years[i];
      else break;
    }
    return runStart;
  }, [data, maxY, minSample]);

  const mobile = useIsMobile(); // compact chart geometry + short labels below 640px
  const [metric, setMetric] = useState<Metric>("sqm");
  // selection hierarchy (top→down): deal-type → building modern/old (יד-2 only) → rooms
  // Default view: second-hand where it exists, "all" otherwise — from the SAME
  // availability test the buttons use, so the tab that opens can never be one
  // the buttons call unavailable. The old default also fell back to "all" below
  // a 20% city-wide classification rate; that judgement now lives in the
  // warning under the chart, where it informs without hiding a series the
  // reader can see is there.
  const [dealType, setDealType] = useState<DealType>(
    dealTypeAvailable(data, "sh", minSample) ? "sh" : "all"
  );
  const [buildingAge, setBuildingAge] = useState<Ba>("all");
  const [room, setRoom] = useState<RoomKey>("all");
  const [from, setFrom] = useState(Math.max(minY, Math.max(firstDataYear, maxY - 10)));
  const [to, setTo] = useState(maxY); // default includes the latest collected year, even when partial
  const [selected, setSelected] = useState<string[]>(["adj", "med"]); // adj = mix-adjusted headline (יד-2 only; harmlessly absent elsewhere)
  const [view, setView] = useState<"overlay" | "grid">("overlay");
  const govCity = useMemo(() => isGovmapCity(data), [data]);
  const seriesDefs = useMemo(() => buildSeries(dealType, minSample), [dealType, minSample]);

  const toggleSeries = (key: string) =>
    setSelected((cur) => cur.includes(key) ? cur.filter((k) => k !== key) : cur.length >= 4 ? cur : [...cur, key]);

  /* MOBILE: median and average only (operator, 8/2026). Four lines on a
     340px chart is a tangle; the mix-adjusted and official series stay
     laptop-only. The chip list AND the drawn lines shrink together, and if
     the user's laptop selection holds neither of the two, median steps in —
     an empty chart is never the answer. */
  const MOBILE_KEYS = ["med", "avg"];
  const chipDefs = mobile ? seriesDefs.filter((s) => MOBILE_KEYS.includes(s.key)) : seriesDefs;
  const effectiveSelected = mobile
    ? (selected.filter((k) => MOBILE_KEYS.includes(k)).length ? selected.filter((k) => MOBILE_KEYS.includes(k)) : ["med"])
    : selected;
  const activeDefs = seriesDefs.filter((s) => effectiveSelected.includes(s.key) && !(s.key === "official" && metric === "sqm"));
  const years = useMemo(() => allYears.filter((y) => y >= from && y <= to), [allYears, from, to]);

  // overlay rows: { year, [key]: value }
  const overlayData = useMemo(() => years.map((y) => {
    const row: Record<string, number | string | null> = { year: String(y) };
    for (const s of activeDefs) row[s.key] = s.at(data, room, metric, y, buildingAge)?.[0] ?? null;
    return row;
  }), [years, activeDefs, data, room, metric, buildingAge]);

  // per-series trend over the visible range (first↔last FULL year with data).
  // Partial years are excluded from the endpoints so the % never reads a half-year.
  const trends = useMemo(() => activeDefs.map((s) => {
    const pts = years
      // A partial year is excluded only when it did NOT qualify as usable.
      // Excluding it unconditionally is what pinned every percentage to a year
      // that gets staler every day, in cities holding hundreds of fresh deals.
      .filter((y) => !partialSet.has(y) || y === maxFullY)
      .map((y) => ({ y, v: s.at(data, room, metric, y, buildingAge) }))
      .filter((p) => p.v != null) as { y: number; v: [number, number] }[];
    if (pts.length < 2) return { def: s, pct: null as number | null, fromY: null as number | null, toY: null as number | null, n: 0 };
    const a = pts[0], b = pts[pts.length - 1];
    return { def: s, pct: (b.v[0] / a.v[0] - 1) * 100, fromY: a.y, toY: b.y, n: pts.reduce((sum, p) => sum + p.v[1], 0) };
  }), [activeDefs, years, data, room, metric, partialSet, buildingAge]);
  /* What the summary box shows: every series with a percentage EXCEPT the
     mix-adjusted one. */
  const trendRows = useMemo(
    () => trends.filter((t) => t.pct != null && t.def.key !== "adj"),
    [trends]
  );
  const hasPartialInRange = useMemo(() => years.some((y) => partialSet.has(y)), [years, partialSet]);

  // Endpoints of the CURRENTLY SELECTED range, not of some fixed window.
  const rangeEnd = Math.min(to, maxFullY);
  const subsidizedEdge = subsidizedYears.find((y) => y.year === from || y.year === rangeEnd) ?? null;
  // How many years the BEST-covered active series actually has in range. 1-2
  // points cannot draw a line, which is what produces a lone floating dot.
  const sparseSeries = useMemo(() => {
    const counts = activeDefs.map((s) => years.filter((y) => s.at(data, room, metric, y, buildingAge) != null).length);
    const best = counts.length ? Math.max(...counts) : 0;
    return best > 0 && best <= 2 ? best : null;
  }, [activeDefs, years, data, room, metric, buildingAge]);
  const latestYearInRange = years.includes(maxY);
  const latestYearHasVisibleData = useMemo(
    () => latestYearInRange && activeDefs.some((s) => s.at(data, room, metric, maxY, buildingAge) != null),
    [latestYearInRange, activeDefs, data, room, metric, maxY, buildingAge]
  );

  /* Everything that qualifies the percentage above, in one list. */
  const caveats = useMemo(() => {
    const out: { short: string; full: string }[] = [];
    if (sparseSeries) out.push({
      short: `${sparseSeries} שנים בלבד`,
      full: `בבחירה הזו יש ${sparseSeries} שנים בלבד עם מספיק עסקאות — הנקודות מבודדות ואין קו רציף`,
    });
    if (hasPartialInRange) out.push({
      short: `${maxY} חלקית`,
      full: `${maxY} היא שנה חלקית ואינה נכנסת לחישוב אחוזי השינוי`,
    });
    if (subsidizedEdge) out.push({
      short: `${subsidizedEdge.year} מחיר מנהלי`,
      full: `${subsidizedEdge.year}: ${Math.round(subsidizedEdge.share * 100)}% מהעסקאות החדשות במחיר מנהלי (מחיר למשתכן) — משפיע על אחוזי השינוי`,
    });
    return out;
  }, [sparseSeries, hasPartialInRange, maxY, subsidizedEdge]);


  // ── drill-down deals ────────────────────────────────────────────────────
  // Counts come from a server-built cube (year × type × age × rooms) so every
  // year tab is exact for every filter, instantly. The deal ROWS are fetched for
  // the open year only. Shipping "the 2,000 most recent deals" was the old bug:
  // in Tel Aviv that is a single year, so the year tabs never reached further back.
  const [dealsYear, setDealsYear] = useState<number>(0); // 0 = whole range
  const countAt = (year: number) => dealCounts?.[`${year}|${dealType}|${dealType === "sh" ? buildingAge : "all"}|${room}`] ?? 0;
  const yearCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const y of years) { const n = countAt(y); if (n > 0) m.set(y, n); }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years, dealCounts, dealType, buildingAge, room]);
  const dealYearTabs = useMemo(() => [...yearCounts.keys()].sort((a, b) => b - a), [yearCounts]);
  const activeDealsYear = dealsYear !== 0 && !yearCounts.has(dealsYear) ? 0 : dealsYear; // filters changed → fall back to whole range
  const rangeTotal = useMemo(() => [...yearCounts.values()].reduce((s, n) => s + n, 0), [yearCounts]);
  const shownTotal = activeDealsYear === 0 ? rangeTotal : (yearCounts.get(activeDealsYear) ?? 0);

  const PAGE = 300;
  const [drawerDeals, setDrawerDeals] = useState<NadlanDeal[]>(deals);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const reqId = useRef(0);

  // Publish what the user is looking at, so the feedback widget can attach it.
  // This state lives only in local useState and never reaches the URL, so
  // without this a report would say "the chart looks wrong" with no way to
  // reproduce which chart.
  useEffect(() => {
    setViewState({
      city: cityName,
      summary: [
        `סוג: ${dealType}`, `גיל בניין: ${buildingAge}`, `חדרים: ${room}`,
        `שנים: ${from}–${to}`, `מדד: ${metric}`,
        `סדרות: ${selected.join(",")}`, `תצוגה: ${view}`,
      ].join(" · "),
    });
    return () => clearViewState();
  }, [cityName, dealType, buildingAge, room, from, to, metric, selected, view]);

  // Which controls people actually touch. Shares the dependency list above
  // rather than instrumenting eight handlers, so a control added later is
  // measured automatically instead of being silently absent.
  //
  // The first pass is the initial render — that is the default view, not a
  // choice — so it is skipped and only deliberate changes are recorded. A short
  // debounce collapses a burst of adjustments (dragging a year, toggling three
  // series) into the one state the user settled on.
  const chartSettled = useRef(false);
  useEffect(() => {
    if (!chartSettled.current) { chartSettled.current = true; return; }
    const t = setTimeout(() => {
      track("chart_action", {
        subject: cityName,
        detail: `${dealType}/${buildingAge}/${room}/${from}-${to}/${metric}/${selected.join("+")}/${view}`,
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [cityName, dealType, buildingAge, room, from, to, metric, selected, view]);

  // Opening the deals table is the strongest signal of intent on the page: it is
  // the moment someone stops reading a trend and goes looking at the individual
  // transactions behind it. Year 0 ("whole range") is the default and not a
  // drill-down, so only a chosen year counts.
  useEffect(() => {
    if (activeDealsYear === 0) return;
    track("drill_down", { subject: cityName, detail: String(activeDealsYear) });
  }, [cityName, activeDealsYear]);

  const dealsUrl = (offset: number) =>
    withBasePath(`/api/city-transactions/${encodeURIComponent(cityName)}`) + "?" + new URLSearchParams({
      year: String(activeDealsYear), from: String(from), to: String(to),
      dealType, buildingAge, room, limit: String(PAGE), offset: String(offset),
    });

  useEffect(() => {
    const id = ++reqId.current;
    const ctl = new AbortController();
    setDrawerLoading(true);
    setDrawerError(null);
    fetch(dealsUrl(0), { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (id === reqId.current) setDrawerDeals(j.deals ?? []); })
      .catch((e) => { if (id === reqId.current && e.name !== "AbortError") setDrawerError("לא הצלחנו לטעון את העסקאות"); })
      .finally(() => { if (id === reqId.current) setDrawerLoading(false); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityName, activeDealsYear, from, to, dealType, buildingAge, room]);

  const loadMore = () => {
    const id = reqId.current; // a filter change invalidates this page
    setLoadingMore(true);
    fetch(dealsUrl(drawerDeals.length))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (id === reqId.current) setDrawerDeals((cur) => [...cur, ...(j.deals ?? [])]); })
      .catch(() => setDrawerError("לא הצלחנו לטעון עוד עסקאות"))
      .finally(() => setLoadingMore(false));
  };

  const quickWin = (n: number | "all") => {
    setTo(maxY); // presets include the latest collected year; trend % still skips partial endpoints
    setFrom(n === "all" ? minY : Math.max(minY, maxY - n));
  };

  const totalShDeals = useMemo(() => data.nadlan.secondhand.all.reduce((s, p) => s + p.n, 0), [data]);
  const totalAllDeals = useMemo(() => data.nadlan.all.all.reduce((s, p) => s + p.n, 0), [data]);
  const cleanedNote = useMemo(() => {
    const parts: string[] = [];
    if (cleaning?.dupes) parts.push(`${cleaning.dupes.toLocaleString("he-IL")} כפילויות דיווח`);
    if (cleaning?.luxury) parts.push(`${cleaning.luxury.toLocaleString("he-IL")} עסקאות יוקרה`);
    return parts.length ? `${parts.join(" ו-")} לא נכללות בממוצעים` : null;
  }, [cleaning]);

  return (
    <div>
      {/* Half the height it was. Three things went: the 16-20px padding, the
          long sentence under the figure, and the separate "המאגר העצמאי · יד-2
          = N+ שנים" block — which on a phone never fitted beside the figure and
          so took a whole line of its own. The second-hand rule is not lost: it
          is in the section's InfoTip, one heading above this box. The cleaning
          note stays reachable too — the gap between "collected" and "priced"
          must be explainable, never silent. */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-xl bg-gradient-to-l from-indigo-700 to-indigo-500 px-3 py-2 text-white shadow-sm sm:px-4 sm:py-2.5">
        <span className="text-xl font-black tabular-nums leading-none sm:text-2xl">{totalAllDeals.toLocaleString("he-IL")}</span>
        <span className="truncate text-2xs text-indigo-100">
          עסקאות · {totalShDeals.toLocaleString("he-IL")} יד-שנייה מסווגות
        </span>
        {cleanedNote && <InfoTip text={cleanedNote} label="מה לא נכלל בממוצעים" />}
      </div>

      {/* govmap-sourced city: one source for the whole decade, labeled (never spliced) */}
      {govCity && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-2xs leading-relaxed text-amber-900">
          <b>מקור נתונים חלופי:</b> ב{cityName} סדרת "כללי" מבוססת על ערוץ govmap של רשות המסים (עסקאות אמת) לכל העשור —
          כי לערוץ nadlan אין כאן כיסוי מספיק. govmap מודד שטח גדול בכ-9%, ולכן ה-₪/מ״ר בו נמוך בכ-10% מערוץ nadlan;
          לכן <b>אין להשוות את הרמה לערים אחרות</b> — המגמה לאורך השנים כן תקפה.
          סדרת &quot;כללי&quot; מגיעה מהערוץ הזה; יד-2 וחדשות, אם הן זמינות כאן, מחושבות מעסקאות רשות המסים שיש בהן שנת בנייה.
        </div>
      )}

      {/* Classification-confidence gate (QA spec 2026-08-13). The new/second-
          hand split is only as honest as the share of deals that carry a BUILD
          YEAR — in בת ים that is ~12%, and a split built on 12% of the market
          is a guess wearing a chart.

          It now INFORMS rather than hides. The old behaviour also forced the
          default to "כללי" below 20% and dropped the columns in the room-size
          table entirely, which meant a city at 15% overall lost cells that had
          sixty perfectly good classified deals in them. The series are offered
          whenever they clear the sample floor; this says how much of the market
          they speak for. */}
      {classificationRate != null && classificationRate < 0.35 && (
        <div className={`mb-4 rounded-xl border px-4 py-2.5 text-xs leading-relaxed ${
          classificationRate < 0.2
            ? "border-amber-300 bg-amber-50 text-amber-800"
            : "border-slate-200 bg-slate-50 text-slate-600"
        }`}>
          {classificationRate < 0.2 ? (
            <><b>פילוח בזהירות:</b> רק ב-{Math.round(classificationRate * 100)}% מהעסקאות ב{cityName} יש שנת בנייה,
            ורק הן נכנסות לסדרות יד-2/חדשות. הסדרות האלה מייצגות חלק קטן מהשוק — &quot;כללי&quot; כולל את כל העסקאות.</>
          ) : (
            <>ב-{Math.round(classificationRate * 100)}% מהעסקאות ב{cityName} יש שנת בנייה, ורק הן נכנסות לסדרות יד-2/חדשות — פילוח חלקי, קרא אותן בזהירות.</>
          )}
        </div>
      )}

      {/* control bar — NOT sticky, at any width (operator, 8/2026). It was
          desktop-sticky once, and the full bar's height meant a third of the
          viewport rode along over the chart it controls. It scrolls. */}
      <div className="mb-4 rounded-2xl border border-indigo-100 bg-indigo-50/90 p-3 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-2">
          {/* row 1 (mobile): metric — two equal buttons */}
          <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-bold sm:inline-flex">
            <button onClick={() => setMetric("sqm")} className={`rounded-md px-2.5 py-1.5 sm:py-1 ${metric === "sqm" ? "bg-indigo-600 text-white" : "text-slate-500"}`}>₪ למ״ר</button>
            <button onClick={() => setMetric("price")} className={`rounded-md px-2.5 py-1.5 sm:py-1 ${metric === "price" ? "bg-indigo-600 text-white" : "text-slate-500"}`}>מחיר עסקה</button>
          </div>
          {/* row 2 (mobile): year range — ONE clean horizontal strip, no mid-button wrapping */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs sm:overflow-visible sm:pb-0">
            <select value={from} onChange={(e) => setFrom(Number(e.target.value))} className="shrink-0 rounded-md border border-slate-200 bg-white px-1.5 py-1">
              {allYears.filter((y) => y < to).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <span className="shrink-0 text-slate-400">–</span>
            <select value={to} onChange={(e) => setTo(Number(e.target.value))} className="shrink-0 rounded-md border border-slate-200 bg-white px-1.5 py-1">
              {allYears.filter((y) => y > from).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <span className="mr-1 flex items-center gap-1">
              {([1, 3, 5, 10] as const).map((n) => (
                <button key={n} onClick={() => quickWin(n)} className="shrink-0 whitespace-nowrap rounded-full border border-slate-200 bg-white px-2 py-1 text-2xs font-bold text-slate-500 hover:border-indigo-300 sm:py-0.5">{n} שנים</button>
              ))}
              <button onClick={() => quickWin("all")} className="shrink-0 whitespace-nowrap rounded-full border border-slate-200 bg-white px-1.5 py-1 text-2xs font-bold text-slate-500 hover:border-indigo-300 sm:py-0.5">הכל</button>
            </span>
          </div>
          {/* row 3 (mobile): view — two equal buttons */}
          <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-bold sm:mr-auto sm:inline-flex">
            <button onClick={() => setView("overlay")} className={`rounded-md px-2.5 py-1.5 sm:py-1 ${view === "overlay" ? "bg-indigo-600 text-white" : "text-slate-500"}`}>גרף משולב</button>
            <button onClick={() => setView("grid")} className={`rounded-md px-2.5 py-1.5 sm:py-1 ${view === "grid" ? "bg-indigo-600 text-white" : "text-slate-500"}`}>רשת גרפים</button>
          </div>
        </div>

        {/* hierarchy (right) + change-in-range summary (LEFT, per user spec);
            mobile: stacked labeled rows, the trend box drops to a full row at the end */}
        <div className="mt-1.5 flex flex-col gap-1.5 border-t border-indigo-100 pt-1.5 sm:mt-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-6 sm:gap-y-2 sm:pt-2.5">
          {/* ONE ROW on laptop (operator, 8/2026): the three filter groups —
              deal type, building, rooms — sit inline with divider bars instead
              of stacking three label rows. Mobile keeps the stacked rows: at
              343px the inline form is a horizontal scroll, not a saving. */}
          <div className="min-w-0 space-y-1 sm:flex sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1 sm:space-y-0">
            {/* flex-nowrap + compact pills: these three rows are the ones the
                screenshot marks. At 375px the phone offers ~343px of row, and
                a "min-w-16" label plus px-3 py-1.5 pills needed ~390-400px —
                so every one of them wrapped. Shorter labels and tighter chips
                bring each row to ~250-290px: one line, in every view. */}
            <div className="flex flex-nowrap items-center gap-1">
              <span className="shrink-0 text-2xs font-bold text-slate-500">סוג עסקה:</span>
              {(["sh", "new", "all"] as DealType[]).map((k) => {
                // Decided by the series, not by the city's source label — see
                // dealTypeAvailable. The tooltip now states the real reason.
                const off = !dealTypeAvailable(data, k, minSample);
                return (
                  <button key={k} disabled={off} onClick={() => !off && setDealType(k)}
                    title={off ? `לא זמין ב${cityName} — אין שנה עם ${minSample}+ עסקאות בעלות שנת בנייה בקטגוריה הזו` : undefined}
                    className={`control-pill shrink-0 whitespace-nowrap px-2 py-1 text-2xs sm:px-3 sm:py-1.5 sm:text-xs ${dealType === k ? "control-pill-active" : ""} ${off ? "cursor-not-allowed opacity-40" : ""}`}>{DT_LABEL[k]}</button>
                );
              })}
            </div>
            {dealType === "sh" && (
              <div className="flex flex-nowrap items-center gap-1 sm:border-s sm:border-indigo-100 sm:ps-3">
                <span className="shrink-0 text-2xs font-bold text-slate-500">בניין:</span>
                {/* The build years moved into the tooltip. "מודרני (2005+)" and
                    "ישן (לפני 2005)" are ~110px of chip each, and with the label
                    this row alone needed ~400px. */}
                {([["all", "הכל", "כל שנות הבנייה"], ["modern", "מודרני", `נבנה ב-${modernMinYear} ואילך`], ["old", "ישן", `נבנה לפני ${modernMinYear}`]] as [Ba, string, string][]).map(([k, l, t]) => (
                  <button key={k} title={t} onClick={() => setBuildingAge(k)} className={`control-pill shrink-0 whitespace-nowrap px-2 py-1 text-2xs sm:px-3 sm:py-1.5 sm:text-xs ${buildingAge === k ? "control-pill-active" : ""}`}>{l}</button>
                ))}
              </div>
            )}
            <div className="flex flex-nowrap items-center gap-1 sm:border-s sm:border-indigo-100 sm:ps-3">
              <span className="shrink-0 text-2xs font-bold text-slate-500">חדרים:</span>
              {ROOM_CHIPS.map((c) => (
                <button key={c.key} onClick={() => setRoom(c.key)} className={`control-pill shrink-0 whitespace-nowrap px-2 py-1 text-2xs sm:px-3 sm:py-1.5 sm:text-xs ${room === c.key ? "control-pill-active" : ""}`}>{c.label}</button>
              ))}
            </div>
          </div>
          {/* change-in-range — desktop: NEXT TO the filters at the left edge (RTL end);
              mobile: its own full-width row so it never squeezes the pill rows */}
          {/* LAPTOP: three times the height, the % is the hero (operator,
              8/2026) — a min-height of 8.5rem vs the old ~2.75rem line, the
              content vertically centered, and the TrendValue jumps to
              !text-3xl. Mobile keeps the compact one-line form. */}
          <aside className="flex w-full flex-col justify-center rounded-xl border border-indigo-100 bg-white/80 px-3 py-1.5 text-center sm:min-h-[8.5rem] sm:w-auto sm:min-w-[13rem] sm:shrink-0 sm:px-5 sm:py-3">
            {/* ONE line per series, and no separate title row. The box used to
                open with "שינוי <years>" and a second line naming the basis
                ("יד שנייה · ₪ למ״ר") before any number appeared, then listed
                the mix-adjusted series above the plain one — five lines before
                the caveats. Now the years ride beside the value, the basis is
                the ⓘ, and "מתוקנן" — a constant-basket construct that belongs
                in the chart, read against the raw series — is not in the
                one-number summary at all. */}
            {trendRows.map((tr) => (
              <div key={tr.def.key} className="flex flex-wrap items-center justify-center gap-x-1.5 leading-tight sm:flex-col sm:gap-y-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tr.def.color }} />
                  <span className="text-2xs font-bold text-slate-500">{tr.def.short}</span>
                  <InfoTip
                    label="על מה מחושב השינוי"
                    text={`${dealType === "sh" ? "יד שנייה" : dealType === "new" ? "דירות חדשות" : "כל העסקאות"} · ${metric === "sqm" ? "₪ למ״ר" : "מחיר עסקה"}${room !== "all" ? ` · ${room} חד׳` : ""} · החלון נגמר בשנה המלאה האחרונה`}
                  />
                </span>
                <TrendValue pct={tr.pct!} className="!text-base !font-black sm:!text-3xl" />
                <span className="text-2xs text-slate-400"><YearRange from={from} to={Math.min(to, maxFullY)} /></span>
              </div>
            ))}
            {trendRows.length === 0 && (
              <div className="flex items-center justify-center gap-1 text-2xs font-bold text-slate-500">
                שינוי <YearRange from={from} to={Math.min(to, maxFullY)} /> <span className="text-sm text-slate-300">—</span>
              </div>
            )}
            {/* THE CAVEATS, COLLAPSED. Each of these used to be its own line of
                small print, and on a phone the three of them were most of this
                box — the box the operator asked to halve. They are conditional
                and none is dropped: they become one ⚠ that opens the full text.
                An isolated dot with no line, a partial end year and an
                administered-price endpoint all change how the percentage above
                should be read, so hiding them was never an option. */}
            {caveats.length > 0 && (
              <div className="mt-0.5 flex items-center justify-center gap-1 text-2xs font-semibold text-amber-700">
                <Icon name="warning" size="1em" />
                <span className="truncate">{caveats.length === 1 ? caveats[0].short : `${caveats.length} הערות`}</span>
                <InfoTip label="הערות על החישוב" text={caveats.map((c) => c.full).join(" · ")} />
              </div>
            )}
          </aside>
        </div>

        {/* series — derived from the hierarchy choice above */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-indigo-100 pt-2.5">
          <span className="text-2xs font-bold text-slate-500">סדרות:</span>
          {chipDefs.map((s) => {
            const on = effectiveSelected.includes(s.key);
            const disabled = s.key === "official" && metric === "sqm";
            return (
              <button key={s.key} onClick={() => !disabled && toggleSeries(s.key)}
                title={disabled ? "החציון הרשמי הוא מחיר עסקה כולל — זמין במצב ׳מחיר עסקה׳" : s.label}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-bold transition-colors ${
                  disabled ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300"
                  : on ? "border-transparent text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300"
                }`}
                style={on && !disabled ? { backgroundColor: s.color } : undefined}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: on ? "#fff" : s.color }} />
                {/* mobile: the short name (full label stays in title + tooltip); desktop: full */}
                <span className="sm:hidden">{s.short}{s.external ? <> <Icon name="source-official" size="1em" /></> : ""}</span>
                <span className="hidden sm:inline">{s.label}{s.external ? <> <Icon name="source-official" size="1em" /></> : ""}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* chart(s) */}
      {view === "overlay" ? (
        <div className="glass-card mb-4 p-4 sm:p-5">
          {activeDefs.length === 0 ? (
            <div className="flex h-[160px] items-center justify-center text-sm text-slate-400">בחר לפחות סדרה אחת למעלה</div>
          ) : (
            <ResponsiveContainer width="100%" height={mobile ? 260 : 340} initialDimension={{ width: 600, height: 340 }}>
              <ComposedChart data={overlayData} margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="year" tick={{ fill: AXIS, fontSize: mobile ? 10 : 11, fontWeight: 700 }} axisLine={false} tickLine={false} interval={mobile ? "preserveStartEnd" : 0} minTickGap={mobile ? 14 : 5} />
                <YAxis tick={{ fill: AXIS, fontSize: mobile ? 10 : 11 }} axisLine={false} tickLine={false} width={mobile ? 40 : 56} tickFormatter={(v) => fmtAxis(v, metric)} domain={[(dataMin: number) => Math.floor(dataMin * 0.85), (dataMax: number) => Math.ceil(dataMax * 1.03)]} />
                <Tooltip contentStyle={{ ...tooltipStyle }}
                  formatter={tipFmt((value, name) => [fmtVal(value, metric), seriesDefs.find((s) => s.key === name)?.label ?? name])} />
                {/* mobile: legend on TOP with short names — the bottom legend wrapped
                    to 3-4 lines inside the fixed box and sat on the X axis */}
                <Legend verticalAlign={mobile ? "top" : "bottom"}
                  formatter={(v) => { const d = seriesDefs.find((s) => s.key === v); return d ? (mobile ? d.short : d.label) : String(v); }}
                  wrapperStyle={{ fontSize: 11, ...(mobile ? { paddingBottom: 6 } : {}) }} />
                {activeDefs.map((s) => (
                  // a year suppressed for thin sample is a GAP, not a smooth segment
                  <Line isAnimationActive={false} key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={s.external ? 2 : 3}
                    connectNulls={false} dot={{ r: 3, fill: s.color, strokeWidth: 0 }} activeDot={{ r: 5 }}
                    strokeDasharray={s.external ? "6 3" : undefined} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          )}
          {/* Routine legend — LAPTOP ONLY (operator, 8/2026): under the chart
              on a phone this was a paragraph of small print. The partial-year
              warning below stays on both — it changes how the numbers read.
              (The old "גרירת הטווח בסרגל למעלה" line is gone everywhere: there
              is no drag bar, only the year selects — stale copy.) */}
          <div className="mt-2 hidden text-2xs leading-relaxed text-slate-500 sm:block">
            שנה עם פחות מ-{minSample} עסקאות לא מוצגת — הקו נשבר שם, לא מגושר · <Icon name="source-own" size="1em" /> סדרות המאגר העצמאי · <Icon name="source-official" size="1em" /> חציון רשמי (קו מקווקו, ₪ עסקה){room !== "all" ? " · פילוח גודל חל על סדרות המאגר בלבד" : ""}
          </div>
          {latestYearInRange && partialSet.has(maxY) && (
            <p className="mt-2 text-2xs leading-relaxed text-amber-700">
              {latestYearHasVisibleData
                ? (endIsPartial && maxFullY === maxY
                    ? `${maxY} היא שנה חלקית (${endMonths} חודשים שנקלטו עד כה) ומשמשת כנקודת הסיום`
                    : `${maxY} מוצגת כשנה חלקית — אחוזי השינוי מחושבים עד ${maxFullY}`)
                : `ב-${maxY} אין מספיק עסקאות לבחירה הנוכחית, ולכן אין נקודה בסדרה`}
            </p>
          )}
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {activeDefs.map((s) => {
            const rows = years.map((y) => {
              // buildingAge was missing here: grid view ignored the modern/old
              // choice and always read the "all" second-hand scope.
              const v = s.at(data, room, metric, y, buildingAge);
              return { year: String(y), price: v?.[0] ?? null, n: v?.[1] ?? 0 };
            });
            return (
              <div key={s.key} className="glass-card p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h4 className="flex items-center gap-2 text-sm font-black text-slate-900">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </h4>
                  <SourceBadge kind={s.external ? "external" : "internal"} name={s.external ? "גוב-נדלן" : undefined} />
                </div>
                <ResponsiveContainer width="100%" height={200} initialDimension={{ width: 600, height: 200 }}>
                  <ComposedChart data={rows} margin={{ top: 4, right: 8, left: 4, bottom: 2 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                    <XAxis dataKey="year" tick={{ fill: AXIS, fontSize: mobile ? 10 : 11, fontWeight: 700 }} axisLine={false} tickLine={false} interval={mobile ? "preserveStartEnd" : 0} minTickGap={mobile ? 14 : 5} />
                    <YAxis tick={{ fill: AXIS, fontSize: mobile ? 10 : 11 }} axisLine={false} tickLine={false} width={mobile ? 40 : 48} tickFormatter={(v) => fmtAxis(v, metric)} domain={[(dataMin: number) => Math.floor(dataMin * 0.85), (dataMax: number) => Math.ceil(dataMax * 1.03)]} />
                    <YAxis yAxisId="vol" hide domain={[0, (max: number) => max * 4]} />
                    <Tooltip contentStyle={{ ...tooltipStyle }}
                      formatter={tipFmt((value, name) => name === "n" ? [Number(value).toLocaleString("he-IL"), "עסקאות"] : [fmtVal(value, metric), s.label])} />
                    {!s.external && <Bar isAnimationActive={false} yAxisId="vol" dataKey="n" fill="#b5e2ea" opacity={0.5} radius={[2, 2, 0, 0]} maxBarSize={18} />}
                    <Line isAnimationActive={false} type="monotone" dataKey="price" stroke={s.color} strokeWidth={2.5} connectNulls={false} dot={{ r: 2.5, fill: s.color, strokeWidth: 0 }} activeDot={{ r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
      )}

      {/* underlying deals drill-down — follows EVERY graph filter, with a tab per year */}
      <div className="glass-card p-4 sm:p-5">
        {/* mobile: one horizontal scroll strip (12 wrapped year-pills ate ~4 rows) */}
        <div className="mb-2 flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          <span className="shrink-0 text-2xs font-bold text-slate-500">עסקאות לפי שנה:</span>
          <button onClick={() => setDealsYear(0)} className={`control-pill shrink-0 whitespace-nowrap ${activeDealsYear === 0 ? "control-pill-active" : ""}`}>כל הטווח</button>
          {dealYearTabs.map((y) => (
            <button key={y} onClick={() => setDealsYear(y)} className={`control-pill shrink-0 whitespace-nowrap ${activeDealsYear === y ? "control-pill-active" : ""}`}>
              {y} <span className="opacity-60">({(yearCounts.get(y) ?? 0).toLocaleString("he-IL")})</span>
            </button>
          ))}
        </div>
        {drawerError ? (
          <p className="py-6 text-center text-xs text-slate-500">{drawerError}</p>
        ) : drawerLoading && drawerDeals.length === 0 ? (
          <div className="space-y-1.5 py-3" aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-7 animate-pulse rounded bg-slate-100" />)}
          </div>
        ) : (
          <div className={drawerLoading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <DealsDrawer deals={drawerDeals} accent="indigo" total={shownTotal} onLoadMore={loadMore} loadingMore={loadingMore} />
          </div>
        )}
        <div className="mt-2 hidden text-2xs text-slate-500 sm:block">
          <Icon name="source-own" size="1em" /> העסקאות מאחורי הגרף · מסונן לפי {DT_LABEL[dealType]}{dealType === "sh" && buildingAge !== "all" ? ` · בניין ${buildingAge === "modern" ? "מודרני" : "ישן"}` : ""} · {room === "all" ? "כל הגדלים" : `${room} חד׳`} · {activeDealsYear === 0 ? `${from}–${to}` : `שנת ${activeDealsYear}`}
        </div>
      </div>
    </div>
  );
}
