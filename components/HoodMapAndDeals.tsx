"use client";

import { useEffect, useMemo, useState } from "react";
import CityMap from "@/components/CityMap";
import DealPins, { pinFacts, pinPercent } from "@/components/DealPins";
import HoodDealsTable from "@/components/HoodDealsTable";
import { PinsCaption } from "@/components/NeighborhoodSection";
import { withBasePath } from "@/lib/basePath";
import { FULL_VIEW, pathBBox, zoomViewBox, type ViewBox } from "@/lib/geo";
import { hoodPointsQuery, presetRange, YEAR_PRESETS, type YearPreset } from "@/lib/neighborhoodDeals";
import type { CityMapView, MappedNeighborhood } from "@/lib/cityMap";
import type { DealPoint, HoodDealPoints } from "@/lib/dealPinTypes";
import type { NadlanDeal } from "@/lib/nadlanTransactionSeries";

/**
 * The neighbourhood page's map and its deal history, sharing one highlight.
 *
 * The same pair the city page shows after a click — here the click has
 * already happened (the reader is ON the neighbourhood's page), so the map
 * opens zoomed to it, with the pins, on every width. A zoomed neighbourhood
 * in a 343px square is legible in a way a whole city is not, and the section
 * is short, so the phone gets it too. The whole-city map stays desktop-only
 * on the city page; the rule there is unchanged.
 *
 * The first page of deals arrived from the server as props (real rows in the
 * HTML); the geometry and the points are fetched after paint, cached an hour
 * upstream, and the map simply does not appear if either fails — the table
 * is the answer, the map is the "where".
 */
export default function HoodMapAndDeals({
  cityName, neighborhood, scope, initialDeals, total, hasMap,
}: {
  cityName: string;
  /** Tax Authority spelling */
  neighborhood: string;
  scope: "secondhand" | "all";
  initialDeals: NadlanDeal[];
  total: number;
  hasMap: boolean;
}) {
  const [map, setMap] = useState<CityMapView | null>(null);
  const [pins, setPins] = useState<HoodDealPoints | null>(null);
  const [preset, setPreset] = useState<YearPreset>("all");
  const [latestYear, setLatestYear] = useState<number | null>(null);
  const [hoveredPin, setHoveredPin] = useState<DealPoint | null>(null);
  const [activeDealId, setActiveDealId] = useState<number | null>(null);
  const [clickedPin, setClickedPin] = useState<DealPoint | null>(null);

  useEffect(() => {
    if (!hasMap) return;
    let cancelled = false;
    fetch(withBasePath(`/api/city-map/${encodeURIComponent(cityName)}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (!cancelled) setMap(j.map ?? null); })
      .catch(() => { if (!cancelled) setMap(null); });
    return () => { cancelled = true; };
  }, [cityName, hasMap]);

  /* The shape whose PRICE ROW is this page's neighbourhood — matched on the
     Tax Authority spelling, which is what the URL carries. */
  const hood: MappedNeighborhood | null = useMemo(
    () => map?.neighborhoods.find((n) => n.summary?.neighborhood === neighborhood) ?? null,
    [map, neighborhood]
  );

  // The page's table is all years; "all" is therefore the pins' default here.
  const range = presetRange(preset, latestYear);
  const dealScope = scope === "secondhand" ? "sh" : "all";
  const pointsKey = hood ? `${cityName}|${neighborhood}|${dealScope}|${range.from ?? ""}|${range.to ?? ""}` : null;
  useEffect(() => {
    setHoveredPin(null); setActiveDealId(null); setClickedPin(null);
    if (!pointsKey || !hood) { setPins(null); return; }
    const q = hoodPointsQuery(hood, dealScope, preset === "all" && !latestYear ? { from: 2016, to: 2100 } : range);
    if (!q) return;
    let cancelled = false;
    fetch(withBasePath(`/api/city-map/${encodeURIComponent(cityName)}/deals?${q}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: HoodDealPoints) => {
        if (cancelled) return;
        setPins(j);
        if (j.years && latestYear == null) setLatestYear(j.years[1]);
      })
      .catch(() => { if (!cancelled) setPins(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsKey]);

  const viewBox: ViewBox = useMemo(() => {
    if (!hood) return FULL_VIEW;
    const b = pathBBox(hood.path);
    return b ? zoomViewBox(b) : FULL_VIEW;
  }, [hood]);

  const showPins = !!pins && pins.worthShowing;
  const tooltip = hoveredPin && pins ? { ...pinFacts(hoveredPin, pins.streets), pos: pinPercent(hoveredPin, viewBox) } : null;

  return (
    <div className={map && hood ? "grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]" : ""}>
      {map && hood && (
        <div>
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <CityMap
              cityName={cityName}
              neighborhoods={map.neighborhoods}
              lines={map.lines}
              active={hood.neighborhood}
              onHover={() => {}}
              onPin={() => {}}
              viewBox={viewBox}
            >
              {showPins && pins && (
                <DealPins
                  data={pins}
                  scale={viewBox.w / 1000}
                  activeId={activeDealId ?? hoveredPin?.id ?? null}
                  onHover={(p) => { setHoveredPin(p); setActiveDealId(p?.id ?? clickedPin?.id ?? null); }}
                  onClick={(p) => { setClickedPin(p); setActiveDealId(p.id); }}
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
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {YEAR_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                aria-pressed={preset === p.id}
                className={`chip-action ${preset === p.id ? "border-slate-700 bg-slate-700 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <PinsCaption pins={pins} showPins={showPins} />
          {clickedPin && (
            <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-2xs leading-snug text-slate-700">
              <div className="text-slate-500">העסקה שנבחרה על המפה</div>
              {(() => { const f = pinFacts(clickedPin, pins?.streets ?? []); return (<><div className="font-extrabold text-slate-900">{f.title}</div>{f.lines.map((l, i) => <div key={i}>{l}</div>)}</>); })()}
            </div>
          )}
          <p className="mt-1 text-2xs text-slate-400">גבולות ורחובות: © תורמי OpenStreetMap</p>
        </div>
      )}
      <HoodDealsTable
        cityName={cityName}
        neighborhood={neighborhood}
        scope={scope}
        initialDeals={initialDeals}
        total={total}
        activeDealId={activeDealId}
        onHoverDeal={(id) => setActiveDealId(id ?? clickedPin?.id ?? null)}
      />
    </div>
  );
}
