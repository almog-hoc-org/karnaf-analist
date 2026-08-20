"use client";

import {
  Area, Bar, CartesianGrid, ComposedChart, Legend, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AXIS, BRAND, BRAND_FAINT, GRID, INK, tooltipStyle } from "@/lib/chartColors";
import { useIsMobile } from "@/lib/useIsMobile";
import type { DailyRow } from "@/lib/usageRollup";

/**
 * The daily shape of the audience, on one pair of axes.
 *
 * THREE SERIES, CHOSEN SO THE CHART ANSWERS A QUESTION RATHER THAN DECORATING
 *   visitors (area)   — the size of the audience
 *   returning (line)  — how much of it is not new. The gap between the two IS
 *                       the acquisition-versus-retention story: an area that
 *                       grows while the line stays flat is a leaky bucket, and
 *                       that is invisible in either series alone.
 *   signups (bars, right axis) — the outcome, on its own scale because it is
 *                       an order of magnitude smaller and would otherwise be a
 *                       line pinned to the floor.
 *
 * Reads the nightly roll-up, so it covers whole days only — today is missing
 * on purpose rather than drawn as a collapse every morning.
 */
export default function UsageTrendChart({ rows }: { rows: DailyRow[] }) {
  const mobile = useIsMobile();
  if (rows.length < 2) {
    return (
      <p className="py-6 text-center text-xs text-slate-400">
        הצבירה הלילית צריכה לפחות יומיים כדי לצייר מגמה.
      </p>
    );
  }

  const data = rows.map((r) => ({
    day: r.day.slice(5), // MM-DD — the year is the same on every point
    visitors: r.visitors || r.sessions,
    returning: r.returningVisitors,
    signups: r.signups,
  }));

  return (
    <ResponsiveContainer width="100%" height={mobile ? 200 : 260} initialDimension={{ width: 800, height: 260 }}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="day" tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={{ stroke: GRID }}
          interval={Math.max(0, Math.floor(data.length / (mobile ? 4 : 10)))}
        />
        <YAxis yAxisId="l" tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false} width={32} />
        <YAxis yAxisId="r" orientation="right" tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false} width={28} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ fontWeight: 700 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Area yAxisId="l" type="monotone" dataKey="visitors" name="מבקרים" stroke={BRAND} fill={BRAND_FAINT} fillOpacity={0.5} strokeWidth={2} />
        <Line yAxisId="l" type="monotone" dataKey="returning" name="חוזרים" stroke={INK} strokeWidth={2} dot={false} />
        <Bar yAxisId="r" dataKey="signups" name="הרשמות" fill={BRAND} fillOpacity={0.35} barSize={8} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
