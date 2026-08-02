"use client";

import { useEffect, useState } from "react";
import { withBasePath } from "@/lib/basePath";

interface TableInfo { db: string; name: string; rows: number }

/** Read-only window into every table in both databases. */
export default function AdminTablesBrowser() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [sel, setSel] = useState<TableInfo | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetch(withBasePath("/api/admin/tables")).then((r) => r.json()).then((d) => setTables(d.tables ?? [])); }, []);

  const open = async (t: TableInfo) => {
    setSel(t); setLoading(true); setRows([]);
    const res = await fetch(withBasePath(`/api/admin/tables?table=${encodeURIComponent(t.name)}&db=${t.db}`));
    const d = await res.json();
    setRows(d.rows ?? []); setLoading(false);
  };

  const cols = rows.length ? Object.keys(rows[0]) : [];

  return (
    <section className="glass-card p-5">
      <h2 className="mb-1 text-lg font-black text-slate-900">🗄️ טבלאות המאגר</h2>
      <p className="mb-3 text-2xs text-slate-500">כל הטבלאות בשני מסדי הנתונים — לצפייה ובקרה (200 שורות ראשונות)</p>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {tables.map((t) => (
          <button key={t.db + t.name} onClick={() => open(t)}
            className={`rounded-full border px-2.5 py-1 text-2xs font-bold transition-colors ${
              sel?.name === t.name ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300"
            }`}>
            {t.name}
            <span className={`mr-1 text-2xs ${sel?.name === t.name ? "text-indigo-100" : "text-slate-400"}`}>
              {t.rows.toLocaleString("he-IL")}
            </span>
          </button>
        ))}
        {tables.length === 0 && <span className="text-xs text-slate-400">טוען טבלאות…</span>}
      </div>

      {sel && (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          {loading ? (
            <p className="p-6 text-center text-xs text-slate-400">טוען {sel.name}…</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-400">הטבלה ריקה</p>
          ) : (
            <table className="w-full text-2xs" dir="ltr">
              <thead className="bg-slate-50 text-2xs font-bold text-slate-500">
                <tr className="border-b border-slate-200">{cols.map((c) => <th key={c} className="whitespace-nowrap px-2 py-2 text-left">{c}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-indigo-50/40">
                    {/* mobile cells wrap instead of truncating — title-tooltips don't exist on touch */}
                    {cols.map((c) => (
                      <td key={c} className="max-w-[220px] truncate whitespace-nowrap px-2 py-1.5 text-slate-700 max-md:whitespace-normal max-md:break-words" title={String(r[c] ?? "")}>
                        {String(r[c] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
