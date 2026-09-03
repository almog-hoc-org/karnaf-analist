"use client";

import { PIN_RAMP, PIN_STROKE, PIN_STREET, MAP_SELECTED } from "@/lib/chartColors";
import { pinBin, type DealPoint, type HoodDealPoints } from "@/lib/dealPinTypes";
import type { ViewBox } from "@/lib/geo";

/**
 * The deals of one neighbourhood as dots on the city map.
 *
 * TWO MARKS, NOT ONE. A house-level location is a filled pin; a street-level
 * one — the building's number was never geocoded, so the dot sits on the
 * street's centre — is a hollow ring, drawn underneath. A reader must never
 * take a ring for the building: that is the one lie this layer could tell.
 *
 * SIZED IN VIEW UNITS TIMES THE ZOOM. The map zooms by shrinking its viewBox,
 * which would inflate every stroke and dot with it; multiplying by
 * `scale` (viewBox width / 1000) keeps a pin the same size on screen whether
 * the whole city or one neighbourhood fills the canvas.
 *
 * COLOUR IS RELATIVE TO THE NEIGHBOURHOOD'S MEDIAN, five steps, and the
 * legend beside the map says so. Hover reports the point to the parent, which
 * owns the tooltip (an HTML element — text inside an SVG cannot wrap).
 */
export default function DealPins({
  data, scale, activeId, onHover, onClick,
}: {
  data: HoodDealPoints;
  /** viewBox width / 1000 */
  scale: number;
  activeId: number | null;
  onHover: (p: DealPoint | null) => void;
  onClick: (p: DealPoint) => void;
}) {
  /* Sized to the SCREEN, not the canvas: the map is ~450–650px wide whatever
     the viewBox shows, so a radius of about 1% of the visible width is a
     ~5px dot — legible, and still a dot rather than a blob when a busy
     neighbourhood puts a few hundred of them side by side. */
  const r = 9 * scale;
  const ring = 7 * scale;
  const stroke = 1.6 * scale;
  const streets = data.points.filter((p) => p.level === "street");
  const houses = data.points.filter((p) => p.level === "house");
  const active = activeId == null ? null : data.points.find((p) => p.id === activeId) ?? null;

  const title = (p: DealPoint) => {
    const addr = [data.streets[p.streetIdx], p.houseNum].filter(Boolean).join(" ");
    const price = p.price == null ? "" : ` · ₪${Math.round(p.price).toLocaleString("he-IL")}`;
    return `${addr}${price}`;
  };

  return (
    <g>
      {/* rings first, so a pin on the same spot is always on top */}
      <g fill="none" stroke={PIN_STREET} strokeWidth={stroke * 1.3} strokeOpacity={0.85}>
        {streets.map((p) => (
          <circle key={p.id} cx={p.x} cy={p.y} r={ring} className="cursor-pointer"
            onMouseEnter={() => onHover(p)} onMouseLeave={() => onHover(null)} onClick={() => onClick(p)}>
            <title>{title(p)} — מיקום ברמת רחוב</title>
          </circle>
        ))}
      </g>
      <g stroke={PIN_STROKE} strokeWidth={stroke}>
        {houses.map((p) => (
          <circle key={p.id} cx={p.x} cy={p.y} r={r} fill={PIN_RAMP[pinBin(p.priceSqm, data.medianSqm)]}
            fillOpacity={0.92} className="cursor-pointer"
            onMouseEnter={() => onHover(p)} onMouseLeave={() => onHover(null)} onClick={() => onClick(p)}>
            <title>{title(p)}</title>
          </circle>
        ))}
      </g>
      {active && (
        <circle cx={active.x} cy={active.y} r={(active.level === "house" ? r : ring) + 4 * scale}
          fill="none" stroke={MAP_SELECTED} strokeWidth={stroke * 1.4} pointerEvents="none" />
      )}
    </g>
  );
}

/** Where to put the HTML tooltip: the point's position as a fraction of the
 *  square canvas, for a `relative` wrapper around the svg. */
export function pinPercent(p: DealPoint, vb: ViewBox): { left: string; top: string } {
  return {
    left: `${((p.x - vb.x) / vb.w) * 100}%`,
    top: `${((p.y - vb.y) / vb.h) * 100}%`,
  };
}

/** The tooltip's text, one line per fact. */
export function pinFacts(p: DealPoint, streets: string[]): { title: string; lines: string[] } {
  const addr = [streets[p.streetIdx], p.houseNum].filter(Boolean).join(" ");
  const fmt = (v: number | null) => (v == null ? "—" : `₪${Math.round(v).toLocaleString("he-IL")}`);
  const ym = `${String(p.ym % 100).padStart(2, "0")}/${Math.floor(p.ym / 100)}`;
  const lines = [
    [ym, p.rooms == null ? null : `${p.rooms} חד׳`, p.area == null ? null : `${Math.round(p.area)} מ״ר`, p.floor ? `קומה ${p.floor}` : null]
      .filter(Boolean).join(" · "),
    `${fmt(p.price)}${p.priceSqm == null ? "" : ` · ${fmt(p.priceSqm)}/מ״ר`}`,
  ];
  if (p.level === "street") lines.push("מיקום ברמת רחוב בלבד");
  return { title: addr || "כתובת לא ידועה", lines };
}

/** The legend row for the pins. `median` is the neighbourhood's ₪/m². */
export function PinLegend({ median, streetLevel }: { median: number | null; streetLevel: number }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-slate-500">
      <span className="font-bold">עסקאות ביחס לחציון השכונה{median ? ` (₪${Math.round(median).toLocaleString("he-IL")}/מ״ר)` : ""}:</span>
      <span className="flex items-center gap-1" dir="ltr">
        <span className="text-slate-400">−20%</span>
        {PIN_RAMP.map((c, i) => (
          <span key={i} className="inline-block h-3 w-3 rounded-full border border-white" style={{ backgroundColor: c }} />
        ))}
        <span className="text-slate-400">+20%</span>
      </span>
      {streetLevel > 0 && (
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-full border-2" style={{ borderColor: PIN_STREET }} />
          רמת רחוב
        </span>
      )}
    </div>
  );
}
