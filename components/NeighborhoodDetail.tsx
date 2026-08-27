"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import TrendValue from "@/components/TrendValue";
import { withBasePath } from "@/lib/basePath";
import {
  neighborhoodDealsQuery, DEAL_SCOPES, NEIGHBORHOOD_DEALS_PAGE, type DealScope,
} from "@/lib/neighborhoodDeals";
import type { MappedNeighborhood } from "@/lib/cityMap";
import type { NadlanDeal } from "@/lib/nadlanTransactionSeries";

/**
 * One neighbourhood, in the column the table was in.
 *
 * WHY IT REPLACES THE TABLE RATHER THAN OPENING BESIDE IT
 * The column is 438px inside a 1072px section. There is no room for a third
 * thing, and a panel that pushed the table down would put the deals below the
 * fold — which is the same as not showing them.
 *
 * WHY IT FETCHES ON CLICK AND NEVER ON HOVER
 * /api/city-transactions allows 90 requests a minute per IP and then locks the
 * IP out for a minute. Hover-driven fetching would fire one request per shape
 * the pointer crosses; an office behind one NAT would lock itself out in
 * seconds. Hover still highlights — that costs nothing — but only a click
 * opens this.
 *
 * WHY THE DEALS TABLE HERE IS NOT DealsDrawer
 * DealsDrawer is eight sortable columns behind a collapsed toggle with two
 * scroll axes. In this column that is a horizontal scrollbar and a closed
 * panel. Four columns fit; rooms and ₪/m² ride along as a muted second line
 * inside the address cell, where they cost no width.
 */
