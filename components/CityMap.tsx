"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { MappedNeighborhood, MapLine } from "@/lib/cityMap";
import {
  MAP_FILLS, MAP_NO_DATA, MAP_WATER, MAP_COAST, MAP_ROAD, MAP_ROAD_ZOOMED, MAP_ROAD_LABEL, MAP_SELECTED,
} from "@/lib/chartColors";
import { FULL_VIEW, VIEW_SIZE, viewBoxAttr, type ViewBox } from "@/lib/geo";
import { withBasePath } from "@/lib/basePath";
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
const ROAD_WIDTH: Record<number, number> = { 1: 1.9, 2: 1.5, 3: 1.1, 4: 0.8, 5: 0.55, 6: 0.42, 7: 0.32 };

/** At most this many street names. Beyond it the map is a word cloud. */
const MAX_ROAD_LABELS = 10;
/** Zoomed in, more names fit and each one matters more. */
const MAX_ROAD_LABELS_ZOOMED = 16;
/** The narrowest box the wheel can reach: 12× the city. */
const MIN_BOX = 80;

const clampBox = (b: ViewBox): ViewBox => {
  const w = Math.min(VIEW_SIZE, Math.max(MIN_BOX, b.w));
  return { x: Math.max(0, Math.min(VIEW_SIZE - w, b.x)), y: Math.max(0, Math.min(VIEW_SIZE - w, b.y)), w, h: w };
};

