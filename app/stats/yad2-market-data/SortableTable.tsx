"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type Yad2Row = {
  city_name: string;
  market_type: string | null;
  new_properties: number | null;
  new_properties_yoy: number | null;
  secondhand_properties: number | null;
  secondhand_yoy: number | null;
  avg_days_on_market: number | null;
  days_yoy: number | null;
  buyers_count: number | null;
  buyers_yoy: number | null;
  households: number | null;
  avg_household_size: number | null;
};

type SortKey = keyof Yad2Row;
type SortDir = "asc" | "desc";

function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("he-IL");
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function pctClass(v: number | null | undefined, inverseGoodIsNegative = false): string {
  if (v === null || v === undefined) return "text-slate-400";
  const isPositive = v >= 0;
  const isGood = inverseGoodIsNegative ? !isPositive : isPositive;
  return isGood ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold";
}

function marketTypeBadge(t: string | null) {
  if (!t) return null;
  const map: Record<string, { he: string; cls: string }> = {
    sellers: { he: "שוק מוכרים", cls: "bg-red-50 text-red-600 border-red-200" },
    buyers: { he: "שוק קונים", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    balanced: { he: "שוק מאוזן", cls: "bg-slate-50 text-slate-700 border-slate-200" },
  };
  const entry = map[t] ?? { he: t, cls: "bg-slate-50 text-slate-700 border-slate-200" };
  return (
    <span className={`inline-block text-2xs font-bold px-2 py-0.5 rounded-full border ${entry.cls}`}>
      {entry.he}
    </span>
  );
}

// Numeric weight used for market_type sorting: buyers (3) → balanced (2) → sellers (1) → unknown (0)
function marketTypeWeight(t: string | null): number {
  if (t === "buyers") return 3;
  if (t === "balanced") return 2;
  if (t === "sellers") return 1;
  return 0;
}

function compare(
  a: Yad2Row,
  b: Yad2Row,
  key: SortKey,
  dir: SortDir
): number {
  const mul = dir === "asc" ? 1 : -1;
  let av: number | string | null;
  let bv: number | string | null;

  if (key === "city_name") {
    av = a.city_name;
    bv = b.city_name;
    return av.localeCompare(bv, "he") * mul;
  }
  if (key === "market_type") {
    av = marketTypeWeight(a.market_type);
    bv = marketTypeWeight(b.market_type);
  } else {
    av = a[key] as number | null;
    bv = b[key] as number | null;
  }

  // Push nulls to the bottom regardless of direction
  const aNull = av === null || av === undefined;
  const bNull = bv === null || bv === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  return ((av as number) - (bv as number)) * mul;
}

interface ColMeta {
  key: SortKey;
  label: string;
  align: "right" | "center";
  className?: string;
  defaultDir: SortDir; // first click direction
}

const COLUMNS: ColMeta[] = [
  { key: "city_name", label: "עיר", align: "right", className: "text-slate-500", defaultDir: "asc" },
  { key: "market_type", label: "סוג שוק", align: "center", className: "text-slate-500", defaultDir: "asc" },
  { key: "new_properties", label: "מודעות חדשות", align: "center", className: "text-slate-500", defaultDir: "desc" },
  { key: "new_properties_yoy", label: "YoY חדשות", align: "center", className: "text-slate-400 text-2xs", defaultDir: "desc" },
  { key: "secondhand_properties", label: "יד שנייה", align: "center", className: "text-slate-500", defaultDir: "desc" },
  { key: "secondhand_yoy", label: "YoY יד-2", align: "center", className: "text-slate-400 text-2xs", defaultDir: "desc" },
  { key: "avg_days_on_market", label: "ימים בשוק", align: "center", className: "text-slate-500", defaultDir: "asc" },
  { key: "days_yoy", label: "YoY ימים", align: "center", className: "text-slate-400 text-2xs", defaultDir: "asc" },
  { key: "buyers_count", label: "קונים", align: "center", className: "text-slate-500", defaultDir: "desc" },
  { key: "buyers_yoy", label: "YoY קונים", align: "center", className: "text-slate-400 text-2xs", defaultDir: "desc" },
  { key: "households", label: "משקי בית", align: "center", className: "text-slate-500", defaultDir: "desc" },
  { key: "avg_household_size", label: "נפשות/בית", align: "center", className: "text-slate-500", defaultDir: "desc" },
];

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="text-slate-300 mr-1">↕</span>;
  return (
    <span className="text-indigo-600 mr-1 font-bold" aria-hidden>
      {dir === "asc" ? "↑" : "↓"}
    </span>
  );
}

