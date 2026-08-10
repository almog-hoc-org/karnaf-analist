"use client";

import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from "recharts";
import type { CbsSalesData } from "@/lib/cbsSales";
import { BRAND_DARK, BRAND_LIGHT, SLATE_LIGHT, SLATE, GRID, AXIS, tipFmt } from "@/lib/chartColors";
import { useIsMobile } from "@/lib/useIsMobile";
import Icon from "@/components/Icon";

/**
 * CBS national apartment transactions — NEW (חדשות) vs SECOND-HAND (יד שנייה).
 * Stacked volume bars + the new-build share as a line. Read-only official data;
 * every value labelled + sourced. CBS publishes this split annually/quarterly
 * (not monthly — the monthly release is new-dwellings only), so the axis is by
 * year with the latest rolling quarter called out beside it.
 */
const fmt = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("he-IL"));

export default function CbsSalesChart({ data }: { data: CbsSalesData }) {
  const mobile = useIsMobile();
  const rows = data.years.map((y) => ({
    year: String(y.year),
    "יד שנייה": y.existing ?? 0,
    "חדשות": y.neww ?? 0,
    'סה״כ': y.totalOnly ?? 0,
    share: y.newSharePct,
  }));

  return (
    <div className="glass-card p-5">
      <div className="section-header mb-4">
        <div className="section-header-icon"><Icon name="building" size="1em" /></div>
        <div>
          <h2 className="text-2xl font-black text-slate-900">עסקאות דירות בישראל — חדשות מול יד שנייה</h2>
          <p className="text-sm text-slate-500">היקף העסקאות הארצי לפי סוג דירה, נתוני הלמ״ס</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* chart */}
        <div className="lg:col-span-2">
          <div style={{ width: "100%", height: mobile ? 240 : 300 }}>
            <ResponsiveContainer initialDimension={{ width: 600, height: 300 }}>
              <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="year" tick={{ fill: AXIS, fontSize: mobile ? 10 : 11 }} axisLine={{ stroke: GRID }} tickLine={false} />
                <YAxis yAxisId="v" width={mobile ? 34 : undefined} tick={{ fill: AXIS, fontSize: mobile ? 10 : 11 }} axisLine={false} tickLine={false}
                  tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                <YAxis yAxisId="s" orientation="right" width={mobile ? 28 : undefined} domain={[0, 60]} unit="%" tick={{ fill: SLATE, fontSize: mobile ? 10 : 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#fff", border: `1px solid ${GRID}`, borderRadius: 12, fontSize: 12, direction: "rtl" }}
                  formatter={tipFmt((val, name) => (name === "share" ? [`${val}%`, "נתח חדשות"] : [fmt(val), name]))}
                />
                <Legend wrapperStyle={{ fontSize: 11, direction: "rtl" }} />
                <Bar isAnimationActive={false} yAxisId="v" dataKey="יד שנייה" stackId="a" fill={BRAND_DARK} radius={[0, 0, 0, 0]} />
                <Bar isAnimationActive={false} yAxisId="v" dataKey="חדשות" stackId="a" fill={BRAND_LIGHT} radius={[4, 4, 0, 0]} />
                <Bar isAnimationActive={false} yAxisId="v" dataKey='סה״כ' stackId="a" fill={SLATE_LIGHT} radius={[4, 4, 0, 0]} />
                <Line isAnimationActive={false} yAxisId="s" dataKey="share" name="share" stroke={SLATE} strokeWidth={2} dot={{ r: 3, fill: SLATE }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-2xs text-slate-400">
            עמודות = מספר עסקאות (יד שנייה + חדשות) · קו = נתח הדירות החדשות (%). 2021–2022: הלמ״ס פרסמה סך-הכול ללא פילוח.
          </p>
        </div>

        {/* insights + latest quarter */}
        <div className="flex flex-col gap-3">
          {data.latestQuarter && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
              <div className="text-2xs font-bold uppercase tracking-wide text-slate-500">הרבעון האחרון · {data.latestQuarter.period}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-900 tabular-nums">{fmt(data.latestQuarter.total)}</span>
                <span className="text-sm text-slate-500">עסקאות</span>
                {data.latestQuarter.yoyPct != null && (
                  <span className={`text-sm font-bold ${data.latestQuarter.yoyPct < 0 ? "text-red-600" : "text-emerald-600"}`}>
                    {data.latestQuarter.yoyPct > 0 ? "+" : ""}{data.latestQuarter.yoyPct}% YoY
                  </span>
                )}
              </div>
              {data.latestQuarter.newSharePct != null && (
                <div className="mt-0.5 text-2xs text-slate-500">{data.latestQuarter.newSharePct}% דירות חדשות</div>
              )}
            </div>
          )}
          <ul className="space-y-2">
            {data.insights.map((t, i) => (
              <li key={i} className="flex gap-2 text-xs leading-snug text-slate-700">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-3 border-t border-slate-100 pt-2 text-2xs text-slate-400">
        מקור: הלמ״ס{data.reportIds.length ? ` · ${data.reportIds.join(" · ")}` : ""}
        {data.updatedAt ? ` · עודכן ${data.updatedAt}` : ""} · פילוח חדשות/יד-שנייה מתפרסם שנתית ורבעונית (לא חודשית).
      </p>
    </div>
  );
}
