"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import InfoTip from "@/components/InfoTip";
import CityMap from "@/components/CityMap";
import DealPins, { PinLegend, pinFacts, pinPercent } from "@/components/DealPins";
import { useIsMobile } from "@/lib/useIsMobile";
import { withBasePath } from "@/lib/basePath";
import NeighborhoodPrices from "@/components/NeighborhoodPrices";
import NeighborhoodDetail from "@/components/NeighborhoodDetail";
import { MAP_FILLS, MAP_NO_DATA } from "@/lib/chartColors";
import { FULL_VIEW, pathBBox, zoomViewBox, type ViewBox } from "@/lib/geo";
import { hoodPointsQuery, presetRange, type DealScope, type YearPreset } from "@/lib/neighborhoodDeals";
import type { CityMapView } from "@/lib/cityMap";
import type { DealPoint, HoodDealPoints } from "@/lib/dealPinTypes";
import type { NeighborhoodSummary } from "@/lib/neighborhoods";

/**
 * "Which part of this city is expensive" — the table that answers it, and the
 * map that says where. And, one click deeper, WHICH BUILDINGS.
 *
 * ONE PIECE OF STATE FOR BOTH. The map and the table are two views of the same
 * rows, so the highlight has to live above them: hovering a shape lights its
 * row, hovering a row lights its shape. Two independent hover states would let
 * the two disagree about what the reader is pointing at.
 *
 * A CLICK OPENS — AND ZOOMS. Hover alone is unusable for reading a number —
 * the moment the pointer leaves the shape to reach the row, the highlight is
 * gone — so a click pins the neighbourhood, swaps the table out for that one
 * neighbourhood's own figures and its deals, and zooms the map to it. At that
 * zoom the located deals are drawn as pins (components/DealPins), and the
 * same pattern repeats one level down: hovering a pin lights its row in the
 * deals table, hovering a row lights its pin. Hover deliberately never
 * fetches: it only highlights, so crossing the map with the pointer cannot
 * swap the panel out from under the reader, and cannot fire a request per
 * shape.
 *
 * THE SCOPE AND THE YEARS LIVE HERE, not in the panel, because the pins and
 * the deals list must describe ONE population — the list says "30 deals",
 * the map draws those 30. The panel used to own the scope; it moved up the
 * day the map got pins.
 *
 * THE NUMBERS LIVE IN THE TABLE. The map shows the name and ₪/m² of whatever
 * is active and nothing else. Repeating change, vs-city and deal count on the
 * map would make the two halves two copies of one thing, which is the failure
 * mode this layout exists to avoid.
 *
 * With no map for this city — the collector has not run on it, which is the
 * normal state outside the pilot — this renders exactly the standalone table
 * that shipped before, unchanged.
 *
 * THE GEOMETRY IS FETCHED, NOT SERVER-RENDERED. `hidden lg:block` hides pixels,
 * not bytes: server-rendering a city's outlines and streets would send ~100KB
 * of path strings to every phone, where the map is never shown. The server
 * sends one boolean; a wide screen asks for the rest after paint.
 */
