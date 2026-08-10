"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { BRAND, INK, BRAND_LIGHT, SLATE, AXIS, tooltipStyle, tipFmt } from "@/lib/chartColors";
import { useIsMobile } from "@/lib/useIsMobile";

interface DataPoint {
  year: number;
  permits: number | null;
  starts: number | null;
  completions: number | null;
  housingNeed: number | null;
}

export default function CityConstructionMiniChart({
  data,
}: {
  data: DataPoint[];
  cityName: string;
}) {
  const mobile = useIsMobile();
  if (!data || data.length === 0) return null;

  // Filter to only show years with at least some data
  const chartData = data.filter(
    (d) => d.permits || d.starts || d.completions || d.housingNeed
  );

  if (chartData.length === 0) return null;

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={mobile ? 200 : 220} initialDimension={{ width: 600, height: 220 }}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <XAxis
            dataKey="year"
            tick={{ fill: AXIS, fontSize: 11 }}
            axisLine={{ stroke: AXIS }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: AXIS, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={{ ...tooltipStyle, direction: "rtl" }}
            labelStyle={{ color: SLATE }}
            formatter={tipFmt((value, name) => {
              const labels: Record<string, string> = {
                permits: "היתרי בנייה",
                starts: "התחלות בנייה",
                completions: "גמר בנייה",
                housingNeed: "צורך בדירות",
              };
              return [value?.toLocaleString("he-IL") ?? "—", labels[name] || name];
            })}
          />
          <Legend
            verticalAlign={mobile ? "top" : "bottom"}
            wrapperStyle={{ fontSize: "11px", direction: "rtl" }}
            formatter={tipFmt((value) => {
              const labels: Record<string, string> = {
                permits: "היתרי בנייה",
                starts: "התחלות",
                completions: "גמר",
                housingNeed: "צורך בדירות",
              };
              return labels[value] || value;
            })}
          />
          <Bar isAnimationActive={false} dataKey="permits" fill={BRAND} opacity={0.7} radius={[2, 2, 0, 0]} />
          <Bar isAnimationActive={false} dataKey="starts" fill={INK} opacity={0.7} radius={[2, 2, 0, 0]} />
          <Bar isAnimationActive={false} dataKey="completions" fill={BRAND_LIGHT} opacity={0.7} radius={[2, 2, 0, 0]} />
          <Line isAnimationActive={false}
            dataKey="housingNeed"
            type="monotone"
            stroke={SLATE}
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={{ fill: SLATE, r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
