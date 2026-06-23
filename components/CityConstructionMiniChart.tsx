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
            tick={{ fill: "#64748b", fontSize: 11 }}
            axisLine={{ stroke: "#3f3f46" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              fontSize: "12px",
              direction: "rtl",
            }}
            labelStyle={{ color: "#64748b" }}
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
          <Bar dataKey="permits" fill="#f59e0b" opacity={0.7} radius={[2, 2, 0, 0]} />
          <Bar dataKey="starts" fill="#22c55e" opacity={0.7} radius={[2, 2, 0, 0]} />
          <Bar dataKey="completions" fill="#06b6d4" opacity={0.7} radius={[2, 2, 0, 0]} />
          <Line
            dataKey="housingNeed"
            type="monotone"
            stroke="#ef4444"
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={{ fill: "#ef4444", r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
