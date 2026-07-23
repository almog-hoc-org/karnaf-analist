"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { motion } from "framer-motion";
import { BRAND, INK, SLATE, GRID, AXIS, tooltipStyle } from "@/lib/chartColors";

interface PriceChartProps {
  price2023: number | null;
  price2026: number | null;
  cityName: string;
}

function formatTick(value: number): string {
  if (value >= 1000) return `₪${(value / 1000).toFixed(0)}K`;
  return `₪${value}`;
}

export default function PriceChart({
  price2023,
  price2026,
  cityName,
}: PriceChartProps) {
  if (price2023 === null && price2026 === null) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
        אין נתונים
      </div>
    );
  }

  const data = [
    {
      name: cityName,
      "2023": price2023 ?? undefined,
      "2026": price2026 ?? undefined,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={data}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
          barCategoryGap="30%"
          barGap={8}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={GRID}
            vertical={false}
          />
          <XAxis
            dataKey="name"
            tick={{ fill: AXIS, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatTick}
            tick={{ fill: AXIS, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip
            contentStyle={{ ...tooltipStyle, color: INK }}
            formatter={(value: number, name: string) => [
              `₪${Math.round(value).toLocaleString("he-IL")}`,
              `מחיר ${name}`,
            ]}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: SLATE }}
            iconType="circle"
          />
          {price2023 !== null && (
            <Bar
              dataKey="2023"
              name="2023"
              fill={SLATE}
              radius={[4, 4, 0, 0]}
              maxBarSize={60}
            />
          )}
          {price2026 !== null && (
            <Bar
              dataKey="2026"
              name="2026"
              fill={BRAND}
              radius={[4, 4, 0, 0]}
              maxBarSize={60}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