export default function NeighborhoodDetail({
  cityName, hood, onBack,
}: {
  cityName: string;
  hood: MappedNeighborhood;
  onBack: () => void;
}) {
  const [scope, setScope] = useState<DealScope>("sh");
  const [deals, setDeals] = useState<NadlanDeal[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);

  const s = hood.summary;
  const key = s ? `${cityName}|${s.neighborhood}|${scope}` : null;

  useEffect(() => {
    if (!key) { setState("ready"); setDeals([]); setTotal(0); return; }
    let cancelled = false;
    setState("loading");
    setDeals([]);
    const q = neighborhoodDealsQuery(hood, scope);
    fetch(withBasePath(`/api/city-transactions/${encodeURIComponent(cityName)}?${q}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { deals?: NadlanDeal[]; total?: number }) => {
        if (cancelled) return;
        setDeals(j.deals ?? []);
        setTotal(Number(j.total ?? 0));
        setState("ready");
      })
      .catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
    // `key` carries city+neighbourhood+scope; `hood` is the object those came from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loadMore = () => {
    const q = neighborhoodDealsQuery(hood, scope, { offset: deals.length });
    if (!q) return;
    setLoadingMore(true);
    fetch(withBasePath(`/api/city-transactions/${encodeURIComponent(cityName)}?${q}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { deals?: NadlanDeal[] }) => setDeals((cur) => [...cur, ...(j.deals ?? [])]))
      .catch(() => { /* the page keeps what it already has */ })
      .finally(() => setLoadingMore(false));
  };

  const fmt = (v: number | null) => (v == null ? "—" : `₪${Math.round(v).toLocaleString("he-IL")}`);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <header className="border-b border-slate-200 px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 truncate text-base font-extrabold text-slate-900" title={hood.neighborhood}>
            {hood.neighborhood}
          </h3>
          <span className="flex shrink-0 items-center gap-1.5">
            {s && (
              /* Tax Authority spelling (s.neighborhood), never the OSM shape
                 name — the page URL is keyed on it, same rule as the query. */
              <Link
                href={`/city/${encodeURIComponent(cityName)}/neighborhood/${encodeURIComponent(s.neighborhood)}`}
                className="chip-action border-indigo-300 font-bold text-indigo-700 hover:bg-indigo-50"
              >
                עמוד השכונה ←
              </Link>
            )}
            <button type="button" onClick={onBack} className="chip-action border-slate-300 text-slate-600 hover:bg-slate-50">
              → כל השכונות
            </button>
          </span>
        </div>

        {s ? (
          <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
            <Stat label="₪ למ״ר" value={fmt(s.sqm)} />
            <Stat
              label={s.fromYear ? `שינוי מ־${s.fromYear}` : "שינוי"}
              value={s.changePct == null ? "—" : <TrendValue pct={s.changePct} />}
            />
            <Stat label={`עסקאות ${s.year}`} value={s.n.toLocaleString("he-IL")} />
          </dl>
        ) : (
          /* A shape with a boundary and no priced cell. Saying so is the whole
             answer — there is no Tax Authority row to query for it. */
          <p className="mt-2 text-xs text-slate-500">
            אין מספיק עסקאות בשכונה הזו כדי להציג מחיר. הגבול משורטט על המפה, הנתונים לא עברו את סף הדגימה.
          </p>
        )}
      </header>

      {s && (
        <>
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-3 py-2">
            {DEAL_SCOPES.map((sc) => (
              <button
                key={sc.id}
                type="button"
                onClick={() => setScope(sc.id)}
                aria-pressed={scope === sc.id}
                className={`chip-action ${
                  scope === sc.id
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {sc.label}
              </button>
            ))}
            {/* "כל השנים" is not decoration. The stat above it counts one
                year (the reference year of the price row); this counts every
                year in the repository. Two bare numbers labelled "עסקאות" side
                by side, meaning different populations, is how a reader decides
                the page contradicts itself. */}
            <span className="mr-auto text-2xs text-slate-500">
              {state === "loading" ? "טוען…" : `${total.toLocaleString("he-IL")} עסקאות · כל השנים`}
            </span>
          </div>

          {state === "error" ? (
            <p className="px-3 py-4 text-xs text-slate-500">לא הצלחנו לשלוף את העסקאות. נסו שוב בעוד רגע.</p>
          ) : state === "ready" && !deals.length ? (
            <p className="px-3 py-4 text-xs text-slate-500">אין עסקאות בהיקף הזה.</p>
          ) : (
            <table className="w-full table-fixed text-2xs">
              <colgroup>
                <col className="w-[4.5rem]" />
                <col />
                <col className="w-10" />
                <col className="w-[4.75rem]" />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 uppercase tracking-wide text-slate-500">
                  <th scope="col" className="px-2 py-1.5 text-right font-bold">תאריך</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-bold">כתובת</th>
                  <th scope="col" className="px-1 py-1.5 text-right font-bold">מ״ר</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-bold">מחיר</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d, i) => {
                  const addr = [d.street, d.houseNum].filter(Boolean).join(" ").trim();
                  const sub = [
                    d.rooms == null ? null : `${d.rooms} חד׳`,
                    d.priceSqm == null ? null : `${fmt(d.priceSqm)}/מ״ר`,
                  ].filter(Boolean).join(" · ");
                  return (
                    <tr key={`${d.dealDate}-${i}`} className="border-b border-slate-100 last:border-0">
                      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-slate-500">{d.dealDate}</td>
                      <td className="px-2 py-1 text-right leading-tight">
                        <span className="block truncate font-bold text-slate-800" title={addr || undefined}>
                          {addr || "—"}
                        </span>
                        {sub && <span className="block truncate text-slate-400">{sub}</span>}
                      </td>
                      <td className="px-1 py-1 text-right tabular-nums text-slate-500">{d.area == null ? "—" : Math.round(d.area)}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right font-bold tabular-nums text-slate-800">{fmt(d.price)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {state === "ready" && deals.length > 0 && deals.length < total && (
            <div className="border-t border-slate-100 px-3 py-2 text-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="chip-action border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {loadingMore ? "טוען…" : `הצג עוד ${NEIGHBORHOOD_DEALS_PAGE}`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 px-1.5 py-1.5">
      <dt className="text-2xs text-slate-500">{label}</dt>
      <dd className="text-sm font-extrabold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}
