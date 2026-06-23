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
  Cell,
} from "recharts";
import { motion } from "framer-motion";

interface CompletionsData {
  year: number;
  total: number;
  quarters: Record<string, number>;
}

interface CompletionsChartProps {
  data: CompletionsData[];
}

export default function CompletionsChart({ data }: CompletionsChartProps) {
  if (!data || data.length === 0) return null;

  const fullYears = data.filter((d) => Object.keys(d.quarters).length === 4);
  const avg =
    fullYears.length > 0
      ? Math.round(
          fullYears.reduce((s, d) => s + d.total, 0) / fullYears.length
        )
      : 0;

  const chartData = data.map((d) => ({
    year: d.year.toString(),
    דירות: d.total,
    ממוצע: avg,
    isPartial: Object.keys(d.quarters).length < 4,
  }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <div className="flex gap-6 text-xs text-slate-500 mb-3">
        <span>
          ממוצע שנתי:{" "}
          <span className="text-slate-500 font-medium">
            {avg.toLocaleString("he-IL")} דירות
          </span>
        </span>
        {fullYears.length > 0 && (
          <span>
            שיא:{" "}
            <span className="text-emerald-400 font-medium">
              {Math.max(...fullYears.map((d) => d.total)).toLocaleString(
                "he-IL"
              )}{" "}
              ({fullYears.reduce((best, d) => (d.total > best.total ? d : best)).year})
            </span>
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart
          data={chartData}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
          barCategoryGap="15%"
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#e2e8f0"
            vertical={false}
          />
          <XAxis
            dataKey="year"
            tick={{ fill: "#64748b", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#64748b", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={55}
            tickFormatter={(v: number) =>
              v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v.toString()
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
            formatter={(value: number, name: string) => [
              value.toLocaleString("he-IL"),
              name === "דירות" ? "דירות שנבנו" : name,
            ]}
          />
          <Bar dataKey="דירות" radius={[4, 4, 0, 0]} maxBarSize={55}>
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.isPartial ? "#525252" : "#22d3ee"}
                opacity={entry.isPartial ? 0.6 : 1}
              />
            ))}
          </Bar>
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
