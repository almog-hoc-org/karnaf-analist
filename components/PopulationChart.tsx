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
import { BRAND, INK, BRAND_LIGHT, SLATE, BRAND_DARK, SLATE_LIGHT, GRID, AXIS, tooltipStyle, tipFmt } from "@/lib/chartColors";
import { useIsMobile } from "@/lib/useIsMobile";

interface PopulationDataPoint {
  year: number;
  population: number | null;
  source: string | null;
}

interface PopulationChartProps {
  data: PopulationDataPoint[];
  cityName: string;
}

export default function PopulationChart({ data }: PopulationChartProps) {
  const mobile = useIsMobile();
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
    "data.gov.il_registry_2019": BRAND,
    "data.gov.il_registry_2026": BRAND,
    "census_2022": INK,
    "cbs_permits_2024": BRAND_LIGHT,
    "cbs_original": SLATE,
    "cbs_projection_2026": BRAND_DARK,
    "interpolated": SLATE_LIGHT,
    "extrapolated": SLATE_LIGHT,
    "estimated": SLATE_LIGHT,
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut", delay: 0.15 }}
    >
      <ResponsiveContainer width="100%" height={mobile ? 220 : 260} initialDimension={{ width: 600, height: 260 }}>
        <AreaChart
          data={chartData}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
        >
          <defs>
            <linearGradient id="popGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={BRAND} stopOpacity={0.3} />
              <stop offset="95%" stopColor={BRAND} stopOpacity={0} />
            </linearGradient>
          </defs>
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
            width={mobile ? 44 : 60}
            tickFormatter={(v: number) =>
              v >= 1000000
                ? `${(v / 1000000).toFixed(1)}M`
                : v >= 1000
                ? `${(v / 1000).toFixed(0)}K`
                : v.toString()
            }
          />
          <Tooltip
            contentStyle={{ ...tooltipStyle, color: INK }}
            formatter={tipFmt((value) => [
              value.toLocaleString("he-IL"),
              "אוכלוסייה",
            ])}
            labelFormatter={(label) => `שנת ${label}`}
          />
          <Area isAnimationActive={false}
            type="monotone"
            dataKey="אוכלוסייה"
            stroke={BRAND}
            fill="url(#popGradient)"
            strokeWidth={2}
            dot={(props: Record<string, unknown>) => {
              const { cx, cy, payload } = props as { cx: number; cy: number; payload: { source: string } };
              const color = sourceColors[payload.source] || SLATE_LIGHT;
              return (
                <circle
                  key={`dot-${cx}-${cy}`}
                  cx={cx}
                  cy={cy}
                  r={4}
                  fill={color}
                  stroke={GRID}
                  strokeWidth={2}
                />
              );
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-3 mt-2 justify-center text-2xs text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: BRAND }} /> מרשם אוכלוסין</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: INK }} /> מפקד 2022</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: BRAND_LIGHT }} /> למ&quot;ס 2024</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: SLATE_LIGHT }} /> אינטרפולציה</span>
      </div>
    </motion.div>
  );
}
