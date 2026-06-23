"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { motion } from "framer-motion";

interface PriceTrendDataPoint {
  year: number;
  quarter: number;
  median_price: number | null;
}

interface PriceTrendChartProps {
  data: PriceTrendDataPoint[];
  cityName: string;
}

export default function PriceTrendChart({ data, cityName }: PriceTrendChartProps) {
  if (!data || data.length < 2) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
        אין מספיק נתוני מחירים להצגת גרף
      </div>
    );
  }

  const chartData = data
    .filter((d) => d.median_price !== null)
    .map((d) => ({
      period: `Q${d.quarter}/${d.year}`,
      מחיר: d.median_price,
      מחירMil: d.median_price ? d.median_price / 1000000 : 0,
    }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut", delay: 0.15 }}
    >
      <ResponsiveContainer width="100%" height={260}>
        <LineChart
          data={chartData}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#e2e8f0"
            vertical={false}
          />
          <XAxis
            dataKey="period"
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval={Math.max(0, Math.floor(chartData.length / 8))}
          />
          <YAxis
            tick={{ fill: "#64748b", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={55}
            tickFormatter={(v: number) => `${(v / 1000000).toFixed(1)}M`}
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
              `₪${value.toLocaleString("he-IL")}`,
              "מחיר חציוני",
            ]}
          />
          <Line
            type="monotone"
            dataKey="מחיר"
            stroke="#a78bfa"
            strokeWidth={2.5}
            dot={{ fill: "#a78bfa", r: 3, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: "#c4b5fd" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
