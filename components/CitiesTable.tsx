"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

interface CityRow {
  city_name: string;
  population_2022: number | null;
  population_2024: number | null;
  population_2026: number | null;
  households_2022: number | null;
  price_per_sqm_2023: number | null;
  price_per_sqm_2026: number | null;
  price_change_pct: number | null;
  price_change_3y_pct: number | null;
  price_change_3y_from: number | null;
  price_change_3y_to: number | null;
  price_change_5y_pct: number | null;
  price_change_5y_from: number | null;
  price_change_5y_to: number | null;
  golden_pct: number | null;
  golden_multiplier: number | null;
  people_per_apartment: number | null;
  construction_4y_gross: number | null;
  apartments_required: number | null;
  apartment_growth: number | null;
  unsold_inventory: number | null;
  years_to_clear: number | null;
  total_permits: number | null;
  avg_permits: number | null;
  urban_renewal_status: string | null;
}

type SortKey = keyof CityRow;
type ViewMode = "all" | "top3y" | "top5y";

type ColumnDef = { key: SortKey; label: string; format: (v: any, row?: CityRow) => string; width: string };

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

const columns: ColumnDef[] = [
  { key: "city_name", label: "עיר", format: (v) => v ?? "—", width: "min-w-[120px]" },
  { key: "population_2024", label: "אוכלוסייה 2024", format: (v, row) => { const val = v ?? row?.population_2022; return val ? Math.round(val).toLocaleString("he-IL") : "—"; }, width: "min-w-[90px]" },
  { key: "population_2022", label: "אוכלוסייה 2022", format: (v) => v ? Math.round(v).toLocaleString("he-IL") : "—", width: "min-w-[90px]" },
  { key: "population_2026", label: "אוכלוסייה 2026", format: (v) => v ? Math.round(v).toLocaleString("he-IL") : "—", width: "min-w-[90px]" },
  { key: "households_2022", label: "משקי בית 2022", format: (v) => v ? Math.round(v).toLocaleString("he-IL") : "—", width: "min-w-[90px]" },
  { key: "price_change_pct", label: "שינוי מחיר (אקסל)", format: (v) => fmtPct(v), width: "min-w-[100px]" },
  {
    key: "price_change_3y_pct",
    label: "שינוי 3 שנים",
    format: (v, row) => v === null ? "—" : `${fmtPct(v)}${row?.price_change_3y_from && row?.price_change_3y_to ? ` (${row.price_change_3y_from}→${row.price_change_3y_to})` : ""}`,
    width: "min-w-[130px]",
  },
  {
    key: "price_change_5y_pct",
    label: "שינוי 5 שנים",
    format: (v, row) => v === null ? "—" : `${fmtPct(v)}${row?.price_change_5y_from && row?.price_change_5y_to ? ` (${row.price_change_5y_from}→${row.price_change_5y_to})` : ""}`,
    width: "min-w-[130px]",
  },
  // Removed "% הזהב" column — was based on stale population projections
  // and produced misleading negative percentages for cities like Tel Aviv.
  { key: "people_per_apartment", label: "נפשות/דירה", format: (v) => v !== null ? v.toFixed(1) : "—", width: "min-w-[80px]" },
  { key: "total_permits", label: "סה״כ היתרים", format: (v) => v ? v.toLocaleString("he-IL") : "—", width: "min-w-[90px]" },
  { key: "avg_permits", label: "ממוצע היתרים", format: (v) => v ? v.toLocaleString("he-IL") : "—", width: "min-w-[90px]" },
  { key: "unsold_inventory", label: "מלאי לא מכור", format: (v) => v ? v.toLocaleString("he-IL") : "—", width: "min-w-[90px]" },
  { key: "years_to_clear", label: "שנות פינוי", format: (v) => v !== null ? v.toFixed(1) : "—", width: "min-w-[80px]" },
  { key: "construction_4y_gross", label: "בנייה 4 שנים", format: (v) => v ? v.toLocaleString("he-IL") : "—", width: "min-w-[90px]" },
  { key: "urban_renewal_status", label: "התחדשות עירונית", format: (v) => v ?? "—", width: "min-w-[110px]" },
];

