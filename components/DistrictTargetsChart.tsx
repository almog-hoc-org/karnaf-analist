"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

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
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="district" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}K`} width={40} />
          <Tooltip
            formatter={(v: number) => `${v.toLocaleString("he-IL")} אלף יח״ד`}
            contentStyle={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, direction: "rtl" }}
          />
          <Legend wrapperStyle={{ fontSize: 11, direction: "rtl" }} />
          {/* 21-25 — Jewish in solid emerald, non-Jewish in amber */}
          <Bar dataKey="יהודי 21-25" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
          <Bar dataKey="לא-יהודי 21-25" stackId="a" fill="#fbbf24" radius={[3, 3, 0, 0]} />
          {/* 26-30 — Jewish in solid purple, non-Jewish in pink */}
          <Bar dataKey="יהודי 26-30" stackId="b" fill="#a855f7" radius={[0, 0, 0, 0]} />
          <Bar dataKey="לא-יהודי 26-30" stackId="b" fill="#f472b6" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
