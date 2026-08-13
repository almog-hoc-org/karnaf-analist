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

  // FULL quarter axis, gaps included. The old version filtered missing
  // quarters OUT of the array — a categorical X axis then collapses, so
  // Q1/2020 could sit adjacent to Q3/2022 with an unbroken line between
  // them, erasing a two-year hole from the picture. Every quarter between
  // the first and last data point now gets a tick; missing ones carry null
  // and the line breaks there (connectNulls={false}).
  const present = new Map(
    data.filter((d) => d.median_price !== null).map((d) => [`${d.year}-${d.quarter}`, d.median_price as number])
  );
  const withData = data.filter((d) => d.median_price !== null);
  const first = withData[0], last = withData[withData.length - 1];
  const chartData: Array<{ period: string; מחיר: number | null }> = [];
  if (first && last) {
    for (let y = first.year, q = first.quarter; y < last.year || (y === last.year && q <= last.quarter); ) {
      chartData.push({ period: `Q${q}/${y}`, מחיר: present.get(`${y}-${q}`) ?? null });
      q++; if (q > 4) { q = 1; y++; }
    }
  }
  const gapCount = chartData.filter((c) => c.מחיר === null).length;

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
            connectNulls={false}
            dot={{ fill: BRAND, r: 3, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: BRAND_LIGHT }}
          />
        </LineChart>
      </ResponsiveContainer>
      {gapCount > 0 && (
        <p className="mt-1 text-2xs text-slate-400 text-center">
          {gapCount} רבעונים ללא נתון בטווח — הקו נשבר שם בכוונה
        </p>
      )}
    </motion.div>
  );
}