export default function CitiesTable({ data }: { data: CityRow[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("population_2026");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterHasPrice, setFilterHasPrice] = useState(false);
  const [filterHasPermits, setFilterHasPermits] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("all");

  // View mode = quick preset:
  //   all   — no filter, default sort by population_2026 desc
  //   top3y — only cities with price_change_3y_pct, sort desc by it
  //   top5y — only cities with price_change_5y_pct, sort desc by it
  function applyViewMode(mode: ViewMode) {
    setViewMode(mode);
    if (mode === "top3y") {
      setSortKey("price_change_3y_pct");
      setSortDir("desc");
    } else if (mode === "top5y") {
      setSortKey("price_change_5y_pct");
      setSortDir("desc");
    } else {
      setSortKey("population_2026");
      setSortDir("desc");
    }
  }

  const filtered = useMemo(() => {
    let result = data;
    if (search) {
      result = result.filter((c) => c.city_name.includes(search));
    }
    if (filterHasPrice) {
      result = result.filter((c) => c.price_change_pct !== null);
    }
    if (filterHasPermits) {
      result = result.filter((c) => c.total_permits !== null && c.total_permits > 0);
    }
    if (viewMode === "top3y") {
      result = result.filter((c) => c.price_change_3y_pct !== null);
    } else if (viewMode === "top5y") {
      result = result.filter((c) => c.price_change_5y_pct !== null);
    }
    return result;
  }, [data, search, filterHasPrice, filterHasPermits, viewMode]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv, "he") : bv.localeCompare(av, "he");
      }
      const diff = (av as number) - (bv as number);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [filtered, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // Visible columns: when in a top-mover view, push the relevant change column
  // and the city name first; otherwise show the default order.
  const visibleColumns = useMemo(() => {
    if (viewMode === "top3y") {
      const featured = columns.find((c) => c.key === "price_change_3y_pct")!;
      const rest = columns.filter((c) => c.key !== "price_change_3y_pct" && c.key !== "city_name");
      const cityCol = columns.find((c) => c.key === "city_name")!;
      return [cityCol, featured, ...rest];
    }
    if (viewMode === "top5y") {
      const featured = columns.find((c) => c.key === "price_change_5y_pct")!;
      const rest = columns.filter((c) => c.key !== "price_change_5y_pct" && c.key !== "city_name");
      const cityCol = columns.find((c) => c.key === "city_name")!;
      return [cityCol, featured, ...rest];
    }
    return columns;
  }, [viewMode]);

  return (
    <div>
      {/* View-mode pill toggle */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-slate-500 font-semibold">תצוגה:</span>
        <div className="inline-flex rounded-xl bg-slate-100 border border-slate-200 p-1 gap-1" role="tablist">
          <button
            type="button"
            onClick={() => applyViewMode("all")}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
              viewMode === "all"
                ? "bg-white text-cyan-700 shadow-sm"
                : "text-slate-600 hover:text-cyan-700"
            }`}
            aria-pressed={viewMode === "all"}
          >
            כל הערים
          </button>
          <button
            type="button"
            onClick={() => applyViewMode("top3y")}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
              viewMode === "top3y"
                ? "bg-white text-emerald-700 shadow-sm"
                : "text-slate-600 hover:text-emerald-700"
            }`}
            aria-pressed={viewMode === "top3y"}
            title="ערים שעלו הכי הרבה ב-3 שנים אחרונות (מ-2022)"
          >
            📈 הכי עלו ב-3 שנים
          </button>
          <button
            type="button"
            onClick={() => applyViewMode("top5y")}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
              viewMode === "top5y"
                ? "bg-white text-purple-700 shadow-sm"
                : "text-slate-600 hover:text-purple-700"
            }`}
            aria-pressed={viewMode === "top5y"}
            title="ערים שעלו הכי הרבה ב-5 שנים אחרונות (מ-2020 — אותו חלון שמוצג בעמוד עיר)"
          >
            🚀 הכי עלו ב-5 שנים
          </button>
        </div>
        <span className="text-[10px] text-slate-400 mr-1">
          (מחירים מ-nadlan.gov.il — ממוצע רבעוני שנתי, השוואה מהשנה המוקדמת לאחרונה)
        </span>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש עיר..."
          dir="rtl"
          className="rounded-lg bg-slate-50 border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 w-48"
        />
        <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
          <input
            type="checkbox"
            checked={filterHasPrice}
            onChange={(e) => setFilterHasPrice(e.target.checked)}
            className="rounded border-zinc-600 bg-slate-100 text-cyan-500 focus:ring-cyan-500/30"
          />
          עם נתוני מחיר
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
          <input
            type="checkbox"
            checked={filterHasPermits}
            onChange={(e) => setFilterHasPermits(e.target.checked)}
            className="rounded border-zinc-600 bg-slate-100 text-cyan-500 focus:ring-cyan-500/30"
          />
          עם היתרי בנייה
        </label>
        <span className="text-xs text-slate-500 self-center mr-auto">
          {sorted.length} ערים
        </span>
      </div>

      {/* Table */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-slate-300">
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`px-3 py-3 text-right text-slate-500 font-medium cursor-pointer hover:text-cyan-700 transition-colors select-none ${col.width} ${
                    (viewMode === "top3y" && col.key === "price_change_3y_pct") ||
                    (viewMode === "top5y" && col.key === "price_change_5y_pct")
                      ? "bg-emerald-50 text-emerald-700"
                      : ""
                  }`}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="mr-1 text-cyan-500">
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={row.city_name}
                className={`border-b border-slate-200/40 hover:bg-slate-100 transition-colors ${
                  i % 2 === 0 ? "" : "bg-slate-50/50"
                }`}
              >
                {visibleColumns.map((col) => {
                  const isPctCol =
                    col.key === "price_change_pct" ||
                    col.key === "price_change_3y_pct" ||
                    col.key === "price_change_5y_pct" ||
                    col.key === "golden_pct";
                  const numericVal = row[col.key] as number | null;
                  const cellClass = isPctCol && numericVal !== null
                    ? numericVal >= 0
                      ? "text-emerald-700 font-semibold"
                      : "text-red-600 font-semibold"
                    : "text-slate-800";
                  const highlightCell =
                    (viewMode === "top3y" && col.key === "price_change_3y_pct") ||
                    (viewMode === "top5y" && col.key === "price_change_5y_pct");
                  return (
                    <td key={col.key} className={`px-3 py-2.5 ${highlightCell ? "bg-emerald-50/40" : ""}`}>
                      {col.key === "city_name" ? (
                        <Link
                          href={`/city/${encodeURIComponent(row.city_name)}`}
                          className="text-cyan-700 hover:text-cyan-700 font-medium transition-colors"
                        >
                          {row.city_name}
                        </Link>
                      ) : (
                        <span className={cellClass}>{col.format(row[col.key], row)}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
