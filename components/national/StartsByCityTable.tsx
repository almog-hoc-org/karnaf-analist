"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import type { StartsTableRow } from "@/lib/cbsStarts";

/**
 * Building starts by city and year (CBS press releases) — the /national table.
 * Sortable by any column, filterable by name; each column is shaded by its own
 * scale so a big year stands out against the city's other years and its peers.
 */

type SortKey = "city" | "latest" | "change" | number;

interface Props {
  years: number[];
  latestLabel: string | null;
  total: StartsTableRow | null;
  cities: StartsTableRow[];
  pageName: Record<string, string>;
}

const fmt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("he-IL"));
const change = (r: StartsTableRow) => (r.latest != null && r.latestPrev ? ((r.latest - r.latestPrev) / r.latestPrev) * 100 : null);

function value(r: StartsTableRow, k: SortKey): number | string | null {
  if (k === "city") return r.city;
  if (k === "latest") return r.latest;
  if (k === "change") return change(r);
  return r.years[k] ?? null;
}

export default function StartsByCityTable({ years, latestLabel, total, cities, pageName }: Props) {
  const lastYear = years[years.length - 1];
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: latestLabel ? "latest" : lastYear, dir: "desc" });
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const needle = q.trim();
    const list = needle ? cities.filter((c) => c.city.includes(needle) || (pageName[c.city] ?? "").includes(needle)) : cities;
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = value(a, sort.key), bv = value(b, sort.key);
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv, "he") * mul;
      if (av == null && bv == null) return (b.years[lastYear] ?? -1) - (a.years[lastYear] ?? -1) || a.city.localeCompare(b.city, "he");
      if (av == null) return 1; // missing values always last
      if (bv == null) return -1;
      return ((av as number) - (bv as number)) * mul;
    });
  }, [cities, pageName, q, sort, lastYear]);

  // per-column maximum, for the shading
  const max = useMemo(() => {
    const m = new Map<SortKey, number>();
    for (const y of years) m.set(y, Math.max(0, ...cities.map((c) => c.years[y] ?? 0)));
    m.set("latest", Math.max(0, ...cities.map((c) => c.latest ?? 0)));
    return m;
  }, [cities, years]);

  const head = (k: SortKey, label: React.ReactNode, title?: string) => {
    const on = sort.key === k;
    return (
      <th
        key={String(k)}
        scope="col"
        title={title}
        aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        className={`py-2.5 px-2.5 text-xs font-semibold whitespace-nowrap ${k === "city" ? "text-right" : "text-left"} ${on ? "text-indigo-700" : "text-slate-500"}`}
      >
        <button
          type="button"
          onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : k === "city" ? "asc" : "desc" }))}
          className="inline-flex items-center gap-1 hover:text-indigo-700"
        >
          {label}
          <span aria-hidden className="text-2xs">{on ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
        </button>
      </th>
    );
  };

  const cell = (v: number | null | undefined, k: SortKey, strong = false) => {
    const m = max.get(k) ?? 0;
    const a = v != null && m > 0 ? Math.min(1, v / m) : 0;
    return (
      <td
        className={`py-2 px-2.5 text-left tabular-nums ${v == null ? "text-slate-300" : strong ? "font-bold text-slate-900" : "text-slate-700"}`}
        style={a ? { backgroundColor: `rgba(99, 102, 241, ${(0.04 + a * 0.26).toFixed(3)})` } : undefined}
      >
        {fmt(v)}
      </td>
    );
  };

  const pct = (r: StartsTableRow) => {
    const p = change(r);
    if (p == null) return <td className="py-2 px-2.5 text-left text-slate-300">—</td>;
    return (
      <td className={`py-2 px-2.5 text-left tabular-nums font-semibold ${p >= 0 ? "text-emerald-600" : "text-red-600"}`} dir="ltr">
        {p >= 0 ? "+" : ""}{p.toFixed(0)}%
      </td>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש עיר…"
          aria-label="חיפוש עיר"
          className="w-full sm:w-56 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
        <span className="text-xs text-slate-500">{rows.length} ערים · לחיצה על כותרת ממיינת</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-100">
        <table className="table-pin-first w-full text-sm" dir="rtl">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              {head("city", "עיר")}
              {years.map((y) => head(y, y))}
              {latestLabel && head("latest", "12 ח׳ אחרונים", latestLabel)}
              {latestLabel && head("change", "שינוי", "לעומת אותם 12 חודשים שנה קודם")}
            </tr>
          </thead>
          <tbody>
            {total && (
              <tr className="border-b-2 border-slate-200 bg-slate-50/60">
                <td className="py-2 px-2.5 font-bold text-slate-900 whitespace-nowrap">סך הכל ארצי</td>
                {years.map((y) => (
                  <td key={y} className="py-2 px-2.5 text-left tabular-nums font-bold text-slate-900">{fmt(total.years[y])}</td>
                ))}
                {latestLabel && <td className="py-2 px-2.5 text-left tabular-nums font-bold text-slate-900">{fmt(total.latest)}</td>}
                {latestLabel && pct(total)}
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.city} className="border-b border-slate-50 last:border-0 hover:bg-indigo-50/30">
                <td className="py-2 px-2.5 whitespace-nowrap font-medium">
                  {pageName[r.city] ? (
                    <Link href={`/city/${encodeURIComponent(pageName[r.city])}`} className="text-slate-900 hover:text-indigo-700 hover:underline">
                      {pageName[r.city]}
                    </Link>
                  ) : (
                    <span className="text-slate-900">{r.city}</span>
                  )}
                </td>
                {years.map((y) => <Fragment key={y}>{cell(r.years[y], y)}</Fragment>)}
                {latestLabel && cell(r.latest, "latest", true)}
                {latestLabel && pct(r)}
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={years.length + 3} className="py-6 text-center text-sm text-slate-500">לא נמצאה עיר בשם הזה</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
