"use client";

import { useMemo, useState } from "react";
import InfoTip from "@/components/InfoTip";
import TrendValue from "@/components/TrendValue";
import Icon from "@/components/Icon";
import NeighborhoodTrendChart from "@/components/NeighborhoodTrendChart";
import type { HoodPageData, HoodSeries, HoodBucket, HoodScope } from "@/lib/neighborhoodPage";

/**
 * The neighbourhood page's interactive half: the headline numbers, the
 * filters, and the trend chart — one client component, zero network.
 *
 * ALL THE DATA IS ALREADY HERE. The server ships every scope×rooms series
 * (~80 points worst case), so flipping a filter re-derives locally. This is
 * the same trade the city studio makes, at a fraction of its payload.
 *
 * WHAT THE METRIC TOGGLE DOES AND DOES NOT SWITCH. It switches the chart and
 * the level card between ₪/m² and whole-deal price. The change and
 * excess-growth cards stay on ₪/m² always — that is the site's comparison
 * axis, and a % change figure that silently switched its base between clicks
 * would be two different statistics wearing one label. The cards say so.
 */

const BUCKETS: Array<{ id: HoodBucket; label: string }> = [
  { id: "all", label: "הכל" },
  { id: "3", label: "3 חד׳" },
  { id: "4", label: "4 חד׳" },
  { id: "5", label: "5+ חד׳" },
];
const SCOPES: Array<{ id: HoodScope; label: string }> = [
  { id: "secondhand", label: "יד שנייה" },
  { id: "all", label: "כללי" },
];
const WINDOWS = [3, 5, 10] as const;

