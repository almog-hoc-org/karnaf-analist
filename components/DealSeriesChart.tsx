"use client";

import { ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceDot } from "recharts";
import { BRAND, GRID, AXIS, SLATE, INK, tooltipStyle, tipFmt } from "@/lib/chartColors";
import { useIsMobile } from "@/lib/useIsMobile";

/**
 * The area's second-hand ₪/m² by year with ONE deal on it — the deal page's
 * "where did this sale sit in its market" picture. Holes stay holes, as in
 * NeighborhoodTrendChart: a missing year had too few deals to price.
 */
export default function DealSeriesChart({ series, deal, hoodName }: {
  series: Array<{ year: number; hood: number | null; city: number | null }>;
  deal: { year: number; sqm: number };
  hoodName: string | null;
}) {
  const mobile = useIsMobile();
  if (!series.length) return null;
  const years = [...series.map((s) => s.year), deal.year];
  const min = Math.min(...years), max = Math.max(...years);
  const by = new Map(series.map((s) => [s.year, s]));
  const data = Array.from({ length: max - min + 1 }, (_, i) => {
    const y = min + i;
    return { year: y, hood: by.get(y)?.hood ?? null, city: by.get(y)?.city ?? null };
  });
  const hasHood = series.some((s) => s.hood != null);
  const fmt = (v: number) => `₪${Math.round(v).toLocaleString("he-IL")}`;
  const name = (k: string) => (k === "hood" ? `שכונת ${hoodName ?? ""}` : k === "city" ? "העיר" : "העסקה");

  return (
    <div className="w-full" dir="ltr">
      <ResponsiveContainer width="100%" height={mobile ? 220 : 260} initialDimension={{ width: 600, height: 260 }}>
        <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <XAxis dataKey="year" type="number" domain={[min, max]} allowDecimals={false} tick={{ fill: AXIS, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} />
          <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={48}
            tickFormatter={(v: number) => `${Math.round(v / 1000)}K`} domain={["auto", "auto"]} />
          <Tooltip contentStyle={{ ...tooltipStyle, direction: "rtl" }} labelStyle={{ color: SLATE }}
            formatter={tipFmt((value, n) => [fmt(value), name(n)])} />
          <Legend formatter={(v: string) => name(v)} wrapperStyle={{ fontSize: 12 }} />
          {hasHood && <Line dataKey="hood" stroke={BRAND} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />}
          <Line dataKey="city" stroke={SLATE} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls={false} />
          <ReferenceDot x={deal.year} y={deal.sqm} r={7} fill="#f59e0b" stroke={INK} strokeWidth={1.5} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="mt-1 text-center text-2xs text-slate-500" dir="rtl">● העסקה הזו · ₪ למ״ר יד-שנייה לפי שנה</p>
    </div>
  );
}
