"use client";

import { useMemo, useState } from "react";
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { CityGraphData, NadlanDeal, RoomKey, StatPoint } from "@/lib/nadlanTransactionSeries";
import DealsDrawer from "./DealsDrawer";
import TrendValue from "./TrendValue";
import SourceBadge from "./SourceBadge";
import { BRAND, GRID, AXIS, tooltipStyle } from "@/lib/chartColors";

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
const MIN_N = 10;

interface SeriesDef {
  key: string;
  label: string;
  short: string;
  color: string;
  external?: boolean;
  /** returns [value, n] for a year under a metric+room, or null */
  at: (data: CityGraphData, room: RoomKey, metric: Metric, year: number) => [number, number] | null;
}

const pick = (p: StatPoint | undefined, metric: Metric, which: "avg" | "med"): number | null => {
  if (!p) return null;
  if (metric === "sqm") return which === "avg" ? p.avgSqm : p.medianSqm;
  return which === "avg" ? p.avgPrice : p.medianPrice;
};

const stat = (d: CityGraphData, scope: "all" | "secondhand" | "new", room: RoomKey, year: number) =>
  d.nadlan[scope][room].find((p) => p.year === year);

const SERIES_DEFS: SeriesDef[] = [
  {
    key: "sh_avg", label: "יד-2 ממוצע", short: "יד-2 ממ׳", color: "#0e7490",
    at: (d, r, m, y) => { const p = stat(d, "secondhand", r, y); const v = pick(p, m, "avg"); return p && v != null && p.n >= MIN_N ? [v, p.n] : null; },
  },
  {
    key: "sh_med", label: "יד-2 חציון", short: "יד-2 חצ׳", color: "#0f172a",
    at: (d, r, m, y) => { const p = stat(d, "secondhand", r, y); const v = pick(p, m, "med"); return p && v != null && p.n >= MIN_N ? [v, p.n] : null; },
  },
  {
    key: "all_avg", label: "כללי ממוצע", short: "כללי ממ׳", color: "#3aa6bc",
    at: (d, r, m, y) => { const p = stat(d, "all", r, y); const v = pick(p, m, "avg"); return p && v != null && p.n >= MIN_N ? [v, p.n] : null; },
  },
  {
    key: "all_med", label: "כללי חציון", short: "כללי חצ׳", color: "#64748b",
    at: (d, r, m, y) => { const p = stat(d, "all", r, y); const v = pick(p, m, "med"); return p && v != null && p.n >= MIN_N ? [v, p.n] : null; },
  },
  {
    key: "new_avg", label: "חדשות ממוצע", short: "חדשות", color: "#7cc8d6",
    at: (d, r, m, y) => { const p = stat(d, "new", r, y); const v = pick(p, m, "avg"); return p && v != null && p.n >= MIN_N ? [v, p.n] : null; },
  },
  {
    key: "official", label: "חציון רשמי (₪ עסקה)", short: "רשמי", color: "#b45309", external: true,
    at: (d, _r, m, y) => {
      if (m !== "price") return null; // official median is a total-₪ figure only
      const p = d.median.find((x) => x.year === y);
      return p?.medianPrice != null ? [p.medianPrice, 0] : null;
    },
  },
];

const ROOM_CHIPS: { key: RoomKey; label: string }[] = [
  { key: "all", label: "כל הגדלים" }, { key: "3", label: "3 חד׳" }, { key: "4", label: "4 חד׳" }, { key: "5", label: "5+ חד׳" },
];

const fmtVal = (v: number, metric: Metric) =>
  metric === "sqm" ? `₪${Math.round(v).toLocaleString("he-IL")}/מ״ר` : `₪${(v / 1_000_000).toFixed(2)}M`;
const fmtAxis = (v: number, metric: Metric) =>
  metric === "sqm" ? `₪${Math.round(v / 1000)}K` : `₪${(v / 1_000_000).toFixed(1)}M`;

