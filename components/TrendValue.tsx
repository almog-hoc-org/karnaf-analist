import { YearRange } from "@/components/FromTo";

/**
 * Single source of truth for how a price-change % is displayed across the app:
 *   - sign on the LEFT of the value (dir="ltr", per Hebrew request),
 *   - color matched to trend: rise = green, fall = red, flat/none = slate,
 *   - identical in table cells, period-comparison, and chart tooltips.
 * Convention: price UP = green (+), price DOWN = red (−). Flip here to change everywhere.
 */

// Unified palette — the ONLY colors that deviate from the indigo/slate brand are these two.
export const TREND_UP = "#059669"; // emerald-600
export const TREND_DOWN = "#dc2626"; // red-600

/** "+12.3%" / "−5.1%" / "0.0%" with a real minus sign; sign always first. */
export function fmtSignedPct(pct: number): string {
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export function trendTextClass(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct)) return "text-slate-400";
  return pct > 0 ? "text-emerald-700" : pct < 0 ? "text-red-600" : "text-slate-500";
}

export default function TrendValue({
  pct, from, to, chip = false, className = "",
}: {
  pct: number | null | undefined;
  from?: number | null;
  to?: number | null;
  chip?: boolean;
  className?: string;
}) {
  if (pct == null || Number.isNaN(pct)) {
    return <span dir="ltr" className={`text-slate-300 tabular-nums ${className}`}>—</span>;
  }
  const up = pct > 0, down = pct < 0;
  const color = up ? "text-emerald-700" : down ? "text-red-600" : "text-slate-500";
  const chipBg = up ? "bg-emerald-50" : down ? "bg-red-50" : "bg-slate-100";
  return (
    <span
      dir="ltr"
      /* flex-wrap so the year range can drop to a second line inside a narrow
         column. An inline-flex never wraps by default, which made
         "+9.3% (2025 ← 2022)" one unbreakable ~130px line and set the width of
         every change column in the cities table on a phone. */
      className={`inline-flex flex-wrap items-center gap-x-1 font-semibold tabular-nums ${color} ${chip ? `${chipBg} rounded px-1.5 py-0.5` : ""} ${className}`}
    >
      {fmtSignedPct(pct)}
      {from != null && to != null && (
        <span className="font-normal text-2xs text-slate-400">(<YearRange from={from} to={to} />)</span>
      )}
    </span>
  );
}