export default function NeighborhoodSection({
  cityName, rows, year, citySqm, minDeals, scopeLabel, hasMap,
}: {
  cityName: string;
  rows: NeighborhoodSummary[];
  year: number | null;
  citySqm: number | null;
  minDeals: number;
  scopeLabel: string;
  /** whether this city HAS a drawable map — the geometry itself is fetched */
  hasMap: boolean;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [map, setMap] = useState<CityMapView | null>(null);
  const [scope, setScope] = useState<DealScope>("sh");
  const [preset, setPreset] = useState<YearPreset>("default");
  const [pins, setPins] = useState<HoodDealPoints | null>(null);
  const [latestYear, setLatestYear] = useState<number | null>(null);
  const [hoveredPin, setHoveredPin] = useState<DealPoint | null>(null);
  const [activeDealId, setActiveDealId] = useState<number | null>(null);
  const [clickedPin, setClickedPin] = useState<DealPoint | null>(null);
  const active = hovered ?? pinned;
  const narrow = useIsMobile(1023); // Tailwind lg — the width the map needs

  useEffect(() => {
    if (!hasMap || narrow) return;
    let cancelled = false;
    fetch(withBasePath(`/api/city-map/${encodeURIComponent(cityName)}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (!cancelled) setMap(j.map ?? null); })
      // A map that fails to load leaves the table, which is the whole answer
      // minus the "where". Nothing to announce.
      .catch(() => { if (!cancelled) setMap(null); });
    return () => { cancelled = true; };
  }, [cityName, hasMap, narrow]);

  /* The pinned shape, resolved to the mapped row. Resolved from `pinned` and
     never from `active`: `active` follows the pointer, and a panel that
     followed the pointer would be unreadable. */
  const openHood = pinned && map ? map.neighborhoods.find((n) => n.neighborhood === pinned) ?? null : null;
  const range = presetRange(preset, latestYear);

  /* The pins, fetched when a priced hood is pinned and again when the scope
     or the window changes. One request per click, cached an hour upstream. */
  const pointsKey = openHood?.summary ? `${cityName}|${openHood.summary.neighborhood}|${scope}|${range.from ?? ""}|${range.to ?? ""}` : null;
  useEffect(() => {
    setHoveredPin(null); setActiveDealId(null); setClickedPin(null);
    if (!pointsKey || !openHood) { setPins(null); return; }
    const q = hoodPointsQuery(openHood, scope, range);
    if (!q) { setPins(null); return; }
    let cancelled = false;
    fetch(withBasePath(`/api/city-map/${encodeURIComponent(cityName)}/deals?${q}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: HoodDealPoints) => {
        if (cancelled) return;
        setPins(j);
        // the latest year the server served becomes the anchor for the presets
        if (j.years && preset === "default") setLatestYear(j.years[1]);
      })
      .catch(() => { if (!cancelled) setPins(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsKey]);

  const viewBox: ViewBox = useMemo(() => {
    if (!openHood) return FULL_VIEW;
    const b = pathBBox(openHood.path);
    return b ? zoomViewBox(b) : FULL_VIEW;
  }, [openHood]);

  if (!rows.length) return null;

  if (!hasMap || narrow || !map) {
    return (
      <NeighborhoodPrices
        cityName={cityName} rows={rows} year={year}
        citySqm={citySqm} minDeals={minDeals} scopeLabel={scopeLabel}
      />
    );
  }

  const fmt = (v: number) => `₪${Math.round(v).toLocaleString("he-IL")}`;
  const togglePin = (name: string | null) => {
    setPinned((cur) => (cur === name ? null : name));
    setLatestYear(null); setPreset("default");
  };
  const showPins = !!pins && pins.worthShowing;
  const tooltip = hoveredPin && pins ? { ...pinFacts(hoveredPin, pins.streets), pos: pinPercent(hoveredPin, viewBox) } : null;

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-xl text-white shadow">
          <Icon name="building" size="1em" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 text-xl font-extrabold leading-tight text-slate-900 sm:text-2xl">
            שכונות ב{cityName} — מחיר למ״ר
            <InfoTip
              label="על המפה והטבלה"
              text={`${scopeLabel} · ${year} · רק שכונות עם ${minDeals}+ עסקאות באותה שנה${
                citySqm ? ` · ממוצע העיר לפי אותן עסקאות: ${fmt(citySqm)}` : ""
              }. עומק הכחול נקבע לפי המחיר למ״ר ביחס לשאר השכונות באותה עיר, ולכן אינו ניתן להשוואה בין ערים. ${
                map.unmatchedPriced.length
                  ? `${map.unmatchedPriced.length} שכונות מופיעות בטבלה ואין להן גבול משורטט: ${map.unmatchedPriced.join(", ")}.`
                  : "לכל השכונות שבטבלה יש גבול משורטט."
              } לחיצה על שכונה מקרבת אליה ומציגה את העסקאות שלה כנקודות — כל נקודה היא בניין שדווחה בו עסקה.`}
            />
          </h2>
          <p className="mt-1 truncate text-xs text-slate-500">
            {map.matched} שכונות על המפה · לחצו על שכונה כדי להתקרב אליה ולראות את העסקאות שלה על המפה
          </p>
        </div>
      </div>

      {/* Map on the wide screen only. A city map at 375px is unreadable, and
          below lg: this section is exactly the table it has always been. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <div>
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <CityMap
              neighborhoods={map.neighborhoods}
              lines={map.lines}
              active={active}
              onHover={setHovered}
              onPin={togglePin}
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
            {openHood && (
              <button
                type="button"
                onClick={() => togglePin(null)}
                className="absolute right-2 top-2 rounded-lg border border-slate-300 bg-white/90 px-2 py-1 text-2xs font-bold text-slate-600 shadow-sm backdrop-blur hover:bg-white"
              >
                ← כל העיר
              </button>
            )}
          </div>
          {openHood ? (
            <PinsCaption pins={pins} showPins={showPins} />
          ) : (
            <Legend edges={map.binEdges} fmt={fmt} />
          )}
        </div>

        {/* No max-height and no overflow here. A scroll box in this column
            clipped six of Tel Aviv's eighteen rows and fed a second, horizontal
            scrollbar inside the table; the compact row height is what makes the
            full list fit instead. */}
        <div>
          {openHood ? (
            <NeighborhoodDetail
              cityName={cityName}
              hood={openHood}
              onBack={() => togglePin(null)}
              scope={scope} onScope={setScope}
              preset={preset} onPreset={setPreset}
              range={range}
              activeDealId={activeDealId}
              onHoverDeal={(id) => setActiveDealId(id ?? clickedPin?.id ?? null)}
              clickedPin={clickedPin}
              pinStreets={pins?.streets ?? []}
              servedYears={pins?.years ?? null}
            />
          ) : (
            <NeighborhoodPrices
              cityName={cityName} rows={rows} year={year}
              citySqm={citySqm} minDeals={minDeals} scopeLabel={scopeLabel}
              active={active} onHover={setHovered} onPin={togglePin} compact
            />
          )}
        </div>
      </div>

      <p className="mt-2 text-2xs leading-relaxed text-slate-400">
        <Icon name="source-own" size="1em" /> מחירים: העסקאות שנאספו ונוקו — שם השכונה כפי שדווח לרשות המסים ·
        גבולות ורחובות: © תורמי OpenStreetMap
        {" "}<Link href="/methodology" className="underline hover:text-indigo-700">מתודולוגיה →</Link>
      </p>
    </section>
  );
}

/**
 * What the pins mean and, first, HOW MANY of the neighbourhood's deals they
 * are. A map that shows a third of the deals and says nothing reads as "only
 * these sold" — the count is not decoration.
 */
export function PinsCaption({ pins, showPins }: { pins: HoodDealPoints | null; showPins: boolean }) {
  if (!pins) return <p className="mt-2 text-2xs text-slate-400">טוען את מיקומי העסקאות…</p>;
  const years = pins.years ? (pins.years[0] === pins.years[1] ? `${pins.years[0]}` : `${pins.years[0]}–${pins.years[1]}`) : "";
  if (!showPins) {
    return (
      <p className="mt-2 text-2xs leading-relaxed text-slate-500">
        {pins.total === 0
          ? `אין עסקאות בהיקף הזה${years ? ` (${years})` : ""}.`
          : `${pins.located.toLocaleString("he-IL")} מתוך ${pins.total.toLocaleString("he-IL")} העסקאות בשכונה${years ? ` (${years})` : ""} ניתנות למיקום על המפה — מעט מדי כדי להציג נקודות בלי להטעות. הרשימה משמאל מלאה.`}
      </p>
    );
  }
  return (
    <div>
      <p className="mt-2 text-2xs leading-relaxed text-slate-500">
        <b className="text-slate-700">{pins.located.toLocaleString("he-IL")} מתוך {pins.total.toLocaleString("he-IL")}</b> העסקאות בשכונה{years ? ` (${years})` : ""} ממוקמות על המפה
        {pins.streetLevel > 0 ? ` · ${pins.streetLevel.toLocaleString("he-IL")} ברמת רחוב בלבד` : ""}
        {pins.capped ? ` · מוצגות ${pins.points.length.toLocaleString("he-IL")} האחרונות` : ""}
        {pins.located < pins.total ? " · השאר דווחו ללא כתובת שניתן למקם" : ""}
      </p>
      <PinLegend median={pins.medianSqm} streetLevel={pins.streetLevel} />
    </div>
  );
}

/** What each shade means, in shekels. A colour scale with no legend is a
 *  decoration — and this one is per-city, so the reader cannot infer it.
 *
 *  The swatches come from lib/chartColors, not from a local copy. There WAS a
 *  local copy, and it had already drifted from the map's: the legend drew the
 *  no-data grey at full opacity while the map drew it at 0.55, so the two were
 *  describing different colours to the same reader. */
function Legend({ edges, fmt }: { edges: number[]; fmt: (v: number) => string }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-slate-500">
      <span className="font-bold">מחיר למ״ר:</span>
      <span className="flex items-center gap-1">
        {MAP_FILLS.map((c, i) => (
          <span key={i} className="h-3 w-6 rounded-sm border border-white" style={{ backgroundColor: c }} />
        ))}
      </span>
      {edges.length > 0 && (
        <span className="tabular-nums" dir="ltr">
          {fmt(edges[0])} – {fmt(edges[edges.length - 1])}
        </span>
      )}
      <span className="flex items-center gap-1">
        <span
          className="h-3 w-6 rounded-sm border border-white"
          style={{
            backgroundColor: MAP_NO_DATA,
            backgroundImage: "repeating-linear-gradient(45deg, #cbd5e1 0 1.4px, transparent 1.4px 6px)",
          }}
        />
        אין מספיק עסקאות
      </span>
    </div>
  );
}
