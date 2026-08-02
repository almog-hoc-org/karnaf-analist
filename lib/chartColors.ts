/**
 * Single source of truth for ALL chart colors — "Petrol Steel" brand.
 * Import from here; never hardcode hex values in chart components.
 */
export const BRAND = "#0e7490";        // petrol-600 — primary series
export const BRAND_STRONG = "#155e75"; // petrol-700
export const BRAND_DARK = "#103c4d";   // petrol-900 — emphasis series
export const BRAND_LIGHT = "#3aa6bc";  // petrol-400 — secondary series
export const BRAND_FAINT = "#b5e2ea";  // petrol-200 — tertiary / fills
export const BRAND_BG = "#eef9fb";     // petrol-50 — soft fills
export const INK = "#0f172a";          // slate-900 — strongest series/labels
export const SLATE = "#64748b";        // slate-500 — comparison/neutral series
export const SLATE_LIGHT = "#94a3b8";  // slate-400 — de-emphasized series
export const GRID = "#e2e8f0";         // slate-200 — grid lines
export const AXIS = "#94a3b8";         // slate-400 — axis text
export const TREND_UP = "#059669";     // emerald-600 — positive trend ONLY
export const TREND_DOWN = "#dc2626";   // red-600 — negative trend ONLY

/** Ordered categorical scale for multi-series charts. */
export const SERIES: string[] = [
  BRAND,        // 1st series
  INK,          // 2nd
  BRAND_LIGHT,  // 3rd
  SLATE,        // 4th
  BRAND_DARK,   // 5th
  SLATE_LIGHT,  // 6th
  BRAND_FAINT,  // 7th
];

/** Room-bucket colors (petrol ramp), synced with the price graphs. */
export const ROOM_COLORS: Record<string, string> = {
  "3": "#7cc8d6", // petrol-300
  "4": "#17879f", // petrol-500
  "5": "#155e75", // petrol-700
  all: "#0f172a", // slate-900
};

/** Shared Recharts tooltip style. */
export const tooltipStyle = {
  backgroundColor: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  fontSize: 12,
  boxShadow: "0 4px 16px rgba(15,23,42,0.1)",
  direction: "rtl" as const,
  color: INK,
};

/**
 * recharts v3 widened the Tooltip `formatter` signature (value: ValueType,
 * name: NameType, item, index, payload). Every formatter in this app is
 * numeric, so this shim keeps the call sites simple and typed:
 *
 *   formatter={tipFmt((value, name) => [fmt(value), label(name)])}
 */
export function tipFmt<R>(fn: (value: number, name: string) => R) {
  return (value: unknown, name: unknown): R => fn(Number(value), String(name ?? ""));
}
