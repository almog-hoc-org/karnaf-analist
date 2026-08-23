"use client";

import { useMemo } from "react";
import type { MappedNeighborhood, MapLine } from "@/lib/cityMap";

/**
 * The city, drawn.
 *
 * Four layers in one <svg>, in this order for a reason:
 *   water → streets → neighbourhoods → labels
 * Streets sit UNDER the fills. Drawn on top they turn the map into a grey mesh
 * and the colour — which is the actual information — reads as a tint behind a
 * grid. Underneath they do the one job they are here for: telling the reader
 * where in the city they are looking.
 *
 * No map library and no tiles. The geometry was projected and simplified once
 * by scripts/collect-city-map.ts and stored as path strings, so this component
 * only ever prints numbers into `d` attributes — and a visitor's browser makes
 * ZERO requests to anyone else to see this page.
 *
 * ⚠ direction="ltr" on the <svg> is not decoration. SVG inherits the page's
 * RTL, and this project has already been bitten by it once: chart axis labels
 * were clipped to a single digit until the direction was pinned.
 */

/** One hue, five depths — "light blue, semi-transparent", deepening with price. */
const FILLS = ["#e0f2fe", "#bae6fd", "#7dd3fc", "#38bdf8", "#0ea5e9"];
const NO_DATA_FILL = "#f1f5f9";

/** Stroke width per road class (view-box units; the box is 1000 wide). */
const ROAD_WIDTH: Record<number, number> = { 1: 2.2, 2: 1.8, 3: 1.3, 4: 0.9, 5: 0.6 };

/** At most this many street names. Beyond it the map is a word cloud. */
const MAX_ROAD_LABELS = 10;

export default function CityMap({
  neighborhoods,
  lines,
  active,
  onHover,
  onPin,
  className = "",
}: {
  neighborhoods: MappedNeighborhood[];
  lines: MapLine[];
  /** the neighbourhood highlighted right now, from the shared section state */
  active: string | null;
  onHover: (name: string | null) => void;
  onPin: (name: string | null) => void;
  className?: string;
}) {
  const water = useMemo(() => lines.filter((l) => l.kind === "water"), [lines]);
  const coast = useMemo(() => lines.filter((l) => l.kind === "coast"), [lines]);
  const roads = useMemo(() => lines.filter((l) => l.kind === "road"), [lines]);

  /* The longest named arteries, one label each. Longest is the right proxy for
     "the road a reader orients by", and it needs no extra data. */
  const roadLabels = useMemo(() => {
    const named = roads.filter((r) => r.name && r.rank <= 3);
    const seen = new Set<string>();
    return [...named]
      .sort((a, b) => b.length - a.length)
      .filter((r) => (seen.has(r.name!) ? false : (seen.add(r.name!), true)))
      .slice(0, MAX_ROAD_LABELS)
      .map((r) => { const [x, y] = midPoint(r.path); return { name: r.name!, x, y }; });
  }, [roads]);

  return (
    <svg
      viewBox="0 0 1000 1000"
      direction="ltr"
      role="img"
      aria-label="מפת שכונות העיר, צבועה לפי מחיר למ״ר"
      className={`h-auto w-full ${className}`}
      onMouseLeave={() => onHover(null)}
    >
      <rect x="0" y="0" width="1000" height="1000" fill="#fbfdff" />

      {water.map((w, i) => (
        <path key={`w${i}`} d={w.path} fill="#dbeafe" stroke="none" />
      ))}
      {coast.map((c, i) => (
        <path key={`c${i}`} d={c.path} fill="none" stroke="#bfdbfe" strokeWidth={1.5} />
      ))}

      <g stroke="#cbd5e1" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {roads.map((r, i) => (
          <path key={`r${i}`} d={r.path} strokeWidth={ROAD_WIDTH[r.rank] ?? 0.6} />
        ))}
      </g>

      {neighborhoods.map((n) => {
        const isActive = active === n.neighborhood;
        return (
          <path
            key={n.neighborhood}
            d={n.path}
            fill={n.bin == null ? NO_DATA_FILL : FILLS[n.bin]}
            fillOpacity={n.bin == null ? 0.55 : isActive ? 0.95 : 0.62}
            stroke={isActive ? "#1d4ed8" : "#ffffff"}
            strokeWidth={isActive ? 2.2 : 0.9}
            className="cursor-pointer transition-[fill-opacity]"
            onMouseEnter={() => onHover(n.neighborhood)}
            onClick={() => onPin(n.neighborhood)}
          >
            <title>
              {n.summary
                ? `${n.neighborhood} — ₪${Math.round(n.summary.sqm).toLocaleString("he-IL")} למ״ר`
                : `${n.neighborhood} — אין מספיק עסקאות`}
            </title>
          </path>
        );
      })}

      {/* Street names under the shapes' labels, so a neighbourhood name is never
          hidden behind a road name. */}
      <g fill="#94a3b8" fontSize="11" fontWeight="600" textAnchor="middle" pointerEvents="none">
        {roadLabels.map((r, i) => (
          <text key={`rl${i}`} x={r.x} y={r.y}>{r.name}</text>
        ))}
      </g>

      {/* Only the ACTIVE neighbourhood is named. Labelling all of them at once
          is unreadable at this size, and the table beside the map already lists
          every one. */}
      {neighborhoods
        .filter((n) => n.neighborhood === active)
        .map((n) => (
          <g key={`l${n.neighborhood}`} pointerEvents="none">
            <text
              x={n.cx} y={n.cy}
              textAnchor="middle"
              fontSize="15" fontWeight="800"
              fill="#0f172a"
              stroke="#ffffff" strokeWidth={3.5} paintOrder="stroke"
            >
              {n.neighborhood}
            </text>
            {n.summary && (
              <text
                x={n.cx} y={n.cy + 17}
                textAnchor="middle"
                fontSize="13" fontWeight="700"
                fill="#1d4ed8"
                stroke="#ffffff" strokeWidth={3.5} paintOrder="stroke"
              >
                ₪{Math.round(n.summary.sqm).toLocaleString("he-IL")}
              </text>
            )}
          </g>
        ))}
    </svg>
  );
}

/* The midpoint of a path's `d`, good enough to place a label on a road without
   parsing the geometry back out of the string. */
function midPoint(path: string): [number, number] {
  const pts = path
    .slice(1)
    .split("L")
    .map((p) => p.split(",").map(Number))
    .filter((p) => p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!pts.length) return [500, 500];
  const m = pts[Math.floor(pts.length / 2)];
  return [m[0], m[1]];
}
