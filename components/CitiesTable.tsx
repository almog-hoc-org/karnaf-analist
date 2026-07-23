"use client";

import { useState, useMemo, type ReactNode } from "react";
import Link from "next/link";
import type { CityChangeMetrics, ChangeMetric, YearValue } from "@/lib/cityChangeMetrics";
import TrendValue, { trendTextClass } from "./TrendValue";

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
  changeMetrics?: CityChangeMetrics;
  dealCount: number | null;
  /* ── price levels from REAL transactions (lib/cityTransactionPrices) ── */
  tx_price_year: number | null;
  tx_avg_all: number | null;
  tx_median_all: number | null;
  tx_avg_sh: number | null;
  tx_median_sh: number | null;
  tx_year_min: number | null;
  tx_year_max: number | null;
  tx_thin: boolean;
}

/**
 * Serializable snapshot of lib/investorMetrics (concrete parts only: premium,
 * supply gap, data depth). Built in app/cities/page.tsx (server) as
 * Record<city, InvestorRow>, BigInt-safe (everything passed through Number()).
 * null ALWAYS renders "—", never 0.
 */
export interface InvestorRow {
  newPremiumPct: number | null;
  newPremiumYear: number | null;
  gapPctOfDemand: number | null;
  gapSource: string;
  nDeals: number;
  distinctYears: number;
  confidence: "high" | "medium" | "low";
}

type SortKey = keyof CityRow;
type ViewMode = "all" | "top3y" | "top5y";
type Win = 1 | 3 | 5 | 10;

type ColumnDef = { key: SortKey; label: string; format: (v: any, row?: CityRow) => string; width: string };

/** The windowed price-change columns (each has its own year-window selector).
 * SECOND-HAND FIRST: the two second-hand columns lead and are the site's basis for
 * price-change comparisons — the general average is biased upward when a new
 * neighborhood is built. Every column states its scope explicitly in the sub-label. */
const CHANGE_COLS: { id: string; label: string; metric: ChangeMetric; unit: string }[] = [
  { id: "chg_sh", label: "Δ יד-2 ממוצע", metric: "secondhand", unit: "יד-2 בלבד · ממוצע ₪/מ״ר" },
  { id: "chg_sh_med", label: "Δ יד-2 חציון", metric: "secondhand_median", unit: "יד-2 בלבד · חציון ₪/מ״ר" },
  { id: "chg_all", label: "Δ כללי ממוצע", metric: "all", unit: "כל העסקאות (כולל חדשות) · ממוצע ₪/מ״ר" },
  { id: "chg_median", label: "Δ חציון רשמי", metric: "median", unit: "כל העסקאות · מחיר עסקה חציוני רשמי" },
  { id: "chg_new", label: "Δ חדשות", metric: "new", unit: "חדשות בלבד · ממוצע ₪/מ״ר" },
];

/** % change over `win` years using the latest available year as the endpoint. */
function changePct(series: YearValue | undefined, win: Win): { pct: number | null; from: number | null; to: number | null } {
  if (!series) return { pct: null, from: null, to: null };
  const years = Object.keys(series).map(Number);
  if (!years.length) return { pct: null, from: null, to: null };
  const to = Math.max(...years);
  const from = to - win;
  const toVal = series[to], fromVal = series[from];
  if (toVal == null || fromVal == null || fromVal === 0) return { pct: null, from: series[from] != null ? from : null, to };
  return { pct: ((toVal - fromVal) / fromVal) * 100, from, to };
}

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

