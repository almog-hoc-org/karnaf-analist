"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/lib/basePath";

/**
 * Admin deals browser — search, filter, sort, paginate the raw repository;
 * exclude/unexclude single deals or everything matching the current filter;
 * apply changes to the site with one button (re-aggregation).
 */

interface Row {
  id: number; city_name: string; neighborhood: string | null; street: string | null;
  house_num: string | null; floor: number | null; deal_date: string; deal_year: number;
  rooms: number | null; rooms_effective: number | null; room_reclassified: number; room_bucket: string; area: number | null; price: number | null;
  price_sqm: number | null; year_built: number | null; is_secondhand: number;
  excluded: number; exclusion_reason: string | null; source: string; luxury?: number;
}

const EMPTY_FILTERS = {
  city: "", street: "", neighborhood: "", yearFrom: "", yearTo: "",
  priceMin: "", priceMax: "", sqmMin: "", sqmMax: "", rooms: "", source: "", cls: "", excluded: "no", reason: "", luxury: "",
};

export default function AdminDealsBrowser({ cities }: { cities: string[] }) {
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [applied, setApplied] = useState({ ...EMPTY_FILTERS });
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "deal_date", dir: "desc" });
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [reason, setReason] = useState("");
  const [pendingChanges, setPendingChanges] = useState(false);
  const [applyState, setApplyState] = useState<string>("");

  const per = 50;
  const pages = Math.max(1, Math.ceil(total / per));

  const query = useCallback(async (f = applied, p = page, s = sort) => {
    setLoading(true);
    const sp = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) sp.set(k, String(v)); });
    sp.set("page", String(p)); sp.set("per", String(per)); sp.set("sort", s.col); sp.set("dir", s.dir);
    try {
      const res = await fetch(withBasePath(`/api/admin/deals?${sp}`));
      const data = await res.json();
      setRows(data.rows ?? []); setTotal(data.total ?? 0);
    } finally { setLoading(false); }
  }, [applied, page, sort]);

  useEffect(() => { query(); }, [applied, page, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const runFilter = () => { setPage(1); setChecked(new Set()); setApplied({ ...filters }); };
  const clearFilter = () => { setFilters({ ...EMPTY_FILTERS }); setApplied({ ...EMPTY_FILTERS }); setPage(1); };

  const act = async (action: "exclude" | "unexclude", byFilter: boolean) => {
    const body: any = { action, reason };
    if (byFilter) {
      if (!confirm(`${action === "exclude" ? "להחריג" : "להחזיר"} את כל ${total.toLocaleString("he-IL")} העסקאות התואמות לפילטר?`)) return;
      body.filters = Object.fromEntries(Object.entries(applied).filter(([, v]) => v));
    } else {
      if (checked.size === 0) return alert("סמן עסקאות קודם");
      body.ids = [...checked];
    }
    const res = await fetch(withBasePath("/api/admin/deals"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.ok) { setPendingChanges(true); setChecked(new Set()); query(); }
    else alert(data.error ?? "שגיאה");
  };

  const applyToSite = async () => {
    setApplyState("מריץ אגרגציה…");
    const res = await fetch(withBasePath("/api/admin/reaggregate"), { method: "POST" });
    const data = await res.json();
    setApplyState(data.ok ? `✓ הוחל: ${data.statRows?.toLocaleString("he-IL")} שורות סטטיסטיקה` : `✗ ${data.error}`);
    if (data.ok) setPendingChanges(false);
  };

  const exportCsv = () => {
    const head = "id,city,neighborhood,street,house,floor,date,year,rooms,area,price,price_sqm,year_built,secondhand,excluded,source";
    const lines = rows.map((r) => [r.id, r.city_name, r.neighborhood, r.street, r.house_num, r.floor, r.deal_date?.slice(0, 10), r.deal_year, r.rooms, r.area, r.price, r.price_sqm, r.year_built, r.is_secondhand, r.excluded, r.source]
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    const blob = new Blob(["﻿" + [head, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "karnaf-deals.csv"; a.click();
  };

  const th = (col: string, label: string) => (
    <th className="cursor-pointer whitespace-nowrap px-2 py-2 hover:text-indigo-700"
      onClick={() => setSort((s) => ({ col, dir: s.col === col && s.dir === "desc" ? "asc" : "desc" }))}>
      {label}{sort.col === col ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
    </th>
  );
  const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-2xs focus:border-indigo-400 focus:outline-none";

  return (
    <section className="glass-card p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-lg font-black text-slate-900">🔎 דפדפן העסקאות</h2>
        {pendingChanges && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-2xs font-bold text-amber-700">
            יש החרגות שטרם הוחלו על האתר
          </span>
        )}
        <button onClick={applyToSite} className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-indigo-700">
          ⚡ החל שינויים על האתר
        </button>
        {applyState && <span className="text-2xs text-slate-500">{applyState}</span>}
      </div>

      {/* filters */}
      <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-6">
        <select value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })} className={inputCls}>
          <option value="">כל הערים</option>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input placeholder="רחוב" value={filters.street} onChange={(e) => setFilters({ ...filters, street: e.target.value })} className={inputCls} />
        <input placeholder="שכונה" value={filters.neighborhood} onChange={(e) => setFilters({ ...filters, neighborhood: e.target.value })} className={inputCls} />
        <div className="flex gap-1">
          <input placeholder="משנה" value={filters.yearFrom} onChange={(e) => setFilters({ ...filters, yearFrom: e.target.value })} inputMode="numeric" className={`${inputCls} min-w-0`} />
          <input placeholder="עד" value={filters.yearTo} onChange={(e) => setFilters({ ...filters, yearTo: e.target.value })} inputMode="numeric" className={`${inputCls} min-w-0`} />
        </div>
        <div className="flex gap-1">
          <input placeholder="₪ מ-" value={filters.priceMin} onChange={(e) => setFilters({ ...filters, priceMin: e.target.value })} inputMode="numeric" className={`${inputCls} min-w-0`} />
          <input placeholder="₪ עד" value={filters.priceMax} onChange={(e) => setFilters({ ...filters, priceMax: e.target.value })} inputMode="numeric" className={`${inputCls} min-w-0`} />
        </div>
        <div className="flex gap-1">
          <input placeholder="₪/מ״ר מ-" value={filters.sqmMin} onChange={(e) => setFilters({ ...filters, sqmMin: e.target.value })} inputMode="numeric" className={`${inputCls} min-w-0`} />
          <input placeholder="עד" value={filters.sqmMax} onChange={(e) => setFilters({ ...filters, sqmMax: e.target.value })} inputMode="numeric" className={`${inputCls} min-w-0`} />
        </div>
        <select value={filters.rooms} onChange={(e) => setFilters({ ...filters, rooms: e.target.value })} className={inputCls}>
          <option value="">כל הגדלים</option><option value="3">3 חד׳</option><option value="4">4 חד׳</option><option value="5">5+ חד׳</option>
        </select>
        <select value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })} className={inputCls}>
          <option value="">שני הערוצים</option><option value="govmap">govmap</option><option value="nadlan">nadlan</option>
        </select>
        <select value={filters.cls} onChange={(e) => setFilters({ ...filters, cls: e.target.value })} className={inputCls}>
          <option value="">כל הסיווגים</option><option value="secondhand">יד שנייה</option><option value="new">חדשה</option><option value="unclassified">ללא שנת בנייה</option>
        </select>
        <select value={filters.excluded} onChange={(e) => setFilters({ ...filters, excluded: e.target.value })} className={inputCls}>
          <option value="no">בשימוש בלבד</option><option value="yes">מוחרגות בלבד</option><option value="">הכל</option>
        </select>
        <button onClick={runFilter} className="rounded-lg bg-indigo-600 px-3 py-1 text-2xs font-bold text-white hover:bg-indigo-700">סנן</button>
        <button onClick={clearFilter} className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-2xs font-bold text-slate-500">נקה</button>
        <button
          onClick={() => { const f = { ...EMPTY_FILTERS, excluded: "yes", reason: "אנומליית מחיר" }; setFilters(f); setApplied(f); setPage(1); setChecked(new Set()); }}
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1 text-2xs font-bold text-amber-700 hover:bg-amber-100"
          title="עסקאות שסווגו אנומליית-מחיר: סטייה מעל הסף (35%, עריך) מחציון שכונה/עיר×שנה×חדרים×בניין-מודרני/ישן, או מעבר לרשת-הביטחון העירונית">
          ⚠️ אנומליות מחיר (פסולות)
        </button>
        <button
          onClick={() => { const f = { ...EMPTY_FILTERS, excluded: "yes", reason: "כפילות-דיווח" }; setFilters(f); setApplied(f); setPage(1); setChecked(new Set()); }}
          className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1 text-2xs font-bold text-sky-700 hover:bg-sky-100"
          title="אותה מכירה שדווחה פעמיים בהפרש ימים בודדים — מחיר, שטח וחדרים זהים. נשמרה הרשומה המלאה ביותר, אלה העותקים שיצאו מהספירות ומהמחירים">
          👯 כפילויות דיווח
        </button>
        <button
          onClick={() => { const f = { ...EMPTY_FILTERS, excluded: "no", luxury: "yes" }; setFilters(f); setApplied(f); setPage(1); setChecked(new Set()); }}
          className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1 text-2xs font-bold text-violet-700 hover:bg-violet-100"
          title="עסקאות שעברו את שני תנאי היוקרה — הן נספרות ומוצגות באתר, אך אינן נכללות בממוצעים, בחציונים ובגרפים">
          💎 עסקאות יוקרה
        </button>
      </div>

      {/* actions row */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-2xs">
        <span className="font-bold text-slate-700">{loading ? "טוען…" : `${total.toLocaleString("he-IL")} עסקאות תואמות`}</span>
        <span className="text-slate-300">|</span>
        <input placeholder="סיבת החרגה…" value={reason} onChange={(e) => setReason(e.target.value)}
          className="w-44 rounded-lg border border-slate-200 px-2 py-1 text-2xs focus:border-indigo-400 focus:outline-none" />
        <button onClick={() => act("exclude", false)} className="rounded-full border border-red-200 bg-red-50 px-3 py-1 font-bold text-red-600 hover:bg-red-100">🚫 החרג מסומנות ({checked.size})</button>
        <button onClick={() => act("unexclude", false)} className="rounded-full border border-slate-200 bg-white px-3 py-1 font-bold text-slate-600">↩️ החזר מסומנות</button>
        <button onClick={() => act("exclude", true)} className="rounded-full border border-red-300 bg-white px-3 py-1 font-bold text-red-600">החרג את כל התוצאה המסוננת</button>
        <button onClick={exportCsv} className="mr-auto rounded-full border border-slate-200 bg-white px-3 py-1 font-bold text-slate-600">⬇ CSV</button>
      </div>

      {/* table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[1050px] text-2xs" dir="rtl">
          <thead className="bg-slate-50 text-2xs font-bold text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="px-2 py-2"><input type="checkbox" className="h-4 w-4" onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
              {th("deal_date", "תאריך")}{th("city_name", "עיר")}{th("street", "כתובת")}
              <th className="px-2 py-2">שכונה</th>
              {th("rooms", "חד׳")}{th("area", "מ״ר")}{th("price", "מחיר")}{th("price_sqm", "₪/מ״ר")}{th("year_built", "שנת בנייה")}
              <th className="px-2 py-2">סיווג</th>{th("source", "ערוץ")}<th className="px-2 py-2">סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-b border-slate-100 hover:bg-indigo-50/40 ${r.excluded ? "bg-red-50/50 text-slate-400" : ""}`}>
                <td className="px-2 py-1.5 text-center">
                  <input type="checkbox" className="h-4 w-4" checked={checked.has(r.id)}
                    onChange={(e) => setChecked((s) => { const n = new Set(s); e.target.checked ? n.add(r.id) : n.delete(r.id); return n; })} />
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{r.deal_date?.slice(0, 10)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-slate-800">{r.city_name}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{[r.street, r.house_num].filter(Boolean).join(" ") || "—"}{r.floor != null ? ` · ק${r.floor}` : ""}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">{r.neighborhood ?? "—"}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">
                  {r.room_reclassified ? (
                    <span title={`דווח ${r.rooms} חד׳ · לפי שטח ${r.rooms_effective} חד׳`}>
                      <span className="text-slate-400 line-through">{r.rooms}</span>
                      <span className="font-bold text-amber-600"> →{r.rooms_effective}</span>
                    </span>
                  ) : (r.rooms ?? "—")}
                </td>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.area ?? "—"}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-center font-bold tabular-nums">{r.price != null ? `₪${Number(r.price).toLocaleString("he-IL")}` : "—"}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.price_sqm != null ? Number(r.price_sqm).toLocaleString("he-IL") : "—"}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.year_built ?? "—"}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-center">
                  {r.year_built == null ? <span className="text-slate-400">כללי</span> : r.is_secondhand ? "יד-2" : "חדשה"}
                </td>
                <td className="px-2 py-1.5 text-center text-slate-500">{r.source}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-center">
                  {r.excluded ? <span title={r.exclusion_reason ?? ""} className="font-bold text-red-500">🚫 מוחרגת</span> : <span className="text-emerald-700">בשימוש</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={13} className="px-2 py-8 text-center text-slate-400">אין תוצאות לפילטר</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* pagination */}
      <div className="mt-2 flex items-center justify-center gap-2 text-2xs">
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1 font-bold disabled:opacity-30">→ הקודם</button>
        <span className="tabular-nums text-slate-500">עמוד {page} / {pages.toLocaleString("he-IL")}</span>
        <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1 font-bold disabled:opacity-30">הבא ←</button>
      </div>
    </section>
  );
}
