"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList } from "recharts";

interface ShortfallRow {
  district: string;
  completions_k: number;
  demand_k: number;
  gap_k: number;
  pct: number;
}

export default function ShortfallBarChart({ data }: { data: ShortfallRow[] }) {
  const chart = data.map((r) => ({
    district: r.district,
    "סיומי בנייה": r.completions_k,
    "צורכי דיור": r.demand_k,
    pct: r.pct,
  }));

  return (
    <div style={{ width: "100%", height: 320 }} dir="ltr">
      <ResponsiveContainer>
        <BarChart data={chart} margin={{ top: 20, right: 20, bottom: 10, left: 20 }} barCategoryGap="22%">
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="district" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}K`} width={40} />
          <Tooltip
            formatter={(v: number, name: string) => name === "pct" ? `${v}%` : `${v.toLocaleString("he-IL")} אלף יח"ד`}
            contentStyle={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, direction: "rtl" }}
          />
          <Legend wrapperStyle={{ fontSize: 12, direction: "rtl" }} />
          <Bar dataKey="צורכי דיור" fill="#dc2626" radius={[3, 3, 0, 0]} maxBarSize={50} />
          <Bar dataKey="סיומי בנייה" fill="#06b6d4" radius={[3, 3, 0, 0]} maxBarSize={50}>
            <LabelList dataKey="pct" position="top" formatter={(v: number) => `${v}%`} fontSize={11} fill="#dc2626" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
