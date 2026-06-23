"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { motion } from "framer-motion";

interface PopulationDataPoint {
  year: number;
  population: number | null;
  source: string | null;
}

interface PopulationChartProps {
  data: PopulationDataPoint[];
  cityName: string;
}

export default function PopulationChart({ data, cityName }: PopulationChartProps) {
  if (!data || data.length < 2) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
        אין מספיק נתוני אוכלוסייה להצגת גרף
      </div>
    );
  }

  const chartData = data
    .filter((d) => d.population !== null)
    .map((d) => ({
      year: d.year.toString(),
      אוכלוסייה: d.population,
      source: d.source,
    }));

  const sourceColors: Record<string, string> = {
    "data.gov.il_registry_2019": "#22d3ee",
    "data.gov.il_registry_2026": "#22d3ee",
    "census_2022": "#a78bfa",
    "cbs_permits_2024": "#34d399",
    "cbs_original": "#60a5fa",
    "cbs_projection_2026": "#fbbf24",
    "interpolated": "#71717a",
    "extrapolated": "#71717a",
    "estimated": "#71717a",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut", delay: 0.15 }}
    >
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart
          data={chartData}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
        >
          <defs>
            <linearGradient id="popGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#e2e8f0"
            vertical={false}
          />
          <XAxis
            dataKey="year"
            tick={{ fill: "#64748b", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#64748b", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={60}
            tickFormatter={(v: number) =>
              v >= 1000000
                ? `${(v / 1000000).toFixed(1)}M`
                : v >= 1000
                ? `${(v / 1000).toFixed(0)}K`
                : v.toString()
            }
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              color: "#0f172a",
              fontSize: 12,
            }}
            formatter={(value: number) => [
              value.toLocaleString("he-IL"),
              "אוכלוסייה",
            ]}
            labelFormatter={(label) => `שנת ${label}`}
          />
          <Area
            type="monotone"
            dataKey="אוכלוסייה"
            stroke="#22d3ee"
            fill="url(#popGradient)"
            strokeWidth={2}
            dot={(props: Record<string, unknown>) => {
              const { cx, cy, payload } = props as { cx: number; cy: number; payload: { source: string } };
              const color = sourceColors[payload.source] || "#71717a";
              return (
                <circle
                  key={`dot-${cx}-${cy}`}
                  cx={cx}
                  cy={cy}
                  r={4}
                  fill={color}
                  stroke="#e2e8f0"
                  strokeWidth={2}
                />
              );
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-3 mt-2 justify-center text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" /> מרשם אוכלוסין</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400 inline-block" /> מפקד 2022</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> למ&quot;ס 2024</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-zinc-500 inline-block" /> אינטרפולציה</span>
      </div>
    </motion.div>
  );
}
