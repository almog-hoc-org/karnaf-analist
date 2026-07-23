"use client";

import { useEffect, useMemo, useState } from "react";
import { ComposedChart, Line, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { CityGraphData, NadlanDeal, RoomKey, RoomSeries, StatPoint, Scope } from "@/lib/nadlanTransactionSeries";
import DealsDrawer from "./DealsDrawer";
import TrendValue, { fmtSignedPct } from "./TrendValue";
import SourceBadge from "./SourceBadge";
import { BRAND, GRID, AXIS, tooltipStyle } from "@/lib/chartColors";

/**
 * The per-city price graphs — simple and clear by design:
 *   1. מחיר חציוני רשמי — single official-median area.
 *   2. כל העסקאות — ONE price line + deal-volume bars; room size picked via chips.
 *   3. יד שנייה בלבד — same, on build-year-verified second-hand deals only.
 * Rules: one line per graph (chips SWITCH the line, never add lines); a year needs
 * ≥MIN_N deals to earn a price point; default x-window is the latest reliable run
 * (gaps ≤1yr bridged), with a "כל השנים" toggle for old isolated blocks.
 */

const MIN_N = 10; // a year below this deal count is too thin to price
const ROOM_CHIPS: { key: RoomKey; label: string }[] = [
  { key: "all", label: "כל הגדלים" },
  { key: "3", label: "3 חד׳" },
  { key: "4", label: "4 חד׳" },
  { key: "5", label: "5+ חד׳" },
];

type Metric = "sqm" | "price";

const valOf = (p: StatPoint | undefined, metric: Metric): number | null => (!p ? null : metric === "sqm" ? p.avgSqm : p.avgPrice);
const fmtVal = (v: number, metric: Metric) => (metric === "sqm" ? `₪${Math.round(v).toLocaleString("he-IL")}/מ״ר` : `₪${(v / 1_000_000).toFixed(2)}M`);
const fmtAxis = (v: number, metric: Metric) => (metric === "sqm" ? `₪${Math.round(v / 1000)}K` : `₪${(v / 1_000_000).toFixed(1)}M`);

/** Latest run of years with n≥MIN_N, tolerating single-year holes (e.g. 2021,2022,·,2024,2025). */
function latestReliableRun(years: number[]): { from: number; to: number } | null {
  if (years.length === 0) return null;
  const runs: number[][] = [];
  let cur: number[] = [years[0]];
  for (let i = 1; i < years.length; i++) {
    if (years[i] - years[i - 1] <= 2) cur.push(years[i]);
    else { runs.push(cur); cur = [years[i]]; }
  }
  runs.push(cur);
  const last = runs[runs.length - 1];
  return { from: last[0], to: last[last.length - 1] };
}

/** ONE-line price-trend graph with deal-volume bars (graphs 2+3). */
function TrendGraph({
  title, subtitle, series, metric, from, to, deals, accent, sourceLabel, ruleNote,
}: {
  title: string; subtitle: string; series: RoomSeries; metric: Metric;
  from: number; to: number; deals: NadlanDeal[];
  accent: "indigo" | "emerald"; sourceLabel: string; ruleNote?: string;
}) {
  const [bucket, setBucket] = useState<RoomKey>("all");
  const [showAll, setShowAll] = useState(false);

  const idx = useMemo(() => {
    const out = {} as Record<RoomKey, Map<number, StatPoint>>;
    for (const rk of ["3", "4", "5", "all"] as RoomKey[]) out[rk] = new Map(series[rk].map((p) => [p.year, p]));
    return out;
  }, [series]);

  // A thin bucket falls back to "all" so the graph is never emptier than it must be.
  const reliableYears = (rk: RoomKey) => [...idx[rk].keys()].filter((y) => (idx[rk].get(y)?.n ?? 0) >= MIN_N).sort((a, b) => a - b);
  const bucketThin = bucket !== "all" && reliableYears(bucket).length < 3;
  const effBucket: RoomKey = bucketThin ? "all" : bucket;

  const relYears = useMemo(() => reliableYears(effBucket), [effBucket, idx]);
  const run = useMemo(() => latestReliableRun(relYears), [relYears]);
  const hasOlder = run != null && relYears.some((y) => y < run.from);

  const chartData = useMemo(() => {
    const winFrom = showAll || !run ? -Infinity : run.from;
    const years = [...idx[effBucket].keys()].sort((a, b) => a - b)
      .filter((y) => y >= from && y <= to && y >= winFrom);
    return years.map((y) => {
      const p = idx[effBucket].get(y)!;
      return { year: String(y), price: p.n >= MIN_N ? valOf(p, metric) : null, n: p.n };
    });
  }, [idx, effBucket, metric, from, to, showAll, run]);

  const pricePts = chartData.filter((r) => r.price != null);
  const totalN = chartData.reduce((s, r) => s + r.n, 0);
  // trend chips: last-year change + full shown window change
  const lastChg = pricePts.length >= 2 ? ((pricePts[pricePts.length - 1].price! / pricePts[pricePts.length - 2].price!) - 1) * 100 : null;
  const windowChg = pricePts.length >= 2 ? ((pricePts[pricePts.length - 1].price! / pricePts[0].price!) - 1) * 100 : null;

  const accentBar = accent === "emerald" ? "from-emerald-500 to-emerald-300" : "from-indigo-600 to-indigo-400";

  return (
    <div className="relative rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow mb-4 overflow-hidden">
      <div className={`h-1 w-full bg-gradient-to-l ${accentBar}`} />
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 flex-wrap">{title} <SourceBadge kind="internal" /></h3>
            <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
          </div>
          {lastChg != null && (
            <div className="text-left shrink-0">
              <TrendValue pct={lastChg} chip />
              <div className="text-[10px] text-slate-400 mt-0.5">בשנה האחרונה{windowChg != null && pricePts.length > 2 ? ` · ${fmtSignedPct(windowChg)} בחלון המוצג` : ""}</div>
            </div>
          )}
        </div>

        {/* room chips + window toggle */}
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <div className="flex items-center gap-1.5">
            {ROOM_CHIPS.map((c) => (
              <button key={c.key} onClick={() => setBucket(c.key)}
                className={`control-pill ${bucket === c.key ? "control-pill-active" : ""}`}>
                {c.label}
              </button>
            ))}
          </div>
          {hasOlder && (
            <button onClick={() => setShowAll((v) => !v)}
              className="text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 underline decoration-indigo-200 underline-offset-2">
              {showAll ? `הצג רצף אמין (${run!.from}–${run!.to})` : "הצג את כל השנים"}
            </button>
          )}
        </div>
        {bucketThin && (
          <div className="mb-2 text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
            אין עומק מספק ל{ROOM_CHIPS.find((c) => c.key === bucket)?.label} בעיר זו (פחות מ-3 שנים עם {MIN_N}+ עסקאות) — מוצג כלל הגדלים.
          </div>
        )}

        {pricePts.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="year" tick={{ fill: AXIS, fontSize: 12, fontWeight: 700 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="price" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={54}
                tickFormatter={(v) => fmtAxis(v, metric)} domain={["auto", "auto"]} />
              <YAxis yAxisId="vol" orientation="left" hide domain={[0, (max: number) => max * 4]} />
              <Tooltip contentStyle={{ ...tooltipStyle }}
                formatter={(value: number, name: string) =>
                  name === "עסקאות" ? [value.toLocaleString("he-IL"), "עסקאות בשנה"] : [fmtVal(value, metric), "מחיר ממוצע"]} />
              <Bar yAxisId="vol" dataKey="n" name="עסקאות" fill="#c7d2fe" opacity={0.55} radius={[3, 3, 0, 0]} maxBarSize={26} />
              <Line yAxisId="price" type="monotone" dataKey="price" name="מחיר" stroke={BRAND} strokeWidth={3}
                connectNulls dot={{ r: 3.5, fill: BRAND, strokeWidth: 0 }} activeDot={{ r: 6 }} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[120px] flex items-center justify-center text-sm text-slate-400">אין מספיק עסקאות לסינון הנוכחי</div>
        )}

        <DealsDrawer deals={deals.filter((d) => effBucket === "all" || d.roomBucket === effBucket)} accent={accent} />

        <div className="mt-2 text-[10px] text-slate-500 leading-relaxed">
          📊 <strong>{totalN.toLocaleString("he-IL")}</strong> עסקאות בחלון המוצג · עמודות = מספר עסקאות בשנה · שנה עם פחות מ-{MIN_N} עסקאות לא מקבלת נקודת מחיר
          {ruleNote && <> · {ruleNote}</>}
          <br />מקור: {sourceLabel}
        </div>
      </div>
    </div>
  );
}

export default function PriceGraphs({ data, deals, cityName }: { data: CityGraphData; deals: NadlanDeal[]; cityName: string }) {
  const allYears = useMemo(() => {
    const s = new Set<number>([...data.median.map((m) => m.year), ...data.nadlanYears]);
    return [...s].sort((a, b) => a - b);
  }, [data]);

  const [metric, setMetric] = useState<Metric>("sqm");
  const [from, setFrom] = useState<number>(allYears[0] ?? 2016);
  const [to, setTo] = useState<number>(allYears[allYears.length - 1] ?? 2026);
  const [cmpFrom, setCmpFrom] = useState<number>(allYears[0] ?? 2016);
  const [cmpTo, setCmpTo] = useState<number>(allYears[allYears.length - 1] ?? 2026);

  // One time-model: the shared bar's year-range drives the period-comparison too.
  useEffect(() => { setCmpFrom(from); }, [from]);
  useEffect(() => { setCmpTo(to); }, [to]);

  const years = useMemo(() => allYears.filter((y) => y >= from && y <= to), [allYears, from, to]);
  const hasGovmap = useMemo(() => deals.some((d) => d.source === "govmap"), [deals]);

  const dealPass = (d: NadlanDeal, scope: Scope) => {
    if (d.dealYear < from || d.dealYear > to) return false;
    if (scope === "all") { if (hasGovmap ? d.source !== "govmap" : d.source !== "nadlan") return false; }
    else if (d.source !== "nadlan") return false;
    if (scope === "secondhand" && !d.isSecondHand) return false;
    return true;
  };
  const dealsAll = useMemo(() => deals.filter((d) => dealPass(d, "all")), [deals, from, to, hasGovmap]);
  const dealsSH = useMemo(() => deals.filter((d) => dealPass(d, "secondhand")), [deals, from, to, hasGovmap]);

  const medianData = useMemo(() => years.map((y) => {
    const m = data.median.find((x) => x.year === y);
    return { year: String(y), "חציון רשמי": m?.medianPrice ?? null };
  }), [years, data.median]);
  const hasMedian = medianData.some((r) => r["חציון רשמי"] != null);

  // headline totals + second-hand coverage quality
  const cityTotals = useMemo(() => {
    const sum = (arr: StatPoint[]) => arr.reduce((s, p) => s + p.n, 0);
    const shPts = data.nadlan.secondhand.all;
    return {
      all: sum(data.nadlan.all.all), sh: sum(data.nadlan.secondhand.all), nw: sum(data.nadlan.new.all),
      shYears: shPts.length, shMin: shPts[0]?.year ?? null, shMax: shPts[shPts.length - 1]?.year ?? null,
    };
  }, [data]);
  const yearsLabel = data.nadlanYears.length ? `${data.nadlanYears[0]}–${data.nadlanYears[data.nadlanYears.length - 1]}` : "—";
  const shMulti = cityTotals.shYears >= 5;

  return (
    <div>
      {/* ── headline totals ── */}
      <div className="rounded-2xl bg-gradient-to-l from-indigo-700 to-indigo-500 text-white p-4 sm:p-5 mb-4 shadow-sm flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-2xl sm:text-3xl font-extrabold tabular-nums leading-none">{cityTotals.all.toLocaleString("he-IL")}</div>
            <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${shMulti ? "bg-emerald-400/25 text-emerald-50" : "bg-amber-400/25 text-amber-50"}`}>
              {shMulti ? `יד-שנייה רב-שנתי ${cityTotals.shMin}–${cityTotals.shMax}` : "יד-שנייה עומק מוגבל"}
            </span>
          </div>
          <div className="text-[11px] text-indigo-100 mt-1">עסקאות שנאספו ב{cityName} • {yearsLabel} • מאגר הנתונים הפנימי במערכת</div>
        </div>
        <div className="flex gap-4 text-center">
          <div><div className="text-lg font-bold tabular-nums">{cityTotals.sh.toLocaleString("he-IL")}</div><div className="text-[10px] text-indigo-100">יד שנייה</div></div>
          <div className="border-r border-indigo-400/40" />
          <div><div className="text-lg font-bold tabular-nums">{cityTotals.nw.toLocaleString("he-IL")}</div><div className="text-[10px] text-indigo-100">חדשות</div></div>
        </div>
      </div>

      {/* ── shared control bar (metric + years) — sticky ── */}
      <div className="sticky top-16 z-20 rounded-2xl bg-indigo-50/90 backdrop-blur-sm border border-indigo-100 p-3 mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-slate-500">מדד</span>
          <div className="inline-flex rounded-lg bg-white border border-slate-200 p-0.5 text-xs font-bold">
            <button onClick={() => setMetric("sqm")} className={`px-2.5 py-1 rounded-md ${metric === "sqm" ? "bg-indigo-600 text-white" : "text-slate-500"}`}>₪ למ״ר</button>
            <button onClick={() => setMetric("price")} className={`px-2.5 py-1 rounded-md ${metric === "price" ? "bg-indigo-600 text-white" : "text-slate-500"}`}>מחיר עסקה</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-slate-500">שנים</span>
          <select value={from} onChange={(e) => setFrom(Number(e.target.value))} className="text-xs border border-slate-200 rounded-md px-1.5 py-1 bg-white">
            {allYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="text-slate-400">–</span>
          <select value={to} onChange={(e) => setTo(Number(e.target.value))} className="text-xs border border-slate-200 rounded-md px-1.5 py-1 bg-white">
            {allYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <span className="text-[10px] text-slate-400">בחירת גודל דירה — בצ׳יפים שבתוך כל גרף</span>
      </div>

      {/* ── Graph 1: SECOND-HAND — the site's most important series ── */}
      <TrendGraph
        title="מחיר יד שנייה — הנתון המרכזי"
        subtitle="מגמת מחירים אמיתית לדירות יד-שנייה, מעסקאות מאומתות לפי שנת בנייה — ללא הטיית פרויקטים חדשים."
        series={data.nadlan.secondhand}
        metric={metric} from={from} to={to} deals={dealsSH}
        accent="emerald"
        sourceLabel="nadlan.gov.il — רשות המסים, לפי שנת בנייה"
        ruleNote="עסקה נחשבת יד-שנייה כשחלפו 3+ שנים משנת הבנייה"
      />

      {/* ── Graph 2: ALL deals — one line + volume ── */}
      <TrendGraph
        title="מחיר ממוצע — כל העסקאות"
        subtitle="ממוצע שנתי מכלל העסקאות שנאספו (כולל חדשות). בחר גודל דירה בצ׳יפים."
        series={data.nadlan.all}
        metric={metric} from={from} to={to} deals={dealsAll}
        accent="indigo"
        sourceLabel="מאגר הנתונים הפנימי במערכת (מבוסס עסקאות רשות המסים)"
      />

      {/* ── Official source (secondary, clearly labeled): gov median index ── */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 shadow-sm mb-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">מחיר חציוני — מדד רשמי</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">המדד הרשמי של רשות המסים (גוב-נדלן) — מחיר עסקה חציוני (סה״כ ₪), לפי שנה.</p>
          </div>
          <SourceBadge kind="external" name="גוב-נדלן (רשות המסים)" />
        </div>
        {hasMedian ? (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={medianData} margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
              <defs>
                <linearGradient id="medianGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BRAND} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="year" tick={{ fill: AXIS, fontSize: 12, fontWeight: 700 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={54} tickFormatter={(v) => `₪${(v / 1_000_000).toFixed(1)}M`} />
              <Tooltip contentStyle={{ ...tooltipStyle }} formatter={(v: number) => (v == null ? "—" : `₪${(v / 1_000_000).toFixed(2)}M`)} />
              <Area type="monotone" dataKey="חציון רשמי" stroke={BRAND} strokeWidth={3} fill="url(#medianGrad)" connectNulls dot={{ r: 3, fill: BRAND }} activeDot={{ r: 6 }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[100px] flex items-center justify-center text-sm text-slate-400">אין נתוני חציון רשמי לעיר זו</div>
        )}
        <div className="mt-2 text-[10px] text-slate-500">מקור: <strong>nadlan.gov.il</strong> — מדד מחירי עסקאות (חציון){data.median.length ? ` • ${data.median[0].year}–${data.median[data.median.length - 1].year}` : ""}</div>
      </div>

      {/* ── period-comparison ── */}
      <PeriodCompare data={data} metric={metric} allYears={allYears} cmpFrom={cmpFrom} cmpTo={cmpTo} setCmpFrom={setCmpFrom} setCmpTo={setCmpTo} />
    </div>
  );
}

/** Pick two years → Δ% for median, all, second-hand, new (room "all"). */
function PeriodCompare({
  data, metric, allYears, cmpFrom, cmpTo, setCmpFrom, setCmpTo,
}: {
  data: CityGraphData; metric: Metric; allYears: number[];
  cmpFrom: number; cmpTo: number; setCmpFrom: (n: number) => void; setCmpTo: (n: number) => void;
}) {
  const medAt = (y: number) => data.median.find((m) => m.year === y)?.medianPrice ?? null;
  const nadAt = (scope: Scope, y: number) => valOf(data.nadlan[scope].all.find((p) => p.year === y), metric);
  const nis = (v: number | null) => (v == null ? "—" : `₪${Math.round(v).toLocaleString("he-IL")}`);

  const rows: { label: string; from: number | null; to: number | null }[] = [
    { label: "חציון רשמי (₪ עסקה)", from: medAt(cmpFrom), to: medAt(cmpTo) },
    { label: `כל העסקאות (${metric === "sqm" ? "₪/מ״ר" : "₪"})`, from: nadAt("all", cmpFrom), to: nadAt("all", cmpTo) },
    { label: `יד שנייה (${metric === "sqm" ? "₪/מ״ר" : "₪"})`, from: nadAt("secondhand", cmpFrom), to: nadAt("secondhand", cmpTo) },
    { label: `חדשות (${metric === "sqm" ? "₪/מ״ר" : "₪"})`, from: nadAt("new", cmpFrom), to: nadAt("new", cmpTo) },
  ];

  return (
    <div className="rounded-2xl bg-white border-2 border-indigo-100 p-4 sm:p-5 shadow-sm">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <h3 className="text-base font-bold text-slate-900 flex-1">השוואת פרקי זמן</h3>
        <div className="flex items-center gap-1.5 text-xs">
          <select value={cmpFrom} onChange={(e) => setCmpFrom(Number(e.target.value))} className="border border-slate-200 rounded-md px-1.5 py-1 bg-white font-bold">
            {allYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="text-slate-400">→</span>
          <select value={cmpTo} onChange={(e) => setCmpTo(Number(e.target.value))} className="border border-slate-200 rounded-md px-1.5 py-1 bg-white font-bold">
            {allYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {rows.map((r) => {
          const pct = r.from != null && r.to != null && r.from !== 0 ? ((r.to - r.from) / r.from) * 100 : null;
          return (
            <div key={r.label} className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <div className="text-[11px] font-bold text-slate-600 mb-1">{r.label}</div>
              <div className="flex items-baseline justify-between gap-2">
                <span dir="ltr" className="text-sm tabular-nums text-slate-500">{nis(r.from)} <span className="text-slate-300">→</span> <span className="font-bold text-slate-900">{nis(r.to)}</span></span>
                <TrendValue pct={pct} chip />
              </div>
              {pct == null && <div className="text-[10px] text-slate-400 mt-1">אין נתונים לשתי השנים</div>}
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-[10px] text-slate-500">מקור: חציון — nadlan.gov.il הרשמי; ממוצעים (כל/יד-שנייה/חדשות) — מהעסקאות שנאספו (רשות המסים). השוואה ברמת &quot;כללי&quot;.</div>
    </div>
  );
}
