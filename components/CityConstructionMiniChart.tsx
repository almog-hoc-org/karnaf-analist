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
import { BRAND, INK, BRAND_LIGHT, SLATE, AXIS, tooltipStyle } from "@/lib/chartColors";

interface DataPoint {
  year: number;
  permits: number | null;
  starts: number | null;
  completions: number | null;
  housingNeed: number | null;
}

export default function CityConstructionMiniChart({
  data,
  cityName,
}: {
  data: DataPoint[];
  cityName: string;
}) {
  if (!data || data.length === 0) return null;

  // Filter to only show years with at least some data
  const chartData = data.filter(
    (d) => d.permits || d.starts || d.completions || d.housingNeed
  );

  if (chartData.length === 0) return null;

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <XAxis
            dataKey="year"
            tick={{ fill: AXIS, fontSize: 11 }}
            axisLine={{ stroke: AXIS }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: AXIS, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={{ ...tooltipStyle, direction: "rtl" }}
            labelStyle={{ color: SLATE }}
            formatter={(value: number, name: string) => {
              const labels: Record<string, string> = {
                permits: "היתרי בנייה",
                starts: "התחלות בנייה",
                completions: "גמר בנייה",
                housingNeed: "צורך בדירות",
              };
              return [value?.toLocaleString("he-IL") ?? "—", labels[name] || name];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: "10px", direction: "rtl" }}
            formatter={(value: string) => {
              const labels: Record<string, string> = {
                permits: "היתרי בנייה",
                starts: "התחלות",
                completions: "גמר",
                housingNeed: "צורך בדירות",
              };
              return labels[value] || value;
            }}
          />
          <Bar dataKey="permits" fill={BRAND} opacity={0.7} radius={[2, 2, 0, 0]} />
          <Bar dataKey="starts" fill={INK} opacity={0.7} radius={[2, 2, 0, 0]} />
          <Bar dataKey="completions" fill={BRAND_LIGHT} opacity={0.7} radius={[2, 2, 0, 0]} />
          <Line
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
