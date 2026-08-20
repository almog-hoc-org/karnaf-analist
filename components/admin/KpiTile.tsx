"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { BRAND } from "@/lib/chartColors";

/**
 * One headline number, its movement, and its shape over time.
 *
 * THREE PARTS, EACH ANSWERING A DIFFERENT QUESTION, WHICH IS WHY ALL THREE ARE HERE
 *   the number  — what is it now
 *   the delta   — better or worse than the period before
 *   the sparkline — did it get there steadily, or in one spike
 *
 * The number alone is the version this dashboard had, and it is the least
 * useful of the three: "376 visits" cannot be acted on by anyone who does not
 * already remember last month. The delta supplies the memory. The sparkline
 * supplies the thing a delta hides — a metric that doubled on one day and sat
 * flat otherwise reads identically to one that grew every day, and they call
 * for opposite responses.
 *
 * `goodWhenUp = false` for metrics where a rise is bad (errors, bounce), so
 * the colour means "good/bad" rather than "up/down". Green on rising errors is
 * how a dashboard trains people to stop reading it.
 */
export default function KpiTile({
  label, value, sub, delta, goodWhenUp = true, series, hint,
}: {
  label: string;
  value: string;
  /** small second line — the raw count behind a percentage, usually */
  sub?: string;
  /** percent change vs the previous period; null = no comparison available */
  delta?: number | null;
  goodWhenUp?: boolean;
  /** daily values, oldest first */
  series?: number[];
  hint?: string;
}) {
  const hasDelta = delta != null && Number.isFinite(delta);
  const up = hasDelta && delta! > 0;
  const flat = hasDelta && delta === 0;
  const good = flat ? null : up === goodWhenUp;
  const deltaTone = good == null ? "text-slate-400 bg-slate-100"
    : good ? "text-emerald-700 bg-emerald-50" : "text-rose-700 bg-rose-50";

  const spark = (series ?? []).map((v, i) => ({ i, v }));
  const flatLine = spark.length > 1 && spark.every((p) => p.v === spark[0].v);

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5" title={hint}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-2xs font-bold text-slate-500">{label}</p>
        {hasDelta && (
          <span className={`shrink-0 rounded px-1 py-px text-2xs font-bold tabular-nums ${deltaTone}`} dir="ltr">
            {up ? "▲" : flat ? "→" : "▼"} {Math.abs(delta!)}%
          </span>
        )}
      </div>
      <p className="mt-0.5 text-2xl font-black leading-none tabular-nums text-slate-900">{value}</p>
      <p className="mt-1 h-3 truncate text-2xs text-slate-400">{sub ?? ""}</p>
      {/* A single point cannot show a trend, and a perfectly flat line reads as
          a rendering bug rather than as stability — both are left blank. */}
      <div className="mt-1 h-8">
        {spark.length > 2 && !flatLine && (
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 160, height: 32 }}>
            <AreaChart data={spark} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <Area
                type="monotone" dataKey="v" stroke={BRAND} strokeWidth={1.5}
                fill={BRAND} fillOpacity={0.12} isAnimationActive={false} dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
