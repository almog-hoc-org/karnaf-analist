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
export default function AreaMap({
  cityName, hood, street, house, hasMap,
}: {
  cityName: string;
  /** the neighbourhood to zoom to, Tax Authority spelling — null zooms nowhere */
  hood: string | null;
  street: string;
  house?: string;
  hasMap: boolean;
}) {
  const [map, setMap] = useState<CityMapView | null>(null);
  const [pins, setPins] = useState<HoodDealPoints | null>(null);
  const [hoveredPin, setHoveredPin] = useState<DealPoint | null>(null);
  const [clicked, setClicked] = useState<DealPoint | null>(null);

  useEffect(() => {
    if (!hasMap) return;
    let cancelled = false;
    fetch(withBasePath(`/api/city-map/${encodeURIComponent(cityName)}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (!cancelled) setMap(j.map ?? null); })
      .catch(() => { if (!cancelled) setMap(null); });
    const q = new URLSearchParams({ street, scope: "all", from: "2016", to: "2100" });
    if (house) q.set("house", house);
    fetch(withBasePath(`/api/city-map/${encodeURIComponent(cityName)}/deals?${q}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: HoodDealPoints) => { if (!cancelled) setPins(j); })
      .catch(() => { if (!cancelled) setPins(null); });
    return () => { cancelled = true; };
  }, [cityName, street, house, hasMap]);

  const shape: MappedNeighborhood | null = useMemo(
    () => (hood && map ? map.neighborhoods.find((n) => n.summary?.neighborhood === hood) ?? null : null),
    [map, hood]
  );
  const viewBox: ViewBox = useMemo(() => {
    // zoom to the neighbourhood when it has a shape; else to the pins' own extent
    if (shape) { const b = pathBBox(shape.path); if (b) return zoomViewBox(b); }
    if (pins && pins.points.length) {
      const xs = pins.points.map((p) => p.x), ys = pins.points.map((p) => p.y);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      return zoomViewBox({ x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 }, { pad: 0.6, min: 160 });
    }
    return FULL_VIEW;
  }, [shape, pins]);

  if (!hasMap || !map) return null;
  const showPins = !!pins && pins.worthShowing;
  const tooltip = hoveredPin && pins ? { ...pinFacts(hoveredPin, pins.streets), pos: pinPercent(hoveredPin, viewBox) } : null;

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <CityMap
          neighborhoods={map.neighborhoods}
          lines={map.lines}
          active={shape?.neighborhood ?? null}
          onHover={() => {}}
          onPin={() => {}}
          viewBox={viewBox}
        >
          {showPins && pins && (
            <DealPins
              data={pins}
              scale={viewBox.w / 1000}
              activeId={clicked?.id ?? hoveredPin?.id ?? null}
              onHover={setHoveredPin}
              onClick={setClicked}
            />
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
      {clicked && (
        <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-2xs leading-snug text-slate-700">
          {(() => { const f = pinFacts(clicked, pins?.streets ?? []); return (<><div className="font-extrabold text-slate-900">{f.title}</div>{f.lines.map((l, i) => <div key={i}>{l}</div>)}</>); })()}
        </div>
      )}
      <p className="mt-1 text-2xs text-slate-400">גבולות ורחובות: © תורמי OpenStreetMap</p>
    </div>
  );
}
