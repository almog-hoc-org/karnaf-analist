"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { BRAND, INK, BRAND_LIGHT, SLATE, GRID, AXIS, tooltipStyle } from "@/lib/chartColors";

interface DistrictTarget {
  district: string;
  jewish_2021_2025: number | null;
  non_jewish_2021_2025: number | null;
  jewish_2026_2030: number | null;
  non_jewish_2026_2030: number | null;
}

export default function DistrictTargetsChart({ targets }: { targets: DistrictTarget[] }) {
  const data = targets.map((t) => ({
    district: t.district,
    "יהודי 21-25": t.jewish_2021_2025 ?? 0,
    "לא-יהודי 21-25": t.non_jewish_2021_2025 ?? 0,
    "יהודי 26-30": t.jewish_2026_2030 ?? 0,
    "לא-יהודי 26-30": t.non_jewish_2026_2030 ?? 0,
  }));

  return (
    <div style={{ width: "100%", height: 380 }} dir="ltr">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 20, right: 20, bottom: 10, left: 20 }} barCategoryGap="18%" barGap={3}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="district" tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}K`} width={40} />
          <Tooltip
            formatter={(v: number) => `${v.toLocaleString("he-IL")} אלף יח״ד`}
            contentStyle={{ ...tooltipStyle, direction: "rtl" }}
          />
          <Legend wrapperStyle={{ fontSize: 11, direction: "rtl" }} />
          {/* 21-25 — Jewish in brand indigo, non-Jewish in ink */}
          <Bar dataKey="יהודי 21-25" stackId="a" fill={BRAND} radius={[0, 0, 0, 0]} />
          <Bar dataKey="לא-יהודי 21-25" stackId="a" fill={INK} radius={[3, 3, 0, 0]} />
          {/* 26-30 — Jewish in light indigo, non-Jewish in slate */}
          <Bar dataKey="יהודי 26-30" stackId="b" fill={BRAND_LIGHT} radius={[0, 0, 0, 0]} />
          <Bar dataKey="לא-יהודי 26-30" stackId="b" fill={SLATE} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
