"use client";

import { useMemo, type ReactNode } from "react";
import type { MappedNeighborhood, MapLine } from "@/lib/cityMap";
import {
  MAP_FILLS, MAP_NO_DATA, MAP_WATER, MAP_COAST, MAP_ROAD, MAP_ROAD_ZOOMED, MAP_ROAD_LABEL, MAP_SELECTED,
} from "@/lib/chartColors";
import { FULL_VIEW, VIEW_SIZE, viewBoxAttr, type ViewBox } from "@/lib/geo";
import { useAnimatedViewBox } from "@/lib/useAnimatedViewBox";

/**
 * The city, drawn.
 *
 * Four layers in one <svg>, in this order for a reason:
 *   water → neighbourhoods → streets → (pins) → labels
 * Streets sit OVER the fills, in white. They used to sit under them, which
 * only worked because the fills were half-transparent — and half-transparent
 * over a near-white page is a hard ceiling on how dark any colour can get, so
 * the whole price ramp came out as pastels and the lightest step read as
 * white. The fills are opaque now; a white mesh on top reads as roads without
 * tinting the colour underneath, which is the actual information.
 * The one exception is the zoomed view of a pinned neighbourhood: there the
 * fill fades to a tint and the mesh turns grey, because inside one
 * neighbourhood the pins and the street names are the information.
 *
 * No map library and no tiles. The geometry was projected and simplified once
 * by scripts/collect-city-map.ts and stored as path strings, so this component
 * only ever prints numbers into `d` attributes — and a visitor's browser makes
 * ZERO requests to anyone else to see this page.
 *
 * ZOOM IS A viewBox, NOT A TRANSFORM. When a neighbourhood is pinned the
 * parent hands in the box around it and the svg shows that box — the same
 * paths, the same numbers, animated by lib/useAnimatedViewBox. Every stroke
 * and font here is multiplied by `k` (box width / 1000) so that zooming in
 * does not turn hairline roads into ribbons.
 *
 * `children` is the layer between the streets and the labels: the deal pins.
 * They live in the same coordinate space as the shapes, by construction
 * (lib/dealPins.ts), so they are simply drawn.
 *
 * ⚠ direction="ltr" on the <svg> is not decoration. SVG inherits the page's
 * RTL, and this project has already been bitten by it once: chart axis labels
 * were clipped to a single digit until the direction was pinned.
 */

/** Stroke width per road class (view-box units; the box is 1000 wide). */
const ROAD_WIDTH: Record<number, number> = { 1: 1.9, 2: 1.5, 3: 1.1, 4: 0.8, 5: 0.55 };

/** At most this many street names. Beyond it the map is a word cloud. */
const MAX_ROAD_LABELS = 10;

