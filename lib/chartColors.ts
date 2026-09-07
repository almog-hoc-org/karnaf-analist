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

/**
 * Neighbourhood-map fills — the choropleth ramp, one hue, five depths.
 *
 * OPAQUE ON PURPOSE. These shipped at fill-opacity 0.62 over a near-white
 * background, which is a mathematical ceiling: at that alpha no fill of any
 * hue can render darker than #5F6061, so the "deepest" step came out a pastel
 * (1.88:1 against the page) and the lightest was #EAF6FE — white with a hint.
 * Worse, no-data rendered ΔE 1.71 from the background, i.e. invisible, and
 * only ΔE 4.16 from the first price step. Declared colour is now rendered
 * colour, so the ramp below is what the reader actually sees.
 *
 * Blue, not the brand petrol: the map's blues are a per-city quantity scale,
 * not a brand accent, and the deliberate ask was that the lightest step still
 * read as blue.
 */
export const MAP_FILLS: string[] = [
  "#bae6fd", // sky-200 — unmistakably blue at full opacity
  "#7dd3fc", // sky-300
  "#38bdf8", // sky-400
  "#0284c7", // sky-600
  "#075985", // sky-800
];

/** A shape with a boundary but no priced cell. Grey, plus a hatch — the
 *  distinction must not rest on hue alone, where it can collide with step 1. */
export const MAP_NO_DATA = "#eef2f6";

/** The sea. OFF the blue ramp: the previous #dbeafe sat ΔE 5.2 from step 2,
 *  so the water competed with the data it was supposed to sit behind. */
export const MAP_WATER = "#dde7ef";
export const MAP_COAST = "#b8c7d4";

/** Streets, drawn OVER the opaque fills as a knockout — a white mesh on top
 *  reads as roads without tinting the colour underneath. */
export const MAP_ROAD = "#ffffff";
/** the road mesh once a neighbourhood is zoomed and the fills have faded — white would vanish */
export const MAP_ROAD_ZOOMED = "#94a3b8"; // slate-400
export const MAP_ROAD_LABEL = "#475569"; // slate-600 — needs a white halo over the deep end

/** The pinned/hovered shape. An outline, not an opacity change: with opaque
 *  fills there is no alpha left to signal with, and INK is visible over all
 *  five steps. */
export const MAP_SELECTED = INK;

/**
 * Deal pins on the neighbourhood map — a DIVERGING ramp around the
 * neighbourhood's own median ₪/m²: two steps below, one at, two above.
 *
 * Not the trend greens/reds: those mean CHANGE everywhere on the site, and a
 * dearer flat is not "up". Not the map's blues: a blue dot on a blue
 * choropleth vanishes. Orange↔violet is orthogonal to both scales, keeps
 * its order for the common colour-vision deficiencies, and every step reads
 * over every fill with the white stroke.
 */
export const PIN_RAMP: string[] = [
  "#c2410c", // orange-700 — well below the median
  "#fb923c", // orange-400 — below
  "#475569", // slate-600 — around the median
  "#a78bfa", // violet-400 — above
  "#6d28d9", // violet-700 — well above
];
export const PIN_STROKE = "#ffffff";
/** A street-level location: a hollow ring, never a filled pin. */
export const PIN_STREET = SLATE;
