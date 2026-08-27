"use client";

import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { BRAND, INK, GRID, AXIS, SLATE, tooltipStyle, tipFmt } from "@/lib/chartColors";
import { useIsMobile } from "@/lib/useIsMobile";
import type { HoodTrendPoint } from "@/lib/neighborhoodPage";

/**
 * One neighbourhood's decade: ₪/m² as lines, deal volume as bars.
 *
 * ANNUAL, AND HOLES STAY HOLES. The cells behind this exist only for years
 * that cleared the sample floor, so a missing year is information — "too few
 * deals to price" — and connectNulls would repaint it as a smooth market.
 * The full year axis is built here, with nulls where the data has none, so
 * the line visibly breaks.
 *
 * Two price lines on purpose: the mean is the series the table beside the
 * map quotes, the median is what one penthouse cannot move. When the two
 * diverge, that gap IS the finding, and hiding either would hide it.
 */
export default function NeighborhoodTrendChart({ trend, metric = "sqm" }: {
  trend: HoodTrendPoint[];
  /** which axis: ₪/m² (avg+median per m²) or the whole-deal price */
  metric?: "sqm" | "price";
}) {
  const mobile = useIsMobile();
  if (!trend.length) return null;

  const years = trend.map((t) => t.year);
  const min = Math.min(...years), max = Math.max(...years);
  const byYear = new Map(trend.map((t) => [t.year, t]));
  const data = Array.from({ length: max - min + 1 }, (_, i) => {
    const y = min + i;
    const t = byYear.get(y);
    return metric === "sqm"
      ? { year: y, avgLine: t?.sqm ?? null, medLine: t?.medianSqm ?? null, n: t?.n ?? null }
      : { year: y, avgLine: t?.avgPrice ?? null, medLine: t?.medianPrice ?? null, n: t?.n ?? null };
  });

  const fmt = (v: number) => `₪${Math.round(v).toLocaleString("he-IL")}`;
  const unit = metric === "sqm" ? '₪/מ"ר' : "₪ עסקה";

  return (
    <div className="w-full" dir="ltr">
      <ResponsiveContainer width="100%" height={mobile ? 220 : 280} initialDimension={{ width: 600, height: 280 }}>
        <ComposedChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <XAxis dataKey="year" tick={{ fill: AXIS, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} />
          <YAxis
            yAxisId="price"
            tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={48}
            tickFormatter={(v: number) => (metric === "sqm" ? `${Math.round(v / 1000)}K` : `${(v / 1_000_000).toFixed(1)}M`)}
            domain={["auto", "auto"]}
          />
          <YAxis yAxisId="n" orientation="right" hide domain={[0, (m: number) => m * 3]} />
          <Tooltip
            contentStyle={{ ...tooltipStyle, direction: "rtl" }}
            labelStyle={{ color: SLATE }}
            formatter={tipFmt((value, name) =>
              name === "n"
                ? [`${Math.round(value).toLocaleString("he-IL")}`, "עסקאות"]
                : [fmt(value), name === "avgLine" ? `ממוצע ${unit}` : `חציון ${unit}`]
            )}
          />
          <Legend
            formatter={(v: string) =>
              v === "avgLine" ? `ממוצע ${unit}` : v === "medLine" ? `חציון ${unit}` : "עסקאות"
            }
            wrapperStyle={{ fontSize: 12 }}
          />
          <Bar yAxisId="n" dataKey="n" fill={GRID} radius={[3, 3, 0, 0]} maxBarSize={26} />
          <Line yAxisId="price" dataKey="avgLine" stroke={BRAND} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
          <Line yAxisId="price" dataKey="medLine" stroke={INK} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
