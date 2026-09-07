"use client";

import { useEffect, useMemo, useState } from "react";
import CityMap from "@/components/CityMap";
import DealPins, { pinFacts, pinPercent } from "@/components/DealPins";
import { PinsCaption } from "@/components/NeighborhoodSection";
import { withBasePath } from "@/lib/basePath";
import { FULL_VIEW, pathBBox, zoomViewBox, type ViewBox } from "@/lib/geo";
import type { CityMapView, MappedNeighborhood } from "@/lib/cityMap";
import type { DealPoint, HoodDealPoints } from "@/lib/dealPinTypes";

/**
 * The map for a street or a building: the city's shapes, zoomed to the
 * neighbourhood the street belongs to, with ONLY that street's (or that
 * building's) deals as pins. Everything else on the page is built from
 * addresses; this is the one part that needs the geocodes, and it degrades to
 * nothing — not to a wrong map — when they are missing.
 *
 * Shown on every width: a zoomed neighbourhood is legible on a phone.
 */
interface Located { x: number; y: number; level: "house" | "street"; radiusM: number; radiusUnits: number }

export default function AreaMap({
  cityName, hood, street, house, hasMap, marker = false, pinsOf = "street",
}: {
  cityName: string;
  /** the neighbourhood to zoom to, Tax Authority spelling — null zooms nowhere */
  hood: string | null;
  street: string;
  house?: string;
  hasMap: boolean;
  /** mark the address itself (geocoded) and draw the comparison radius around it */
  marker?: boolean;
  /** whose deals are the pins: this street's / building's, or the whole neighbourhood's */
  pinsOf?: "street" | "hood";
}) {
  const [map, setMap] = useState<CityMapView | null>(null);
  const [pins, setPins] = useState<HoodDealPoints | null>(null);
  const [located, setLocated] = useState<Located | null>(null);
  const [hoveredPin, setHoveredPin] = useState<DealPoint | null>(null);
  const [clicked, setClicked] = useState<DealPoint | null>(null);

  useEffect(() => {
    if (!hasMap) return;
    let cancelled = false;
    fetch(withBasePath(`/api/city-map/${encodeURIComponent(cityName)}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (!cancelled) setMap(j.map ?? null); })
      .catch(() => { if (!cancelled) setMap(null); });
    const q = new URLSearchParams({ scope: "all", from: "2016", to: "2100" });
    if (pinsOf === "hood" && hood) q.set("neighborhood", hood);
    else { q.set("street", street); if (house) q.set("house", house); }
    fetch(withBasePath(`/api/city-map/${encodeURIComponent(cityName)}/deals?${q}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: HoodDealPoints) => { if (!cancelled) setPins(j); })
      .catch(() => { if (!cancelled) setPins(null); });
    if (marker && house) {
      const lq = new URLSearchParams({ street, house });
      fetch(withBasePath(`/api/city-map/${encodeURIComponent(cityName)}/locate?${lq}`))
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j: Located) => { if (!cancelled) setLocated(j); })
        .catch(() => { if (!cancelled) setLocated(null); });
    }
    return () => { cancelled = true; };
  }, [cityName, street, house, hood, hasMap, marker, pinsOf]);

  const shape: MappedNeighborhood | null = useMemo(
    () => (hood && map ? map.neighborhoods.find((n) => n.summary?.neighborhood === hood) ?? null : null),
    [map, hood]
  );
  const viewBox: ViewBox = useMemo(() => {
    // a marked building: the box around its radius, so "what is within 300 m"
    // is what the reader sees; else the neighbourhood; else the pins' extent
    if (located && located.level === "house") {
      const r = Math.max(located.radiusUnits, 20) * 1.5;
      return zoomViewBox({ x: located.x - r, y: located.y - r, w: 2 * r, h: 2 * r }, { pad: 0.1, min: 100 });
    }
    if (shape) { const b = pathBBox(shape.path); if (b) return zoomViewBox(b); }
    if (pins && pins.points.length) {
      const xs = pins.points.map((p) => p.x), ys = pins.points.map((p) => p.y);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      return zoomViewBox({ x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 }, { pad: 0.6, min: 160 });
    }
    return FULL_VIEW;
  }, [shape, pins, located]);

  if (!hasMap || !map) return null;
  const k = viewBox.w / 1000;
  const showPins = !!pins && pins.worthShowing;
  const tooltip = hoveredPin && pins ? { ...pinFacts(hoveredPin, pins.streets), pos: pinPercent(hoveredPin, viewBox) } : null;

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <CityMap
          cityName={cityName}
          neighborhoods={map.neighborhoods}
          lines={map.lines}
          active={shape?.neighborhood ?? null}
          onHover={() => {}}
          onPin={() => {}}
          viewBox={viewBox}
        >
          {/* the comparison radius, under the pins: the ground the verdict was measured on */}
          {located && located.level === "house" && located.radiusUnits > 0 && (
            <circle
              cx={located.x} cy={located.y} r={located.radiusUnits}
              fill="#4f46e5" fillOpacity={0.06} stroke="#4f46e5" strokeOpacity={0.7}
              strokeWidth={1.2 * k} strokeDasharray={`${4 * k} ${3 * k}`} pointerEvents="none"
            />
          )}
          {showPins && pins && (
            <DealPins
              data={pins}
              scale={viewBox.w / 1000}
              activeId={clicked?.id ?? hoveredPin?.id ?? null}
              onHover={setHoveredPin}
              onClick={setClicked}
            />
          )}
          {/* the address itself, over everything: a target, not a pin, so it
              can never pass for a deal */}
          {located && (
            <g pointerEvents="none">
              <circle cx={located.x} cy={located.y} r={9 * k} fill="none" stroke="#ffffff" strokeWidth={3.5 * k} />
              <circle cx={located.x} cy={located.y} r={9 * k} fill="none" stroke="#1e1b4b" strokeWidth={2 * k} />
              <circle cx={located.x} cy={located.y} r={2.6 * k} fill="#1e1b4b" />
              <text
                x={located.x} y={located.y - 13 * k} textAnchor="middle" fontSize={12 * k} fontWeight="800"
                fill="#1e1b4b" stroke="#ffffff" strokeWidth={3 * k} paintOrder="stroke"
              >
                {street} {house}
              </text>
            </g>
          )}
        </CityMap>
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 w-max max-w-[220px] -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-2xs leading-snug text-slate-700 shadow-lg"
            style={{ left: tooltip.pos.left, top: tooltip.pos.top }}
            dir="rtl"
          >
            <div className="font-extrabold text-slate-900">{tooltip.title}</div>
            {tooltip.lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
      </div>
      <PinsCaption pins={pins} showPins={showPins} />
      {marker && house && (
        <p className="mt-1 text-2xs text-slate-500">
          {located
            ? located.level === "house"
              ? `הבניין מסומן במטרה; העיגול המקווקו הוא רדיוס ${located.radiusM} מ׳ — אותו רדיוס שבו נמדדה ההשוואה`
              : "הבניין עצמו לא ממוקם עדיין — המטרה מסמנת את מרכז הרחוב"
            : "הכתובת הזו עוד לא ממוקמת על המפה — המפה מציגה את השכונה"}
        </p>
      )}
      {clicked && (
        <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-2xs leading-snug text-slate-700">
          {(() => { const f = pinFacts(clicked, pins?.streets ?? []); return (<><div className="font-extrabold text-slate-900">{f.title}</div>{f.lines.map((l, i) => <div key={i}>{l}</div>)}</>); })()}
        </div>
      )}
      <p className="mt-1 text-2xs text-slate-400">גבולות ורחובות: © תורמי OpenStreetMap</p>
    </div>
  );
}
