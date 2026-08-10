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
import { BRAND, BRAND_LIGHT, INK, GRID, AXIS, tooltipStyle, tipFmt } from "@/lib/chartColors";
import { useIsMobile } from "@/lib/useIsMobile";

interface PriceTrendDataPoint {
  year: number;
  quarter: number;
  median_price: number | null;
}

interface PriceTrendChartProps {
  data: PriceTrendDataPoint[];
  cityName: string;
}

export default function PriceTrendChart({ data }: PriceTrendChartProps) {
  const mobile = useIsMobile();
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
      <ResponsiveContainer width="100%" height={mobile ? 220 : 260} initialDimension={{ width: 600, height: 260 }}>
        <LineChart
          data={chartData}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={GRID}
            vertical={false}
          />
          <XAxis
            dataKey="period"
            tick={{ fill: AXIS, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval={Math.max(0, Math.floor(chartData.length / 8))}
          />
          <YAxis
            tick={{ fill: AXIS, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={mobile ? 42 : 55}
            tickFormatter={(v: number) => `${(v / 1000000).toFixed(1)}M`}
          />
          <Tooltip
            contentStyle={{ ...tooltipStyle, color: INK }}
            formatter={tipFmt((value) => [
              `₪${value.toLocaleString("he-IL")}`,
              "מחיר חציוני",
            ])}
          />
          <Line isAnimationActive={false}
            type="monotone"
            dataKey="מחיר"
            stroke={BRAND}
            strokeWidth={2.5}
            dot={{ fill: BRAND, r: 3, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: BRAND_LIGHT }}
          />
        </LineChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