export default function HoodTrendStudio({ data, series }: { data: HoodPageData; series: HoodSeries }) {
  const [scope, setScope] = useState<HoodScope>("secondhand");
  const [bucket, setBucket] = useState<HoodBucket>("all");
  const [metric, setMetric] = useState<"sqm" | "price">("sqm");

  const full = series[scope][bucket] ?? [];
  const years = full.map((p) => p.year);
  const minY = years.length ? Math.min(...years) : 0;
  const maxY = years.length ? Math.max(...years) : 0;
  const [from, setFrom] = useState<number | null>(null); // null = full range
  const [to, setTo] = useState<number | null>(null);
  const f = from ?? minY, t = to ?? maxY;

  const trend = useMemo(() => full.filter((p) => p.year >= f && p.year <= t), [full, f, t]);
  const quickWin = (n: number | "all") => {
    if (!years.length) return;
    setTo(null);
    setFrom(n === "all" ? null : Math.max(minY, maxY - n));
  };

  const fmt = (v: number | null) => (v == null ? "—" : `₪${Math.round(v).toLocaleString("he-IL")}`);
  const vsCity =
    data.sqm != null && data.citySqm != null && data.citySqm > 0
      ? (data.sqm / data.citySqm - 1) * 100
      : null;
  const excess =
    data.changePct != null && data.cityChangePct != null
      ? data.changePct - data.cityChangePct
      : null;

  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-2xs font-bold transition sm:px-3 sm:py-1.5 sm:text-xs ${
      active ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
    }`;

  // The level card follows the metric; the two change cards do not (see header).
  const level = metric === "sqm" ? data.sqm : data.medianPrice;
  const levelLabel = metric === "sqm" ? "₪ למ״ר" : "חציון מחיר עסקה";

  return (
    <>
      {/* ── headline numbers ── */}
      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`${levelLabel}${data.refYear ? ` · ${data.refYear}` : ""}`} value={fmt(level)} />
        <Stat
          label={data.fromYear ? `שינוי מ־${data.fromYear} (₪/מ״ר)` : "שינוי (₪/מ״ר)"}
          value={data.changePct == null ? "—" : <TrendValue pct={data.changePct} />}
        />
        <Stat label={`עסקאות ב${data.refYear ?? "שנה"}`} value={data.n == null ? "—" : data.n.toLocaleString("he-IL")} />
        {/* עלייה עודפת — the number the operator asked to see spelled out:
            how much MORE (or less) this hood climbed than its city, same
            window, same cells. Percentage points, not percent-of-percent. */}
        <Stat
          label={
            <span className="inline-flex items-center gap-1">
              מול העיר — עלייה עודפת
              <InfoTip
                label="איך לקרוא את שני המספרים"
                text={`המספר הגדול: בכמה נקודות אחוז עלתה השכונה יותר (או פחות) מהעיר באותו חלון — השכונה ${
                  data.changePct == null ? "—" : `${data.changePct >= 0 ? "+" : ""}${data.changePct.toFixed(1)}%`
                } מול העיר ${
                  data.cityChangePct == null ? "—" : `${data.cityChangePct >= 0 ? "+" : ""}${data.cityChangePct.toFixed(1)}%`
                }. השורה הקטנה: פער הרמה — בכמה אחוזים המחיר למ״ר בשכונה גבוה או נמוך מממוצע העיר כרגע.`}
              />
            </span>
          }
          value={
            excess == null ? "—" : (
              <span className="inline-flex items-baseline gap-1">
                <TrendValue pct={excess} />
                <span className="text-xs font-bold text-slate-500">נק׳</span>
              </span>
            )
          }
          sub={
            vsCity == null
              ? undefined
              : `${vsCity >= 0 ? "יקרה" : "זולה"} ב-${Math.abs(vsCity).toFixed(0)}% מממוצע העיר${
                  data.rank ? ` · ה-${data.rank} מתוך ${data.rankOf}` : ""
                }`
          }
        />
      </section>

      {/* ── the decade, filtered ── */}
      <section className="mb-8">
        <div className="section-header">
          <div className="section-header-icon"><Icon name="chart" size="1em" /></div>
          <div>
            <h2>מגמת המחיר לאורך שנים</h2>
            <p>חור בקו = שנה בלי מספיק עסקאות בפילוח הנוכחי</p>
          </div>
        </div>

        <div className="glass-card p-4 md:p-6">
          {/* controls — one wrapping band, the city studio's visual language */}
          <div className="mb-3 flex flex-col gap-2 border-b border-slate-100 pb-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-bold">
              <button type="button" onClick={() => setMetric("sqm")} className={`rounded-md px-2.5 py-1 ${metric === "sqm" ? "bg-indigo-600 text-white" : "text-slate-600"}`}>₪ למ״ר</button>
              <button type="button" onClick={() => setMetric("price")} className={`rounded-md px-2.5 py-1 ${metric === "price" ? "bg-indigo-600 text-white" : "text-slate-600"}`}>מחיר עסקה</button>
            </div>
            <span className="hidden h-5 w-px bg-slate-200 sm:block" />
            <div className="flex flex-wrap items-center gap-1">
              <span className="shrink-0 text-2xs font-bold text-slate-500">סוג:</span>
              {SCOPES.map((s) => (
                <button key={s.id} type="button" onClick={() => setScope(s.id)} className={chip(scope === s.id)}>{s.label}</button>
              ))}
            </div>
            <span className="hidden h-5 w-px bg-slate-200 sm:block" />
            <div className="flex flex-wrap items-center gap-1">
              <span className="shrink-0 text-2xs font-bold text-slate-500">חדרים:</span>
              {BUCKETS.map((b) => (
                <button key={b.id} type="button" onClick={() => setBucket(b.id)} className={chip(bucket === b.id)}>{b.label}</button>
              ))}
            </div>
            <span className="hidden h-5 w-px bg-slate-200 sm:block" />
            <div className="flex flex-wrap items-center gap-1">
              <span className="shrink-0 text-2xs font-bold text-slate-500">טווח:</span>
              {WINDOWS.map((w) => (
                <button key={w} type="button" onClick={() => quickWin(w)} className={chip(from === Math.max(minY, maxY - w) && to == null)}>
                  {w} שנים
                </button>
              ))}
              <button type="button" onClick={() => quickWin("all")} className={chip(from == null && to == null)}>הכל</button>
            </div>
          </div>

          {trend.length ? (
            <NeighborhoodTrendChart trend={trend} metric={metric} />
          ) : (
            /* An empty COMBINATION, not an empty hood: the floor of 8 deals
               per cell means small hoods publish fewer room buckets. Saying
               which filter emptied it beats a blank chart. */
            <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
              אין מספיק עסקאות בפילוח הזה
              {bucket !== "all" ? ` (${BUCKETS.find((b) => b.id === bucket)?.label})` : ""} —
              כל תא דורש {""}8+ עסקאות בשנה. נסו ״הכל״.
            </p>
          )}
        </div>
      </section>
    </>
  );
}

function Stat({ label, value, sub }: { label: React.ReactNode; value: React.ReactNode; sub?: string }) {
  return (
    <div className="glass-card p-4">
      <p className="text-2xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-2xs text-slate-400">{sub}</p>}
    </div>
  );
}
