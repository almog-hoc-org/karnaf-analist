"use client";

import { useMemo, useState } from "react";
import type { NadlanDeal } from "@/lib/nadlanTransactionSeries";

/**
 * A compact, collapsible, SCROLLABLE panel listing the actual nadlan deals behind a graph,
 * for the currently-active filter (rooms + year-range + scope). Lets the user inspect the
 * raw source and judge its reliability. Not a full-page takeover — a small drawer.
 */
type SortKey = "dealDate" | "rooms" | "area" | "price" | "priceSqm" | "yearBuilt";

function nis(v: number | null): string {
  return v == null ? "—" : `₪${Math.round(v).toLocaleString("he-IL")}`;
}

export default function DealsDrawer({ deals, accent = "slate" }: { deals: NadlanDeal[]; accent?: "indigo" | "emerald" | "slate" }) {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "dealDate", dir: -1 });

  const sorted = useMemo(() => {
    const arr = [...deals];
    arr.sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") return av < bv ? -sort.dir : av > bv ? sort.dir : 0;
      return ((av as number) - (bv as number)) * sort.dir;
    });
    return arr;
  }, [deals, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }));
  const accentText = accent === "emerald" ? "text-emerald-700" : accent === "indigo" ? "text-indigo-700" : "text-slate-700";
  const accentBg = accent === "emerald" ? "bg-emerald-50 border-emerald-200" : accent === "indigo" ? "bg-indigo-50 border-indigo-200" : "bg-slate-50 border-slate-200";

  const HEADERS: { key: SortKey; label: string }[] = [
    { key: "dealDate", label: "תאריך" },
    { key: "rooms", label: "חד׳" },
    { key: "area", label: "מ״ר" },
    { key: "price", label: "מחיר" },
    { key: "priceSqm", label: "₪/מ״ר" },
    { key: "yearBuilt", label: "שנת בנייה" },
  ];

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${accentText} ${accentBg} border rounded-lg px-2.5 py-1 hover:brightness-95 transition`}
      >
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        {open ? "הסתר עסקאות" : "הצג עסקאות"} ({deals.length.toLocaleString("he-IL")})
      </button>

      {open && (
        <div className={`mt-2 rounded-xl border ${accentBg} overflow-hidden`}>
          <div className="max-h-72 overflow-y-auto overflow-x-auto">
            <table className="min-w-full text-[11px]">
              <thead className="sticky top-0 bg-white/95 backdrop-blur border-b border-slate-200 z-10">
                <tr className="text-slate-500 font-bold">
                  {HEADERS.map((h) => (
                    <th key={h.key} className="text-right py-1.5 px-2 whitespace-nowrap cursor-pointer select-none hover:text-slate-800" onClick={() => toggleSort(h.key)}>
                      {h.label}{sort.key === h.key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
                    </th>
                  ))}
                  <th className="text-center py-1.5 px-2 whitespace-nowrap">יד</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d, i) => (
                  <tr key={i} className="border-b border-slate-100/70 hover:bg-white/60">
                    <td className="py-1 px-2 text-right tabular-nums whitespace-nowrap">{d.dealDate}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{d.rooms ?? "—"}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{d.area ?? "—"}</td>
                    <td className="py-1 px-2 text-right tabular-nums whitespace-nowrap">{nis(d.price)}</td>
                    <td className="py-1 px-2 text-right tabular-nums whitespace-nowrap">{nis(d.priceSqm)}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{d.yearBuilt || "—"}</td>
                    <td className="py-1 px-2 text-center">
                      {d.yearBuilt ? (
                        <span className={`inline-block rounded px-1 text-[9px] font-bold ${d.isSecondHand ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                          {d.isSecondHand ? "שנייה" : "ראשונה"}
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr><td colSpan={7} className="py-4 text-center text-slate-400">אין עסקאות לסינון הנוכחי</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-1.5 text-[10px] text-slate-500 border-t border-slate-200 bg-white/50">
            מקור: nadlan.gov.il — עסקאות אחרונות ביישוב (רשות המסים) • &quot;יד&quot; לפי שנת בנייה מול שנת עסקה (הפרש ≥ 3 שנים = יד שנייה)
          </div>
        </div>
      )}
    </div>
  );
}
