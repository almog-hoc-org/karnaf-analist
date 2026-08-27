"use client";

import { useState } from "react";
import { withBasePath } from "@/lib/basePath";
import type { NadlanDeal } from "@/lib/nadlanTransactionSeries";

/**
 * The neighbourhood page's deal history.
 *
 * THE FIRST PAGE ARRIVES FROM THE SERVER as props — real rows in the HTML, no
 * request spent on paint, nothing counted against the API's 90/min budget for
 * merely opening the page. Only "הצג עוד" touches the network, continuing
 * through the same endpoint with the same ordering, so page two starts where
 * the server's page one ended.
 *
 * Same 4-column shape as the map panel's table (date · address · m² · price,
 * rooms and ₪/m² as the muted second line) — a reader who used one has
 * already learned the other.
 */
export default function HoodDealsTable({
  cityName, neighborhood, scope, initialDeals, total,
}: {
  cityName: string;
  /** Tax Authority spelling — the string the deals table stores */
  neighborhood: string;
  scope: "secondhand" | "all";
  initialDeals: NadlanDeal[];
  total: number;
}) {
  const [deals, setDeals] = useState(initialDeals);
  const [loading, setLoading] = useState(false);
  const PAGE = 25;

  const loadMore = () => {
    setLoading(true);
    const q = new URLSearchParams({
      neighborhood,
      dealType: scope === "secondhand" ? "sh" : "all",
      limit: String(PAGE),
      offset: String(deals.length),
    });
    fetch(withBasePath(`/api/city-transactions/${encodeURIComponent(cityName)}?${q}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { deals?: NadlanDeal[] }) => setDeals((cur) => [...cur, ...(j.deals ?? [])]))
      .catch(() => { /* the page keeps what it already has */ })
      .finally(() => setLoading(false));
  };

  const fmt = (v: number | null) => (v == null ? "—" : `₪${Math.round(v).toLocaleString("he-IL")}`);

  if (!deals.length) {
    return <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-500">אין עסקאות בהיקף הזה.</p>;
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <table className="w-full table-fixed text-xs">
        <colgroup>
          <col className="w-24" />
          <col />
          <col className="w-12" />
          <col className="w-24" />
        </colgroup>
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-2xs uppercase tracking-wide text-slate-500">
            <th scope="col" className="px-3 py-2 text-right font-bold">תאריך</th>
            <th scope="col" className="px-3 py-2 text-right font-bold">כתובת</th>
            <th scope="col" className="px-2 py-2 text-right font-bold">מ״ר</th>
            <th scope="col" className="px-3 py-2 text-right font-bold">מחיר</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((d, i) => {
            const addr = [d.street, d.houseNum].filter(Boolean).join(" ").trim();
            const sub = [
              d.rooms == null ? null : `${d.rooms} חד׳`,
              d.priceSqm == null ? null : `${fmt(d.priceSqm)}/מ״ר`,
              d.yearBuilt ? `נבנה ${d.yearBuilt}` : null,
            ].filter(Boolean).join(" · ");
            return (
              <tr key={`${d.dealDate}-${i}`} className="border-b border-slate-100 last:border-0">
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-500">{d.dealDate}</td>
                <td className="px-3 py-1.5 text-right leading-tight">
                  <span className="block truncate font-bold text-slate-800" title={addr || undefined}>{addr || "—"}</span>
                  {sub && <span className="block truncate text-2xs text-slate-400">{sub}</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{d.area == null ? "—" : Math.round(d.area)}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right font-bold tabular-nums text-slate-800">{fmt(d.price)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {deals.length < total && (
        <div className="border-t border-slate-100 px-3 py-2 text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="chip-action border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "טוען…" : `הצג עוד (${(total - deals.length).toLocaleString("he-IL")} נוספות)`}
          </button>
        </div>
      )}
    </div>
  );
}