/** "+4.2" / "−1.8" with a real minus sign (no % — caller appends its unit). */
function fmtSigned(v: number, digits = 1): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(digits)}`;
}

const columns: ColumnDef[] = [
  { key: "city_name", label: "עיר", format: (v) => v ?? "—", width: "min-w-[120px]" },
  { key: "dealCount", label: "עסקאות במאגר", format: (v) => (v ? Math.round(v).toLocaleString("he-IL") : "—"), width: "min-w-[95px]" },
  { key: "population_2024", label: "אוכלוסייה 2024", format: (v, row) => { const val = v ?? row?.population_2022; return val ? Math.round(val).toLocaleString("he-IL") : "—"; }, width: "min-w-[90px]" },
  { key: "population_2022", label: "אוכלוסייה 2022", format: (v) => v ? Math.round(v).toLocaleString("he-IL") : "—", width: "min-w-[90px]" },
  { key: "population_2026", label: "אוכלוסייה 2026", format: (v) => v ? Math.round(v).toLocaleString("he-IL") : "—", width: "min-w-[90px]" },
  { key: "households_2022", label: "משקי בית 2022", format: (v) => v ? Math.round(v).toLocaleString("he-IL") : "—", width: "min-w-[90px]" },
  // Price levels — from REAL collected transactions (₪/m², latest full year with 10+ deals).
  // Four separate metrics; the user picks which to show (עמודות ▾).
  { key: "tx_median_sh", label: "חציון יד-2 ₪/מ״ר", format: (v, row) => v ? `₪${Math.round(v).toLocaleString("he-IL")}${row?.tx_price_year ? ` (${row.tx_price_year})` : ""}` : "—", width: "min-w-[110px]" },
  { key: "tx_avg_sh", label: "ממוצע יד-2 ₪/מ״ר", format: (v, row) => v ? `₪${Math.round(v).toLocaleString("he-IL")}${row?.tx_price_year ? ` (${row.tx_price_year})` : ""}` : "—", width: "min-w-[110px]" },
  { key: "tx_avg_all", label: "ממוצע כללי ₪/מ״ר", format: (v, row) => v ? `₪${Math.round(v).toLocaleString("he-IL")}${row?.tx_price_year ? ` (${row.tx_price_year})` : ""}` : "—", width: "min-w-[110px]" },
  { key: "tx_median_all", label: "חציון כללי ₪/מ״ר", format: (v, row) => v ? `₪${Math.round(v).toLocaleString("he-IL")}${row?.tx_price_year ? ` (${row.tx_price_year})` : ""}` : "—", width: "min-w-[110px]" },
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

/* ── Investor-metric columns ──────────────────────────────────────────────
 * Every % column carries its measurement window in the header sub-label
 * (memory rule: no unlabeled time windows). null renders "—", never 0.   */
const dash = <span className="text-slate-300 tabular-nums">—</span>;

const CONF_ORDER: Record<InvestorRow["confidence"], number> = { high: 3, medium: 2, low: 1 };

type InvColDef = {
  id: string;
  label: string;
  /** tiny window/provenance line under the header label */
  sub: (refYear: number) => string;
  title: (refYear: number) => string;
  sortValue: (m: InvestorRow | undefined) => number | null;
  render: (m: InvestorRow | undefined) => ReactNode;
};

const INV_COLS: InvColDef[] = [
  {
    id: "inv_premium",
    label: "פרמיית חדשות",
    sub: () => "חדש מול יד שנייה · שנה אחרונה עם דאטה",
    title: () => "פער מחיר למ״ר בין דירות חדשות ליד שנייה בשנה האחרונה שבה יש נתונים לשתיהן — לא מדד חד-כיווני",
    sortValue: (m) => m?.newPremiumPct ?? null,
    // Deliberately NEUTRAL (slate, not green/red): a premium isn't univalently good/bad.
    render: (m) =>
      m?.newPremiumPct == null ? dash : (
        <span dir="ltr" className="inline-flex items-center gap-1 font-semibold tabular-nums text-slate-900">
          {fmtSigned(m.newPremiumPct)}%
          {m.newPremiumYear != null && (
            <span className="font-normal text-[9px] text-slate-400">({m.newPremiumYear})</span>
          )}
        </span>
      ),
  },
  {
    id: "inv_gap",
    label: "פער היצע %",
    sub: () => "% מהביקוש · חיובי = מחסור",
    title: () => "פער היצע–ביקוש כאחוז מהביקוש בחלון המדידה (חיובי = מחסור בדירות)",
    sortValue: (m) => m?.gapPctOfDemand ?? null,
    render: (m) =>
      m?.gapPctOfDemand == null ? dash : (
        <span
          dir="ltr"
          title={m.gapSource !== "none" ? `מקור: ${m.gapSource}` : undefined}
          className="inline-block font-semibold tabular-nums text-slate-900"
        >
          {fmtSigned(m.gapPctOfDemand, 0)}%
        </span>
      ),
  },
  {
    id: "inv_conf",
    label: "אמינות",
    sub: () => "עומק דאטה · עסקאות ושנים",
    title: () => "אמינות המדדים לפי עומק הדאטה שנאסף לעיר (מספר עסקאות ושנים מכוסות)",
    sortValue: (m) => (m ? CONF_ORDER[m.confidence] : null),
    render: (m) => {
      if (!m) return dash;
      const t = `${m.nDeals.toLocaleString("he-IL")} עסקאות · ${m.distinctYears} שנים`;
      if (m.confidence === "high") return <span title={t} className="chip-quality chip-quality-good">גבוהה</span>;
      if (m.confidence === "medium") return <span title={t} className="chip-quality chip-quality-good bg-indigo-100">בינונית</span>;
      return <span title={t} className="chip-quality chip-quality-warn">נמוכה</span>;
    },
  },
];

/* ── One-click screener presets ─────────────────────────────────────────── */
type PresetDef = {
  id: string;
  label: string;
  title: string;
  sortId: string;
  dir: "asc" | "desc";
  test: (m: InvestorRow | undefined) => boolean;
};

const PRESETS: PresetDef[] = [
  {
    id: "supply", label: "🏗️ לחץ היצע", title: "פער היצע של 100%+ מהביקוש (מחסור חריף)",
    sortId: "inv_gap", dir: "desc",
    test: (m) => !!m && m.gapPctOfDemand != null && m.gapPctOfDemand >= 100,
  },
  {
    id: "premium", label: "🆕 פרמיה נמוכה", title: "פרמיית חדשות מתחת ל-8% — חדש כמעט במחיר יד שנייה",
    sortId: "inv_premium", dir: "asc",
    test: (m) => !!m && m.newPremiumPct != null && m.newPremiumPct < 8,
  },
];

/* ── Advanced numeric range filters ─────────────────────────────────────── */
type RangeKey = "price" | "pop";
type Range = { min: string; max: string };

const RANGE_DEFS: { key: RangeKey; label: (refYear: number) => string; value: (row: CityRow, m: InvestorRow | undefined) => number | null }[] = [
  { key: "price", label: () => "מחיר למ״ר 2026 (₪)", value: (r) => r.price_per_sqm_2026 },
  { key: "pop", label: () => "אוכלוסייה 2026", value: (r) => r.population_2026 },
];

const makeEmptyRanges = (): Record<RangeKey, Range> => ({
  price: { min: "", max: "" },
  pop: { min: "", max: "" },
});

export default function CitiesTable({
  data,
  investor = {},
  refYear = 2025,
}: {
  data: CityRow[];
  /** city_name → serialized investor metrics (from computeAllInvestorMetrics) */
  investor?: Record<string, InvestorRow>;
  /** lib/investorMetrics REF_YEAR — passed from the server page */
  refYear?: number;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string>("population_2026");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterHasPrice, setFilterHasPrice] = useState(false);
  const [filterHasPermits, setFilterHasPermits] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [win, setWin] = useState<Record<ChangeMetric, Win>>({ all: 3, secondhand: 3, secondhand_median: 3, new: 3, median: 3 });
  // official median + secondary investor columns are optional, off by default
  const [hidden, setHidden] = useState<Set<string>>(new Set(["chg_median", "inv_premium", "inv_gap", "inv_conf", "tx_median_all", "population_2022"]));
  const [showColMenu, setShowColMenu] = useState(false);
  const [preset, setPreset] = useState<string | null>(null);
  const [ranges, setRanges] = useState<Record<RangeKey, Range>>(makeEmptyRanges);
  const [showAdv, setShowAdv] = useState(false);

  const changeColById = (id: string) => CHANGE_COLS.find((c) => c.id === id);
  const invColById = (id: string) => INV_COLS.find((c) => c.id === id);
  const rowChange = (row: CityRow, metric: ChangeMetric): number | null =>
    changePct(row.changeMetrics?.[metric], win[metric]).pct;

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

  /** Preset = filter + sort by its column (and reveal that column if hidden).
   * Clicking the active preset again — or "הכל" — clears the filter. */
  function togglePreset(p: PresetDef) {
    if (preset === p.id) {
      setPreset(null);
      return;
    }
    setPreset(p.id);
    setSortKey(p.sortId);
    setSortDir(p.dir);
    setHidden((s) => {
      if (!s.has(p.sortId)) return s;
      const n = new Set(s);
      n.delete(p.sortId);
      return n;
    });
  }

  const setRange = (key: RangeKey, field: keyof Range, val: string) =>
    setRanges((rs) => ({ ...rs, [key]: { ...rs[key], [field]: val } }));

  const activeRangeCount = RANGE_DEFS.filter(
    (d) => ranges[d.key].min.trim() !== "" || ranges[d.key].max.trim() !== ""
  ).length;

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
    if (preset) {
      const p = PRESETS.find((x) => x.id === preset);
      if (p) result = result.filter((c) => p.test(investor[c.city_name]));
    }
    for (const def of RANGE_DEFS) {
      const r = ranges[def.key];
      const min = r.min.trim() === "" ? null : Number(r.min);
      const max = r.max.trim() === "" ? null : Number(r.max);
      if ((min == null || Number.isNaN(min)) && (max == null || Number.isNaN(max))) continue;
      result = result.filter((c) => {
        const v = def.value(c, investor[c.city_name]);
        if (v == null) return false; // range filter active → cities without the metric drop out
        if (min != null && !Number.isNaN(min) && v < min) return false;
        if (max != null && !Number.isNaN(max) && v > max) return false;
        return true;
      });
    }
    return result;
  }, [data, search, filterHasPrice, filterHasPermits, viewMode, preset, ranges, investor]);

  const sorted = useMemo(() => {
    const chgCol = changeColById(sortKey);
    const invCol = invColById(sortKey);
    return [...filtered].sort((a, b) => {
      const av = chgCol
        ? rowChange(a, chgCol.metric)
        : invCol
          ? invCol.sortValue(investor[a.city_name])
          : (a[sortKey as keyof CityRow] as string | number | null);
      const bv = chgCol
        ? rowChange(b, chgCol.metric)
        : invCol
          ? invCol.sortValue(investor[b.city_name])
          : (b[sortKey as keyof CityRow] as string | number | null);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv, "he") : bv.localeCompare(av, "he");
      }
      const diff = (av as number) - (bv as number);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [filtered, sortKey, sortDir, win, investor]);

  const handleSort = (key: string) => {
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
    const base = columns.filter((c) => c.key === "city_name" || !hidden.has(c.key as string));
    if (viewMode === "top3y") {
      const featured = base.find((c) => c.key === "price_change_3y_pct");
      const cityCol = base.find((c) => c.key === "city_name")!;
      const rest = base.filter((c) => c.key !== "price_change_3y_pct" && c.key !== "city_name");
      return featured ? [cityCol, featured, ...rest] : base;
    }
    if (viewMode === "top5y") {
      const featured = base.find((c) => c.key === "price_change_5y_pct");
      const cityCol = base.find((c) => c.key === "city_name")!;
      const rest = base.filter((c) => c.key !== "price_change_5y_pct" && c.key !== "city_name");
      return featured ? [cityCol, featured, ...rest] : base;
    }
    return base;
  }, [viewMode, hidden]);

  const visibleChangeCols = useMemo(() => CHANGE_COLS.filter((c) => !hidden.has(c.id)), [hidden]);
  const visibleInvCols = useMemo(() => INV_COLS.filter((c) => !hidden.has(c.id)), [hidden]);
  const toggleCol = (key: string) => setHidden((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Investor columns render right after the city column ("all" mode) or right
  // after the featured change column (top3y/top5y) — the featured column keeps
  // its existing spot next to the city name.
  const invInsertAt =
    (viewMode === "top3y" && visibleColumns.some((c) => c.key === "price_change_3y_pct")) ||
    (viewMode === "top5y" && visibleColumns.some((c) => c.key === "price_change_5y_pct"))
      ? 2
      : 1;
  const preCols = visibleColumns.slice(0, invInsertAt);
  const postCols = visibleColumns.slice(invInsertAt);

  const sortLabel =
    columns.find((c) => c.key === sortKey)?.label ??
    CHANGE_COLS.find((c) => c.id === sortKey)?.label ??
    INV_COLS.find((c) => c.id === sortKey)?.label ??
    String(sortKey);

  const isFeaturedCol = (key: SortKey) =>
    (viewMode === "top3y" && key === "price_change_3y_pct") ||
    (viewMode === "top5y" && key === "price_change_5y_pct");

  /* ── shared cell renderers (regular columns) ── */
  const renderTh = (col: ColumnDef) => (
    <th
      key={col.key}
      onClick={() => handleSort(col.key)}
      className={`sticky top-14 z-10 border-b border-slate-300 px-3 py-3 text-right font-medium cursor-pointer hover:text-indigo-700 transition-colors select-none ${col.width} ${
        isFeaturedCol(col.key) ? "bg-indigo-50 text-indigo-700" : "bg-white text-slate-500"
      }`}
    >
      {col.label}
      {sortKey === col.key && (
        <span className="mr-1 text-indigo-600">
          {sortDir === "asc" ? "▲" : "▼"}
        </span>
      )}
    </th>
  );

  const renderTd = (row: CityRow, col: ColumnDef) => {
    const isPctCol =
      col.key === "price_change_pct" ||
      col.key === "price_change_3y_pct" ||
      col.key === "price_change_5y_pct" ||
      col.key === "golden_pct";
    const numericVal = row[col.key] as number | null;
    // trend cell: green/red is allowed ONLY here (and inside TrendValue)
    const cellClass = isPctCol && numericVal !== null
      ? numericVal >= 0
        ? "text-emerald-700 font-semibold"
        : "text-red-600 font-semibold"
      : "text-slate-800";
    return (
      <td key={col.key} className={`px-3 py-2.5 ${isFeaturedCol(col.key) ? "bg-indigo-50/40" : ""}`}>
        {col.key === "city_name" ? (
          <Link
            href={`/city/${encodeURIComponent(row.city_name)}`}
            className="text-indigo-700 hover:text-indigo-800 font-medium transition-colors"
          >
            {row.city_name}
          </Link>
        ) : (
          <span dir={isPctCol ? "ltr" : undefined} className={`${cellClass} ${isPctCol ? "inline-block tabular-nums" : ""}`}>{col.format(row[col.key], row)}</span>
        )}
      </td>
    );
  };

  return (
    <div>
      {/* View-mode pill toggle */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs text-slate-500 font-semibold">תצוגה:</span>
        <button
          type="button"
          onClick={() => applyViewMode("all")}
          className={`control-pill ${viewMode === "all" ? "control-pill-active" : ""}`}
          aria-pressed={viewMode === "all"}
        >
          כל הערים
        </button>
        <button
          type="button"
          onClick={() => applyViewMode("top3y")}
          className={`control-pill ${viewMode === "top3y" ? "control-pill-active" : ""}`}
          aria-pressed={viewMode === "top3y"}
          title="ערים שעלו הכי הרבה ב-3 שנים אחרונות (מ-2022)"
        >
          📈 הכי עלו ב-3 שנים
        </button>
        <button
          type="button"
          onClick={() => applyViewMode("top5y")}
          className={`control-pill ${viewMode === "top5y" ? "control-pill-active" : ""}`}
          aria-pressed={viewMode === "top5y"}
          title="ערים שעלו הכי הרבה ב-5 שנים אחרונות (מ-2020 — אותו חלון שמוצג בעמוד עיר)"
        >
          🚀 הכי עלו ב-5 שנים
        </button>
        <span className="text-[10px] text-slate-400 mr-1">
          (מחירים מ-nadlan.gov.il — ממוצע רבעוני שנתי, השוואה מהשנה המוקדמת לאחרונה)
        </span>
      </div>

      {/* One-click investor presets */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-slate-500 font-semibold">פילטרים מהירים:</span>
        <button
          type="button"
          onClick={() => setPreset(null)}
          className={`control-pill ${preset === null ? "control-pill-active" : ""}`}
          aria-pressed={preset === null}
          title="ניקוי פילטר מהיר"
        >
          הכל
        </button>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => togglePreset(p)}
            className={`control-pill ${preset === p.id ? "control-pill-active" : ""}`}
            aria-pressed={preset === p.id}
            title={p.title}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש עיר..."
          dir="rtl"
          className="rounded-lg bg-slate-50 border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-300 focus:border-indigo-400 w-48"
        />
        <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
          <input
            type="checkbox"
            checked={filterHasPrice}
            onChange={(e) => setFilterHasPrice(e.target.checked)}
            className="rounded border-slate-300 bg-slate-100 text-indigo-600 focus:ring-indigo-200"
          />
          עם נתוני מחיר
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
          <input
            type="checkbox"
            checked={filterHasPermits}
            onChange={(e) => setFilterHasPermits(e.target.checked)}
            className="rounded border-slate-300 bg-slate-100 text-indigo-600 focus:ring-indigo-200"
          />
          עם היתרי בנייה
        </label>

        {/* Advanced range-filter toggle */}
        <button
          type="button"
          onClick={() => setShowAdv((o) => !o)}
          className={`control-pill inline-flex items-center gap-1.5 ${showAdv || activeRangeCount > 0 ? "border-indigo-300 text-indigo-700" : ""}`}
          aria-expanded={showAdv}
        >
          סינון מתקדם {showAdv ? "▴" : "▾"}
          {activeRangeCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white">
              {activeRangeCount}
            </span>
          )}
        </button>

        {/* Column show/hide menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowColMenu((o) => !o)}
            className="rounded-lg bg-white border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 hover:text-indigo-700 hover:border-indigo-300 transition-colors"
          >
            עמודות ▾ {hidden.size > 0 && <span className="text-indigo-600">({columns.length + CHANGE_COLS.length + INV_COLS.length - hidden.size})</span>}
          </button>
          {showColMenu && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowColMenu(false)} />
              <div className="absolute z-30 mt-1 right-0 w-60 max-h-80 overflow-y-auto rounded-xl bg-white border border-slate-200 shadow-lg p-2">
                <div className="text-[10px] font-bold text-slate-400 px-2 pb-1">מדדי משקיע</div>
                {INV_COLS.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-xs text-slate-700 px-2 py-1 rounded hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={!hidden.has(c.id)} onChange={() => toggleCol(c.id)} className="rounded text-indigo-600" />
                    {c.label}
                  </label>
                ))}
                <div className="text-[10px] font-bold text-slate-400 px-2 pt-2 pb-1 border-t border-slate-100 mt-1">עמודות שינוי מחיר</div>
                {CHANGE_COLS.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-xs text-slate-700 px-2 py-1 rounded hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={!hidden.has(c.id)} onChange={() => toggleCol(c.id)} className="rounded text-indigo-600" />
                    {c.label} <span className="text-[10px] text-slate-400">({c.unit})</span>
                  </label>
                ))}
                <div className="text-[10px] font-bold text-slate-400 px-2 pt-2 pb-1 border-t border-slate-100 mt-1">עמודות רגילות</div>
                {columns.filter((c) => c.key !== "city_name").map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-xs text-slate-700 px-2 py-1 rounded hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={!hidden.has(c.key as string)} onChange={() => toggleCol(c.key as string)} className="rounded text-indigo-600" />
                    {c.label}
                  </label>
                ))}
                <button onClick={() => setHidden(new Set())} className="w-full mt-1 text-[11px] font-bold text-indigo-700 hover:underline px-2 py-1 text-right">הצג הכל</button>
              </div>
            </>
          )}
        </div>

        <span className="text-xs text-slate-500 self-center mr-auto">
          מציג <span className="font-bold text-slate-700">{sorted.length}</span> מתוך {data.length} ערים
          {" · "}ממוין לפי <span className="font-semibold text-indigo-700">{sortLabel}</span>
        </span>
      </div>

      {/* Advanced numeric range filters */}
      {showAdv && (
        <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3 rounded-xl border border-slate-200 bg-white p-3">
          {RANGE_DEFS.map((def) => (
            <div key={def.key}>
              <div className="text-[10px] font-bold text-slate-500 mb-1">{def.label(refYear)}</div>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={ranges[def.key].min}
                  onChange={(e) => setRange(def.key, "min", e.target.value)}
                  placeholder="מינ׳"
                  className="control-select w-20"
                  aria-label={`${def.label(refYear)} — מינימום`}
                />
                <span className="text-xs text-slate-300">–</span>
                <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={ranges[def.key].max}
                  onChange={(e) => setRange(def.key, "max", e.target.value)}
                  placeholder="מקס׳"
                  className="control-select w-20"
                  aria-label={`${def.label(refYear)} — מקסימום`}
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRanges(makeEmptyRanges())}
            disabled={activeRangeCount === 0}
            className="control-pill disabled:opacity-40 disabled:cursor-default"
          >
            נקה הכל
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-slate-300">
              {preCols.map(renderTh)}
              {visibleInvCols.map((c) => (
                <th
                  key={c.id}
                  onClick={() => handleSort(c.id)}
                  title={c.title(refYear)}
                  className="sticky top-14 z-10 bg-white border-b border-slate-300 px-3 py-3 text-right text-slate-500 font-medium cursor-pointer hover:text-indigo-700 transition-colors select-none min-w-[110px]"
                >
                  {c.label}
                  {sortKey === c.id && (
                    <span className="mr-1 text-indigo-600">{sortDir === "asc" ? "▲" : "▼"}</span>
                  )}
                  <div className="text-[9px] text-slate-400 font-normal mt-0.5 leading-tight">{c.sub(refYear)}</div>
                </th>
              ))}
              {postCols.map(renderTh)}
              {visibleChangeCols.map((cc) => (
                <th key={cc.id} className="sticky top-14 z-10 border-b border-slate-300 px-3 py-3 text-right text-slate-500 font-medium min-w-[155px] bg-indigo-50 border-r border-indigo-100">
                  <div className="flex items-center gap-1.5">
                    <span onClick={() => handleSort(cc.id)} className="cursor-pointer hover:text-indigo-700 select-none">
                      {cc.label}
                      {sortKey === cc.id && <span className="mr-1 text-indigo-600">{sortDir === "asc" ? "▲" : "▼"}</span>}
                    </span>
                    <select
                      value={win[cc.metric]}
                      onChange={(e) => setWin((w) => ({ ...w, [cc.metric]: Number(e.target.value) as Win }))}
                      onClick={(e) => e.stopPropagation()}
                      title="בחר פרק זמן"
                      className="text-[10px] border border-slate-200 rounded px-0.5 py-0.5 bg-white text-slate-600 cursor-pointer"
                    >
                      <option value={1}>שנה</option>
                      <option value={3}>3 שנים</option>
                      <option value={5}>5 שנים</option>
                      <option value={10}>10 שנים</option>
                    </select>
                  </div>
                  <div className="text-[9px] text-slate-400 font-normal mt-0.5">{cc.unit}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => {
              const inv = investor[row.city_name];
              return (
                <tr
                  key={row.city_name}
                  className={`border-b border-slate-200/40 hover:bg-indigo-50/40 transition-colors ${
                    i % 2 === 0 ? "" : "bg-slate-50/50"
                  }`}
                >
                  {preCols.map((col) => renderTd(row, col))}
                  {visibleInvCols.map((c) => (
                    <td key={c.id} className="px-3 py-2.5">
                      {c.render(inv)}
                    </td>
                  ))}
                  {postCols.map((col) => renderTd(row, col))}
                  {visibleChangeCols.map((cc) => {
                    const r = changePct(row.changeMetrics?.[cc.metric], win[cc.metric]);
                    return (
                      <td key={cc.id} className="px-3 py-2.5 bg-indigo-50/20 border-r border-indigo-100/60">
                        <TrendValue pct={r.pct} from={r.pct !== null ? r.from : null} to={r.pct !== null ? r.to : null} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Provenance — memory rule: source • period • confidence under every metric block */}
      <p className="mt-2 text-[10px] text-slate-400 text-right">
        🔵 מחירים ושינויי מחיר: מאגר העסקאות העצמאי (רשות המסים) · יד-2 = 3+ שנים משנת בנייה · שנת ייחוס {refYear} · אמינות לפי עומק דאטה · אוכלוסייה/משקי-בית: 🏛️ למ״ס
      </p>
    </div>
  );
}
