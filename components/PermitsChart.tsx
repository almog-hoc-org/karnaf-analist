"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  ComposedChart,
} from "recharts";
import { motion } from "framer-motion";

interface PermitData {
  year: number;
  permits: number | null;
}

interface PermitsChartProps {
  data: PermitData[];
  cityName: string;
}

export default function PermitsChart({ data, cityName }: PermitsChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
        אין נתוני היתרי בנייה
      </div>
    );
  }

  const chartData = data
    .filter((d) => d.permits !== null)
    .map((d) => ({ year: d.year.toString(), היתרים: d.permits }));

  // Calculate trend line
  const permits = chartData.map((d) => d.היתרים ?? 0);
  const avg = permits.reduce((a, b) => a + b, 0) / permits.length;
  const chartDataWithAvg = chartData.map((d) => ({
    ...d,
    ממוצע: Math.round(avg),
  }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut", delay: 0.15 }}
    >
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart
          data={chartDataWithAvg}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
          barCategoryGap="20%"
        >
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
            width={50}
            tickFormatter={(v: number) => v.toLocaleString("he-IL")}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              color: "#0f172a",
              fontSize: 12,
            }}
            formatter={(value: number, name: string) => [
              value.toLocaleString("he-IL"),
              name,
            ]}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Bar
            dataKey="היתרים"
            fill="#f59e0b"
            radius={[4, 4, 0, 0]}
            maxBarSize={50}
          />
          <Line
            dataKey="ממוצע"
            stroke="#ef4444"
            strokeDasharray="5 5"
            dot={false}
            strokeWidth={2}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