export default function CityMap({
  neighborhoods,
  lines,
  active,
  onHover,
  onPin,
  viewBox,
  children,
  className = "",
}: {
  neighborhoods: MappedNeighborhood[];
  lines: MapLine[];
  /** the neighbourhood highlighted right now, from the shared section state */
  active: string | null;
  onHover: (name: string | null) => void;
  onPin: (name: string | null) => void;
  /** the part of the canvas to show — the whole city when omitted */
  viewBox?: ViewBox;
  /** drawn between the streets and the labels: the deal pins */
  children?: ReactNode;
  className?: string;
}) {
  const vb = useAnimatedViewBox(viewBox ?? FULL_VIEW);
  const k = vb.w / VIEW_SIZE;
  // ZOOMED IN, THE FILL STEPS BACK. At city scale the colour IS the
  // information. Inside one neighbourhood the information is the pins, the
  // streets and the names, and an opaque fill hid all three (user report,
  // 7.9.2026, Bat Yam). So the fills fade to a tint, the pinned one a little
  // stronger than its neighbours, and the road mesh turns from white knockout
  // to a grey line — white over a pale tint is invisible.
  const zoomed = k < 0.6;

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
      viewBox={viewBoxAttr(vb)}
      direction="ltr"
      role="img"
      aria-label="מפת שכונות העיר, צבועה לפי מחיר למ״ר"
      className={`h-auto w-full ${className}`}
      onMouseLeave={() => onHover(null)}
    >
      <defs>
        {/* No-data gets a TEXTURE, not just a hue. A shape with a boundary and
            no priced cell must never be mistaken for "cheapest", and a
            distinction that rests on colour alone can always collide with the
            lightest step of the ramp — it already did, at ΔE 4.16. */}
        <pattern id="map-nodata" width={6 * k} height={6 * k} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={6 * k} height={6 * k} fill={MAP_NO_DATA} />
          <line x1="0" y1="0" x2="0" y2={6 * k} stroke="#cbd5e1" strokeWidth={1.4 * k} />
        </pattern>
      </defs>

      <rect x="0" y="0" width="1000" height="1000" fill="#fbfdff" />

      {water.map((w, i) => (
        <path key={`w${i}`} d={w.path} fill={MAP_WATER} stroke="none" />
      ))}
      {coast.map((c, i) => (
        <path key={`c${i}`} d={c.path} fill="none" stroke={MAP_COAST} strokeWidth={1.5 * k} />
      ))}

      {/* The data layer. Opaque: the declared colour is the rendered colour. */}
      {neighborhoods.map((n) => (
        <path
          key={n.neighborhood}
          d={n.path}
          fill={n.bin == null ? "url(#map-nodata)" : MAP_FILLS[n.bin]}
          fillOpacity={zoomed ? (n.neighborhood === active ? 0.3 : 0.14) : 1}
          stroke={zoomed ? "#94a3b8" : "#ffffff"}
          strokeWidth={0.9 * k}
          className="cursor-pointer"
          onMouseEnter={() => onHover(n.neighborhood)}
          onClick={() => onPin(n.neighborhood)}
        >
          <title>
            {n.summary
              ? `${n.neighborhood} — ₪${Math.round(n.summary.sqm).toLocaleString("he-IL")} למ״ר`
              : `${n.neighborhood} — אין מספיק עסקאות`}
          </title>
        </path>
      ))}

      {/* Streets ON TOP, as a white knockout. pointerEvents none so the mesh
          never steals a click meant for the shape underneath it. */}
      <g
        stroke={zoomed ? MAP_ROAD_ZOOMED : MAP_ROAD} fill="none" strokeOpacity={zoomed ? 0.85 : 0.55}
        strokeLinecap="round" strokeLinejoin="round" pointerEvents="none"
      >
        {roads.map((r, i) => (
          <path key={`r${i}`} d={r.path} strokeWidth={(ROAD_WIDTH[r.rank] ?? 0.55) * k} />
        ))}
      </g>

      {/* The selection outline is drawn AFTER the streets, so the mesh does not
          cut through it, and after every fill, so a neighbouring shape cannot
          paint over its own edge. An outline rather than an opacity change:
          with opaque fills there is no alpha left to signal with. */}
      {neighborhoods
        .filter((n) => n.neighborhood === active)
        .map((n) => (
          <path
            key={`s${n.neighborhood}`}
            d={n.path}
            fill="none"
            stroke={MAP_SELECTED}
            strokeWidth={2.4 * k}
            strokeLinejoin="round"
            pointerEvents="none"
          />
        ))}

      {children}

      {/* Street names under the shapes' labels, so a neighbourhood name is never
          hidden behind a road name. The halo is what keeps them legible over
          the deep end of the ramp. */}
      <g
        fill={MAP_ROAD_LABEL} fontSize={11 * k} fontWeight="700" textAnchor="middle"
        stroke="#ffffff" strokeWidth={2.6 * k} paintOrder="stroke" pointerEvents="none"
      >
        {roadLabels.map((r, i) => (
          <text key={`rl${i}`} x={r.x} y={r.y}>{r.name}</text>
        ))}
      </g>

      {/* Only the ACTIVE neighbourhood is named. Labelling all of them at once
          is unreadable at this size, and the table beside the map already lists
          every one. Zoomed in, the name moves to the top of the box so it does
          not sit on the pins it is describing. */}
      {neighborhoods
        .filter((n) => n.neighborhood === active)
        .map((n) => {
          const lx = zoomed ? vb.x + vb.w / 2 : n.cx;
          const ly = zoomed ? vb.y + 22 * k : n.cy;
          return (
            <g key={`l${n.neighborhood}`} pointerEvents="none">
              <text
                x={lx} y={ly}
                textAnchor="middle"
                fontSize={15 * k} fontWeight="800"
                fill={MAP_SELECTED}
                stroke="#ffffff" strokeWidth={3.5 * k} paintOrder="stroke"
              >
                {n.neighborhood}
              </text>
              {n.summary && (
                <text
                  x={lx} y={ly + 17 * k}
                  textAnchor="middle"
                  fontSize={13 * k} fontWeight="700"
                  fill={MAP_FILLS[4]}
                  stroke="#ffffff" strokeWidth={3.5 * k} paintOrder="stroke"
                >
                  ₪{Math.round(n.summary.sqm).toLocaleString("he-IL")}
                </text>
              )}
            </g>
          );
        })}
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
