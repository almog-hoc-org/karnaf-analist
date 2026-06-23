"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { motion } from "framer-motion";

interface SalesChartProps {
  sales2023: number | null;
  sales2024: number | null;
  sales2025: number | null;
}

export default function SalesChart({
  sales2023,
  sales2024,
  sales2025,
}: SalesChartProps) {
  if (sales2023 === null && sales2024 === null && sales2025 === null) {
    return (
      <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">
        אין נתונים
      </div>
    );
  }

  const rawData = [
    { year: "2023", עסקאות: sales2023 },
    { year: "2024", עסקאות: sales2024 },
    { year: "2025", עסקאות: sales2025 },
  ];

  // Only include years that have data
  const data = rawData.filter((d) => d.עסקאות !== null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut", delay: 0.1 }}
    >
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={data}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
          barCategoryGap="35%"
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#27272a"
            vertical={false}
          />
          <XAxis
            dataKey="year"
            tick={{ fill: "#71717a", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#71717a", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={45}
            tickFormatter={(v: number) => v.toLocaleString("he-IL")}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: "8px",
              color: "#f4f4f5",
              fontSize: 12,
            }}
            formatter={(value: number) => [
              value.toLocaleString("he-IL"),
              "עסקאות",
            ]}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Bar
            dataKey="עסקאות"
            fill="#a78bfa"
            radius={[4, 4, 0, 0]}
            maxBarSize={70}
          />
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
