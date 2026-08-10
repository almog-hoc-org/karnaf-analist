"use client";

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { BRAND, INK, BRAND_LIGHT, SLATE, GRID, AXIS, tooltipStyle, tipFmt } from "@/lib/chartColors";
import { useIsMobile } from "@/lib/useIsMobile";

interface Point {
  year: number;
  permitsCumulative: number;
  startsCumulative: number;
  completionsCumulative: number;
  targetCumulative: number;
}

export default function PlanVsActualChart({ data }: { data: Point[] }) {
  const mobile = useIsMobile();
  const series = data.map((d) => ({
    year: d.year.toString(),
    "היתרים": d.permitsCumulative,
    "התחלות": d.startsCumulative,
    "גמר בנייה": d.completionsCumulative,
    "יעד הוועדה": d.targetCumulative,
  }));

  return (
    <div style={{ width: "100%", height: mobile ? 300 : 360 }} dir="ltr">
      <ResponsiveContainer initialDimension={{ width: 600, height: 360 }}>
        <ComposedChart data={series} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="year" tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: AXIS }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`}
            width={mobile ? 40 : 50}
          />
          <Tooltip
            formatter={tipFmt((v) => v.toLocaleString("he-IL") + " יח״ד מצטבר")}
            contentStyle={{ ...tooltipStyle, direction: "rtl" }}
          />
          <Legend wrapperStyle={{ fontSize: 11, direction: "rtl" }} />
          {/* Actuals as filled areas — semi-transparent so they stack visually */}
          <Area isAnimationActive={false}
            type="monotone"
            dataKey="היתרים"
            stroke={BRAND}
            fill={BRAND}
            fillOpacity={0.14}
            strokeWidth={2}
          />
          <Area isAnimationActive={false}
            type="monotone"
            dataKey="התחלות"
            stroke={INK}
            fill={INK}
            fillOpacity={0.1}
            strokeWidth={2}
          />
          <Area isAnimationActive={false}
            type="monotone"
            dataKey="גמר בנייה"
            stroke={BRAND_LIGHT}
            fill={BRAND_LIGHT}
            fillOpacity={0.18}
            strokeWidth={2}
          />
          {/* Committee target as the reference benchmark — dashed neutral line */}
          <Line isAnimationActive={false}
            type="linear"
            dataKey="יעד הוועדה"
            stroke={SLATE}
            strokeWidth={2.5}
            strokeDasharray="6 4"
            dot={{ r: 4, fill: SLATE, stroke: SLATE }}
            activeDot={{ r: 6 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
