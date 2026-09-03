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
  cityName, neighborhood, scope, initialDeals, total, activeDealId = null, onHoverDeal,
}: {
  cityName: string;
  /** Tax Authority spelling — the string the deals table stores */
  neighborhood: string;
  scope: "secondhand" | "all";
  initialDeals: NadlanDeal[];
  total: number;
  /** the deal whose pin is hovered on the map beside the table, if any */
  activeDealId?: number | null;
  onHoverDeal?: (id: number | null) => void;
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
    /* Ruled and centered (operator, 8/2026): real column separators
       ([&_td/th]:border-s under RTL) and every cell centered — the address
       included, since it is the row's identity and the whole table now reads
       from its middle. overflow-hidden keeps the ruling inside the radius. */
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <table className="w-full table-fixed text-xs [&_td]:border-s [&_td]:border-slate-100 [&_td:first-child]:border-s-0 [&_th]:border-s [&_th]:border-slate-100 [&_th:first-child]:border-s-0">
        <colgroup>
          <col className="w-24" />
          <col />
          <col className="w-12" />
          <col className="w-24" />
        </colgroup>
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-2xs uppercase tracking-wide text-slate-500">
            <th scope="col" className="px-3 py-2 text-center font-bold">תאריך</th>
            <th scope="col" className="px-3 py-2 text-center font-bold">כתובת</th>
            <th scope="col" className="px-2 py-2 text-center font-bold">מ״ר</th>
            <th scope="col" className="px-3 py-2 text-center font-bold">מחיר</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((d, i) => {
            // No street at the source → the neighbourhood name, never a bare
            // dash (operator, 8/2026). Muted, so a real address still stands out.
            const addr = [d.street, d.houseNum].filter(Boolean).join(" ").trim();
            const sub = [
              d.rooms == null ? null : `${d.rooms} חד׳`,
              d.priceSqm == null ? null : `${fmt(d.priceSqm)}/מ״ר`,
              d.yearBuilt ? `נבנה ${d.yearBuilt}` : null,
            ].filter(Boolean).join(" · ");
            const isActive = d.id != null && d.id === activeDealId;
            return (
              <tr
                key={`${d.id ?? d.dealDate}-${i}`}
                onMouseEnter={() => d.id != null && onHoverDeal?.(d.id)}
                onMouseLeave={() => onHoverDeal?.(null)}
                className={`border-b border-slate-100 last:border-0 transition-colors ${isActive ? "bg-sky-100" : onHoverDeal ? "hover:bg-sky-50" : ""}`}
              >
                <td className="whitespace-nowrap px-3 py-1.5 text-center tabular-nums text-slate-500">{d.dealDate}</td>
                <td className="px-3 py-1.5 text-center leading-tight">
                  {addr ? (
                    <span className="block truncate font-bold text-slate-800" title={addr}>{addr}</span>
                  ) : (
                    <span className="block truncate text-slate-400" title={neighborhood}>{d.neighborhood ?? neighborhood}</span>
                  )}
                  {sub && <span className="block truncate text-2xs text-slate-400">{sub}</span>}
                </td>
                <td className="px-2 py-1.5 text-center tabular-nums text-slate-500">{d.area == null ? "—" : Math.round(d.area)}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-center font-bold tabular-nums text-slate-800">{fmt(d.price)}</td>
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
      {/* Honesty line (operator, 8/2026): a column of address dashes with no
          word of explanation reads like a bug. It is the source's gap — the
          Tax Authority report carries the neighbourhood even when it carries
          no street — and the reader deserves the one sentence that says so.
          Measured from the rows on screen (no extra query); hidden when
          addresses are essentially complete. */}
      {deals.filter((d) => !d.street).length / deals.length >= 0.2 && (
        <p className="border-t border-slate-100 px-3 py-2 text-2xs leading-relaxed text-slate-400">
          חלק מהעסקאות מדווחות ברשות המסים ללא כתובת רחוב; השיוך לשכונה נעשה לפי השכונה שדווחה בעסקה עצמה.
        </p>
      )}
    </div>
  );
}
