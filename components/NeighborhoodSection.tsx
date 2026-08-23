"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import InfoTip from "@/components/InfoTip";
import CityMap from "@/components/CityMap";
import { useIsMobile } from "@/lib/useIsMobile";
import { withBasePath } from "@/lib/basePath";
import NeighborhoodPrices from "@/components/NeighborhoodPrices";
import type { CityMapView } from "@/lib/cityMap";
import type { NeighborhoodSummary } from "@/lib/neighborhoods";

/**
 * "Which part of this city is expensive" — the table that answers it, and the
 * map that says where.
 *
 * ONE PIECE OF STATE FOR BOTH. The map and the table are two views of the same
 * rows, so the highlight has to live above them: hovering a shape lights its
 * row, hovering a row lights its shape. Two independent hover states would let
 * the two disagree about what the reader is pointing at.
 *
 * A CLICK PINS. Hover alone is unusable for reading a number — the moment the
 * pointer leaves the shape to reach the row, the highlight is gone.
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
  const togglePin = (name: string | null) =>
    setPinned((cur) => (cur === name ? null : name));

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
              }`}
            />
          </h2>
          <p className="mt-1 truncate text-xs text-slate-500">
            {map.matched} שכונות על המפה · לחצו על שכונה כדי לקבע אותה
          </p>
        </div>
      </div>

      {/* Map on the wide screen only. A city map at 375px is unreadable, and
          below lg: this section is exactly the table it has always been. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <CityMap
              neighborhoods={map.neighborhoods}
              lines={map.lines}
              active={active}
              onHover={setHovered}
              onPin={togglePin}
            />
          </div>
          <Legend edges={map.binEdges} fmt={fmt} />
        </div>

        <div className="lg:max-h-[560px] lg:overflow-y-auto">
          <NeighborhoodPrices
            cityName={cityName} rows={rows} year={year}
            citySqm={citySqm} minDeals={minDeals} scopeLabel={scopeLabel}
            active={active} onHover={setHovered} onPin={togglePin} compact
          />
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

/** What each shade means, in shekels. A colour scale with no legend is a
 *  decoration — and this one is per-city, so the reader cannot infer it. */
function Legend({ edges, fmt }: { edges: number[]; fmt: (v: number) => string }) {
  const FILLS = ["#e0f2fe", "#bae6fd", "#7dd3fc", "#38bdf8", "#0ea5e9"];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-slate-500">
      <span className="font-bold">מחיר למ״ר:</span>
      <span className="flex items-center gap-1">
        {FILLS.map((c, i) => (
          <span key={i} className="h-3 w-6 rounded-sm border border-white" style={{ backgroundColor: c, opacity: 0.62 }} />
        ))}
      </span>
      {edges.length > 0 && (
        <span className="tabular-nums" dir="ltr">
          {fmt(edges[0])} – {fmt(edges[edges.length - 1])}
        </span>
      )}
      <span className="flex items-center gap-1">
        <span className="h-3 w-6 rounded-sm border border-white" style={{ backgroundColor: "#f1f5f9" }} />
        אין מספיק עסקאות
      </span>
    </div>
  );
}
