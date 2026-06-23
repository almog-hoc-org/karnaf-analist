"use client";

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface Point {
  year: number;
  permitsCumulative: number;
  startsCumulative: number;
  completionsCumulative: number;
  targetCumulative: number;
}

export default function PlanVsActualChart({ data }: { data: Point[] }) {
  const series = data.map((d) => ({
    year: d.year.toString(),
    "היתרים": d.permitsCumulative,
    "התחלות": d.startsCumulative,
    "גמר בנייה": d.completionsCumulative,
    "יעד הוועדה": d.targetCumulative,
  }));

  return (
    <div style={{ width: "100%", height: 360 }} dir="ltr">
      <ResponsiveContainer>
        <ComposedChart data={series} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="year" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: "#64748b" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`}
            width={50}
          />
          <Tooltip
            formatter={(v: number) => v.toLocaleString("he-IL") + " יח״ד מצטבר"}
            contentStyle={{
              backgroundColor: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              fontSize: 12,
              direction: "rtl",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, direction: "rtl" }} />
          {/* Actuals as filled areas — semi-transparent so they stack visually */}
          <Area
            type="monotone"
            dataKey="היתרים"
            stroke="#f59e0b"
            fill="#fef3c7"
            fillOpacity={0.55}
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="התחלות"
            stroke="#10b981"
            fill="#d1fae5"
            fillOpacity={0.55}
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="גמר בנייה"
            stroke="#06b6d4"
            fill="#cffafe"
            fillOpacity={0.6}
            strokeWidth={2}
          />
          {/* Committee target as the reference benchmark — dashed red line */}
          <Line
            type="linear"
            dataKey="יעד הוועדה"
            stroke="#dc2626"
            strokeWidth={2.5}
            strokeDasharray="6 4"
            dot={{ r: 4, fill: "#dc2626", stroke: "#dc2626" }}
            activeDot={{ r: 6 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
