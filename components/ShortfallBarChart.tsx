"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList } from "recharts";
import { BRAND, SLATE, GRID, AXIS, TREND_DOWN, tooltipStyle, tipFmt } from "@/lib/chartColors";
import { useIsMobile } from "@/lib/useIsMobile";

interface ShortfallRow {
  district: string;
  completions_k: number;
  demand_k: number;
  gap_k: number;
  pct: number;
}

export default function ShortfallBarChart({ data }: { data: ShortfallRow[] }) {
  const mobile = useIsMobile();
  const chart = data.map((r) => ({
    district: r.district,
    "סיומי בנייה": r.completions_k,
    "צורכי דיור": r.demand_k,
    pct: r.pct,
  }));

  return (
    <div style={{ width: "100%", height: mobile ? 270 : 320 }} dir="ltr">
      <ResponsiveContainer>
        <BarChart data={chart} margin={{ top: 20, right: 20, bottom: 10, left: 20 }} barCategoryGap="22%">
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="district" angle={mobile ? -35 : 0} textAnchor={mobile ? "end" : "middle"} height={mobile ? 60 : undefined} tick={{ fontSize: mobile ? 10 : 11, fill: AXIS }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}K`} width={40} />
          <Tooltip
            formatter={tipFmt((v, name) => name === "pct" ? `${v}%` : `${v.toLocaleString("he-IL")} אלף יח"ד`)}
            contentStyle={{ ...tooltipStyle, direction: "rtl" }}
          />
          <Legend wrapperStyle={{ fontSize: 11, direction: "rtl" }} />
          <Bar isAnimationActive={false} dataKey="צורכי דיור" fill={SLATE} radius={[3, 3, 0, 0]} maxBarSize={50} />
          <Bar isAnimationActive={false} dataKey="סיומי בנייה" fill={BRAND} radius={[3, 3, 0, 0]} maxBarSize={50}>
            {/* LabelList has its own v3 signature (ReactNode in/out) — not the Tooltip shim */}
            <LabelList dataKey="pct" position="top" formatter={(v) => `${v}%`} fontSize={11} fill={TREND_DOWN} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