export default function CityMap({
  neighborhoods,
  lines,
  active,
  onHover,
  onPin,
  viewBox,
  children,
  cityName,
  className = "",
}: {
  neighborhoods: MappedNeighborhood[];
  lines: MapLine[];
  /** with it, the zoomed view fetches the local streets of the box on screen */
  cityName?: string;
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
  // THE READER'S OWN ZOOM, ON TOP OF THE PAGE'S. The page decides the box
  // (the whole city, a pinned neighbourhood); the wheel and a drag let the
  // reader move inside it, and any new box from the page resets that. Wheel
  // zoom arms only after a click on the map or with Ctrl/⌘ held, so a page
  // scrolling past the map is never hijacked (user request, 7.9.2026:
  // "continuous zoom in and out, hard to navigate").
  const base = viewBox ?? FULL_VIEW;
  const baseKey = `${base.x},${base.y},${base.w},${base.h}`;
  const [userBox, setUserBox] = useState<ViewBox | null>(null);
  const [armed, setArmed] = useState(false);
  useEffect(() => { setUserBox(null); }, [baseKey]);
  const vb = useAnimatedViewBox(userBox ?? base, userBox ? 0 : 350);
  const k = vb.w / VIEW_SIZE;

  const svgRef = useRef<SVGSVGElement>(null);
  const vbRef = useRef(vb);
  vbRef.current = vb;
  const armedRef = useRef(false);
  armedRef.current = armed;
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!armedRef.current && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const cur = vbRef.current;
      const rect = el.getBoundingClientRect();
      const w = Math.min(VIEW_SIZE, Math.max(MIN_BOX, cur.w * Math.exp(e.deltaY * 0.0012)));
      const mx = cur.x + ((e.clientX - rect.left) / rect.width) * cur.w;
      const my = cur.y + ((e.clientY - rect.top) / rect.height) * cur.h;
      const r = w / cur.w;
      setUserBox(clampBox({ x: mx - (mx - cur.x) * r, y: my - (my - cur.y) * r, w, h: w }));
    };
    // passive:false so preventDefault can stop the page scrolling under the zoom
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const drag = useRef<{ x: number; y: number; box: ViewBox; moved: boolean } | null>(null);
  const draggedRef = useRef(false);
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    draggedRef.current = false;
    setArmed(true);
    drag.current = { x: e.clientX, y: e.clientY, box: vbRef.current, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    draggedRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    setUserBox(clampBox({ ...d.box, x: d.box.x - (dx / rect.width) * d.box.w, y: d.box.y - (dy / rect.height) * d.box.h }));
  };
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  };
  // a drag must not count as a click on the shape it ended over
  const pin = (name: string | null) => { if (!draggedRef.current) onPin(name); };
  const resetZoom = () => setUserBox(null);
  // ZOOMED IN, THE FILL STEPS BACK. At city scale the colour IS the
  // information. Inside one neighbourhood the information is the pins, the
  // streets and the names, and an opaque fill hid all three (user report,
  // 7.9.2026, Bat Yam). So the fills fade to a tint, the pinned one a little
  // stronger than its neighbours, and the road mesh turns from white knockout
  // to a grey line — white over a pale tint is invisible.
  const zoomed = k < 0.6;

  const water = useMemo(() => lines.filter((l) => l.kind === "water"), [lines]);
  const coast = useMemo(() => lines.filter((l) => l.kind === "coast"), [lines]);
  const arteries = useMemo(() => lines.filter((l) => l.kind === "road"), [lines]);

  // THE LOCAL STREETS, FETCHED FOR THE BOX ON SCREEN. The whole-city payload
  // carries the arteries only; zoomed in, the residential streets and their
  // names are what a reader orients by. One request per box, and a box that
  // is still inside the last fetched one (fetched 1.6× larger) costs nothing.
  const [local, setLocal] = useState<{ box: ViewBox; lines: MapLine[] } | null>(null);
  useEffect(() => {
    if (!zoomed || !cityName) return;
    const inside = local && vb.x >= local.box.x && vb.y >= local.box.y
      && vb.x + vb.w <= local.box.x + local.box.w && vb.y + vb.h <= local.box.y + local.box.h;
    if (inside) return;
    const side = vb.w * 1.6;
    const box = { x: Math.max(0, vb.x - (side - vb.w) / 2), y: Math.max(0, vb.y - (side - vb.h) / 2), w: side, h: side };
    let cancelled = false;
    const t = setTimeout(() => {
      const q = new URLSearchParams({ x: box.x.toFixed(1), y: box.y.toFixed(1), w: box.w.toFixed(1), h: box.h.toFixed(1) });
      fetch(withBasePath(`/api/city-map/${encodeURIComponent(cityName)}/streets?${q}`))
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j: { lines: MapLine[] }) => { if (!cancelled) setLocal({ box, lines: j.lines ?? [] }); })
        .catch(() => { if (!cancelled) setLocal({ box, lines: [] }); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [zoomed, cityName, vb.x, vb.y, vb.w, vb.h, local]);
  const roads = useMemo(() => (zoomed && local ? [...arteries, ...local.lines] : arteries), [arteries, local, zoomed]);

  /* The longest named arteries, one label each. Longest is the right proxy for
     "the road a reader orients by", and it needs no extra data. */
  const namedRoads = useMemo(
    () => roads.filter((r) => r.name).map((r) => { const [x, y] = midPoint(r.path); return { name: r.name!, rank: r.rank, length: r.length, x, y }; }),
    [roads]
  );
  const roadLabels = useMemo(() => {
    // Zoomed in: every named road whose midpoint is in view, the long ones
    // first — inside a neighbourhood the small streets are the orientation.
    // Zoomed out: the city's arteries only.
    const inView = zoomed
      ? namedRoads.filter((r) => r.x >= vb.x && r.x <= vb.x + vb.w && r.y >= vb.y && r.y <= vb.y + vb.h)
      : namedRoads.filter((r) => r.rank <= 3);
    const seen = new Set<string>();
    return [...inView]
      .sort((a, b) => b.length - a.length)
      .filter((r) => (seen.has(r.name) ? false : (seen.add(r.name), true)))
      .slice(0, zoomed ? MAX_ROAD_LABELS_ZOOMED : MAX_ROAD_LABELS);
  }, [namedRoads, zoomed, vb.x, vb.y, vb.w, vb.h]);

  return (
    <div className="relative">
    <svg
      ref={svgRef}
      viewBox={viewBoxAttr(vb)}
      direction="ltr"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={resetZoom}
      style={{ cursor: drag.current?.moved ? "grabbing" : "grab", touchAction: "none" }}
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
          onClick={() => pin(n.neighborhood)}
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
    {userBox && (
      <button
        type="button"
        onClick={resetZoom}
        className="absolute left-2 top-2 rounded-lg border border-slate-200 bg-white/90 px-2 py-1 text-2xs font-bold text-slate-600 shadow-sm hover:bg-white"
        title="חזרה לתצוגה המלאה"
      >
        ⟲ איפוס
      </button>
    )}
    {!armed && (
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-lg bg-white/85 px-2 py-1 text-2xs text-slate-500">
        לחיצה על המפה, ואז גלגלת להתקרב וגרירה להזיז
      </div>
    )}
    </div>
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
