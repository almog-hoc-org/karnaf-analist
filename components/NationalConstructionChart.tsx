"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { motion } from "framer-motion";
import { BRAND, INK, BRAND_LIGHT, SLATE, GRID, AXIS, tooltipStyle, tipFmt } from "@/lib/chartColors";

interface NationalData {
  year: number;
  permits: number | null;
  starts: number | null;
  completions: number | null;
  /** Optional annual target (e.g. from the Housing Committee). Plotted as a dashed reference line. */
  target?: number;
}

interface Props {
  data: NationalData[];
}

export default function NationalConstructionChart({ data }: Props) {
  if (!data || data.length === 0) return null;

  const hasTarget = data.some((d) => typeof d.target === "number");

  const chartData = data.map((d) => ({
    year: d.year.toString(),
    "היתרי בנייה": d.permits ?? undefined,
    "התחלות בנייה": d.starts ?? undefined,
    "גמר בנייה": d.completions ?? undefined,
    ...(hasTarget ? { 'יעד שנתי (ועדה)': d.target } : {}),
  }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <div className="overflow-x-auto">
        <div className="min-w-[560px] md:min-w-0">
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart
          data={chartData}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
          barCategoryGap="20%"
          barGap={2}
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
            width={55}
            tickFormatter={(v: number) =>
              v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v.toString()
            }
          />
          <Tooltip
            contentStyle={{ ...tooltipStyle, color: INK, direction: "rtl" }}
            formatter={tipFmt((value, name) => [
              value.toLocaleString("he-IL") + " דירות",
              name,
            ])}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: SLATE, direction: "rtl" }}
          />
          <Bar
            dataKey="היתרי בנייה"
            fill={BRAND}
            radius={[3, 3, 0, 0]}
            maxBarSize={35}
            isAnimationActive={false}
          />
          <Bar isAnimationActive={false}
            dataKey="התחלות בנייה"
            fill={INK}
            radius={[3, 3, 0, 0]}
            maxBarSize={35}
          />
          <Bar isAnimationActive={false}
            dataKey="גמר בנייה"
            fill={BRAND_LIGHT}
            radius={[3, 3, 0, 0]}
            maxBarSize={35}
          />
          {hasTarget && (
            <Line isAnimationActive={false}
              type="monotone"
              dataKey="יעד שנתי (ועדה)"
              stroke={SLATE}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={{ r: 3, fill: SLATE, stroke: SLATE }}
              activeDot={{ r: 5 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
        </div>
      </div>
    </motion.div>
  );
}
