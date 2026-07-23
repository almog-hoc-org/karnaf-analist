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
import { BRAND, INK, SLATE, GRID, AXIS, tooltipStyle } from "@/lib/chartColors";

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
            stroke={GRID}
            vertical={false}
          />
          <XAxis
            dataKey="year"
            tick={{ fill: AXIS, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: AXIS, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={50}
            tickFormatter={(v: number) => v.toLocaleString("he-IL")}
          />
          <Tooltip
            contentStyle={{ ...tooltipStyle, color: INK }}
            formatter={(value: number, name: string) => [
              value.toLocaleString("he-IL"),
              name,
            ]}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Bar
            dataKey="היתרים"
            fill={BRAND}
            radius={[4, 4, 0, 0]}
            maxBarSize={50}
          />
          <Line
            dataKey="ממוצע"
            stroke={SLATE}
            strokeDasharray="5 5"
            dot={false}
            strokeWidth={2}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