export default function MultiChartStudio({ data, deals, cityName }: {
  data: CityGraphData; deals: NadlanDeal[]; cityName: string;
}) {
  const allYears = useMemo(() => {
    const s = new Set<number>([...data.median.map((m) => m.year), ...data.nadlanYears]);
    return [...s].sort((a, b) => a - b);
  }, [data]);
  const minY = allYears[0] ?? 2015, maxY = allYears[allYears.length - 1] ?? 2026;

  const [metric, setMetric] = useState<Metric>("sqm");
  const [room, setRoom] = useState<RoomKey>("all");
  const [from, setFrom] = useState(Math.max(minY, maxY - 10));
  const [to, setTo] = useState(maxY);
  const [selected, setSelected] = useState<string[]>(["sh_avg", "sh_med"]);
  const [view, setView] = useState<"overlay" | "grid">("overlay");

  const toggleSeries = (key: string) =>
    setSelected((cur) => cur.includes(key) ? cur.filter((k) => k !== key) : cur.length >= 4 ? cur : [...cur, key]);

  const activeDefs = SERIES_DEFS.filter((s) => selected.includes(s.key) && !(s.key === "official" && metric === "sqm"));
  const years = useMemo(() => allYears.filter((y) => y >= from && y <= to), [allYears, from, to]);

  // overlay rows: { year, [key]: value }
  const overlayData = useMemo(() => years.map((y) => {
    const row: Record<string, number | string | null> = { year: String(y) };
    for (const s of activeDefs) row[s.key] = s.at(data, room, metric, y)?.[0] ?? null;
    return row;
  }), [years, activeDefs, data, room, metric]);

  // per-series trend over the visible range (first↔last year with data)
  const trends = useMemo(() => activeDefs.map((s) => {
    const pts = years.map((y) => ({ y, v: s.at(data, room, metric, y) })).filter((p) => p.v != null) as { y: number; v: [number, number] }[];
    if (pts.length < 2) return { def: s, pct: null as number | null, fromY: null as number | null, toY: null as number | null, n: 0 };
    const a = pts[0], b = pts[pts.length - 1];
    return { def: s, pct: (b.v[0] / a.v[0] - 1) * 100, fromY: a.y, toY: b.y, n: pts.reduce((sum, p) => sum + p.v[1], 0) };
  }), [activeDefs, years, data, room, metric]);

  const quickWin = (n: number | "all") => {
    setTo(maxY);
    setFrom(n === "all" ? minY : Math.max(minY, maxY - n));
  };

  const totalShDeals = useMemo(() => data.nadlan.secondhand.all.reduce((s, p) => s + p.n, 0), [data]);
  const totalAllDeals = useMemo(() => data.nadlan.all.all.reduce((s, p) => s + p.n, 0), [data]);

  return (
    <div>
      {/* headline */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-l from-indigo-700 to-indigo-500 p-4 text-white shadow-sm sm:p-5">
        <div>
          <div className="text-2xl font-black tabular-nums leading-none sm:text-3xl">{totalAllDeals.toLocaleString("he-IL")}</div>
          <div className="mt-1 text-[11px] text-indigo-100">עסקאות אמת שנאספו ב{cityName} · מתוכן {totalShDeals.toLocaleString("he-IL")} יד-שנייה מסווגות</div>
        </div>
        <div className="text-[10px] text-indigo-100">🔵 המאגר העצמאי · יד-2 = 3+ שנים משנת בנייה</div>
      </div>

      {/* sticky control bar */}
      <div className="sticky top-16 z-20 mb-4 rounded-2xl border border-indigo-100 bg-indigo-50/90 p-3 shadow-sm backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-bold">
            <button onClick={() => setMetric("sqm")} className={`rounded-md px-2.5 py-1 ${metric === "sqm" ? "bg-indigo-600 text-white" : "text-slate-500"}`}>₪ למ״ר</button>
            <button onClick={() => setMetric("price")} className={`rounded-md px-2.5 py-1 ${metric === "price" ? "bg-indigo-600 text-white" : "text-slate-500"}`}>מחיר עסקה</button>
          </div>
          <div className="flex items-center gap-1.5">
            {ROOM_CHIPS.map((c) => (
              <button key={c.key} onClick={() => setRoom(c.key)} className={`control-pill ${room === c.key ? "control-pill-active" : ""}`}>{c.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <select value={from} onChange={(e) => setFrom(Number(e.target.value))} className="rounded-md border border-slate-200 bg-white px-1.5 py-1">
              {allYears.filter((y) => y < to).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <span className="text-slate-400">–</span>
            <select value={to} onChange={(e) => setTo(Number(e.target.value))} className="rounded-md border border-slate-200 bg-white px-1.5 py-1">
              {allYears.filter((y) => y > from).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <span className="mr-1 flex items-center gap-1">
              {([1, 3, 5, 10] as const).map((n) => (
                <button key={n} onClick={() => quickWin(n)} className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 hover:border-indigo-300">{n}ש׳</button>
              ))}
              <button onClick={() => quickWin("all")} className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 hover:border-indigo-300">הכל</button>
            </span>
          </div>
          <div className="mr-auto inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-bold">
            <button onClick={() => setView("overlay")} className={`rounded-md px-2.5 py-1 ${view === "overlay" ? "bg-indigo-600 text-white" : "text-slate-500"}`}>גרף משולב</button>
            <button onClick={() => setView("grid")} className={`rounded-md px-2.5 py-1 ${view === "grid" ? "bg-indigo-600 text-white" : "text-slate-500"}`}>רשת גרפים</button>
          </div>
        </div>

        {/* series multi-select */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-indigo-100 pt-2.5">
          <span className="text-[10px] font-bold text-slate-500">סדרות (עד 4):</span>
          {SERIES_DEFS.map((s) => {
            const on = selected.includes(s.key);
            const disabled = s.key === "official" && metric === "sqm";
            return (
              <button key={s.key} onClick={() => !disabled && toggleSeries(s.key)}
                title={disabled ? "החציון הרשמי הוא מחיר עסקה כולל — זמין במצב ׳מחיר עסקה׳" : s.label}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                  disabled ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300"
                  : on ? "border-transparent text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300"
                }`}
                style={on && !disabled ? { backgroundColor: s.color } : undefined}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: on ? "#fff" : s.color }} />
                {s.label}{s.external ? " 🏛️" : ""}
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
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={overlayData} margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="year" tick={{ fill: AXIS, fontSize: 12, fontWeight: 700 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => fmtAxis(v, metric)} domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ ...tooltipStyle }}
                  formatter={(value: number, name: string) => [fmtVal(value, metric), SERIES_DEFS.find((s) => s.key === name)?.label ?? name]} />
                <Legend formatter={(v: string) => SERIES_DEFS.find((s) => s.key === v)?.label ?? v} wrapperStyle={{ fontSize: 11 }} />
                {activeDefs.map((s) => (
                  <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={s.key.startsWith("sh") ? 3 : 2}
                    connectNulls dot={{ r: 3, fill: s.color, strokeWidth: 0 }} activeDot={{ r: 5 }}
                    strokeDasharray={s.external ? "6 3" : undefined} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          )}
          <div className="mt-2 text-[10px] leading-relaxed text-slate-500">
            שנה עם פחות מ-{MIN_N} עסקאות לא מוצגת · 🔵 סדרות המאגר העצמאי · 🏛️ חציון רשמי (קו מקווקו, ₪ עסקה) · {room !== "all" ? "פילוח גודל חל על סדרות המאגר בלבד · " : ""}גרירת הטווח בסרגל למעלה
          </div>
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {activeDefs.map((s) => {
            const rows = years.map((y) => {
              const v = s.at(data, room, metric, y);
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
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart data={rows} margin={{ top: 4, right: 8, left: 4, bottom: 2 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                    <XAxis dataKey="year" tick={{ fill: AXIS, fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => fmtAxis(v, metric)} domain={["auto", "auto"]} />
                    <YAxis yAxisId="vol" hide domain={[0, (max: number) => max * 4]} />
                    <Tooltip contentStyle={{ ...tooltipStyle }}
                      formatter={(value: number, name: string) => name === "n" ? [Number(value).toLocaleString("he-IL"), "עסקאות"] : [fmtVal(value, metric), s.label]} />
                    {!s.external && <Bar yAxisId="vol" dataKey="n" fill="#b5e2ea" opacity={0.5} radius={[2, 2, 0, 0]} maxBarSize={18} />}
                    <Line type="monotone" dataKey="price" stroke={s.color} strokeWidth={2.5} connectNulls dot={{ r: 2.5, fill: s.color, strokeWidth: 0 }} activeDot={{ r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
      )}

      {/* trend panel — Δ% per selected series over the chosen range */}
      {trends.length > 0 && (
        <div className="glass-card mb-4 p-4 sm:p-5">
          <h4 className="mb-3 text-sm font-black text-slate-900">שינוי בטווח הנבחר</h4>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {trends.map((tr) => (
              <div key={tr.def.key} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tr.def.color }} />
                  {tr.def.short}{tr.def.external ? " 🏛️" : ""}
                </div>
                {tr.pct != null ? (
                  <>
                    <TrendValue pct={tr.pct} className="!text-xl font-black" />
                    <div className="mt-1 text-[10px] tabular-nums text-slate-400">
                      {tr.fromY}→{tr.toY}{!tr.def.external && tr.n > 0 ? ` · ${tr.n.toLocaleString("he-IL")} עסקאות` : ""}
                    </div>
                  </>
                ) : (
                  <div className="text-lg text-slate-300">—</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* underlying deals drill-down */}
      <div className="glass-card p-4 sm:p-5">
        <DealsDrawer
          deals={deals.filter((d) => (room === "all" || d.roomBucket === room) && d.dealYear >= from && d.dealYear <= to)}
          accent="indigo"
        />
        <div className="mt-2 text-[10px] text-slate-500">🔵 העסקאות הבודדות מאחורי הגרפים · מסונן לפי הגודל והטווח שנבחרו</div>
      </div>
    </div>
  );
}