export default function SortableTable({ initialRows }: { initialRows: Yad2Row[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("buyers_count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(col: ColMeta) {
    if (sortKey === col.key) {
      // toggle direction
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir(col.defaultDir);
    }
  }

  const sortedRows = useMemo(() => {
    return [...initialRows].sort((a, b) => compare(a, b, sortKey, sortDir));
  }, [initialRows, sortKey, sortDir]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums" dir="rtl">
        <thead className="bg-slate-50 sticky top-0">
          <tr className="border-b border-slate-200">
            {COLUMNS.map((col, idx) => {
              const isActive = sortKey === col.key;
              const baseAlign = col.align === "right" ? "text-right" : "text-center";
              const stickyCls = idx === 0 ? "sticky right-0 bg-slate-50 z-10" : "";
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={`py-3 px-3 ${baseAlign} text-xs font-semibold cursor-pointer select-none hover:bg-slate-100 transition-colors ${col.className ?? ""} ${stickyCls} ${isActive ? "!bg-indigo-50" : ""}`}
                  onClick={() => handleSort(col)}
                  aria-sort={isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  title={`מיון לפי ${col.label}`}
                >
                  <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
                    <SortArrow active={isActive} dir={sortDir} />
                    <span>{col.label}</span>
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r) => (
            <tr key={r.city_name} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
              <td className="py-2.5 px-3 text-right sticky right-0 bg-white hover:bg-slate-50 z-[1]">
                <Link
                  href={`/city/${encodeURIComponent(r.city_name)}`}
                  className="font-semibold text-slate-900 hover:text-indigo-700 transition-colors"
                >
                  {r.city_name}
                </Link>
              </td>
              <td className="py-2.5 px-3 text-center">{marketTypeBadge(r.market_type)}</td>
              <td className="py-2.5 px-3 text-center text-slate-900 font-semibold">{fmt(r.new_properties)}</td>
              <td className={`py-2.5 px-3 text-center text-2xs ${pctClass(r.new_properties_yoy)}`}>
                {fmtPct(r.new_properties_yoy)}
              </td>
              <td className="py-2.5 px-3 text-center text-slate-900 font-semibold">{fmt(r.secondhand_properties)}</td>
              <td className={`py-2.5 px-3 text-center text-2xs ${pctClass(r.secondhand_yoy)}`}>
                {fmtPct(r.secondhand_yoy)}
              </td>
              <td className="py-2.5 px-3 text-center text-slate-900 font-semibold">{fmt(r.avg_days_on_market)}</td>
              <td className={`py-2.5 px-3 text-center text-2xs ${pctClass(r.days_yoy, true)}`}>
                {fmtPct(r.days_yoy)}
              </td>
              <td className="py-2.5 px-3 text-center text-slate-900 font-semibold">{fmt(r.buyers_count)}</td>
              <td className={`py-2.5 px-3 text-center text-2xs ${pctClass(r.buyers_yoy)}`}>
                {fmtPct(r.buyers_yoy)}
              </td>
              <td className="py-2.5 px-3 text-center text-slate-900 font-semibold">{fmt(r.households)}</td>
              <td className="py-2.5 px-3 text-center text-slate-700">
                {r.avg_household_size !== null && r.avg_household_size !== undefined
                  ? r.avg_household_size.toFixed(1)
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
