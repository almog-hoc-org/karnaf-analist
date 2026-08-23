"use client";

import { useCallback, useEffect, useState } from "react";
import { withBasePath } from "@/lib/basePath";

/**
 * Re-order the sections of a page without touching code.
 *
 * Two ways to move a row, because the two contexts are different: drag on a
 * desktop, ▲▼ on a phone. That is exactly the pattern the cities table already
 * uses for its columns, and reusing it means an operator who has moved a
 * column here already knows how to move a section.
 *
 * Nothing is destructive: "החזרה לסדר המקורי" drops the stored row and the
 * page goes back to the order written in lib/pageSections.
 */

interface Section { key: string; label: string; hint: string | null }
interface Page { page: string; label: string; custom: boolean; sections: Section[] }

export default function AdminSectionOrderPanel() {
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(withBasePath("/api/admin/section-order"));
      if (!res.ok) throw new Error(String(res.status));
      setPages((await res.json()).pages ?? []);
      setError(null);
    } catch {
      setError("לא הצלחנו לטעון את סדר האלמנטים");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(page: string, keys: string[]) {
    setSaving(page);
    try {
      const res = await fetch(withBasePath("/api/admin/section-order"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ page, keys }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setPages((await res.json()).pages ?? []);
      setError(null);
    } catch {
      setError("השמירה נכשלה — הסדר לא השתנה");
      void load();
    } finally {
      setSaving(null);
    }
  }

  async function reset(page: string) {
    setSaving(page);
    try {
      const res = await fetch(withBasePath("/api/admin/section-order"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ page, action: "reset" }),
      });
      setPages((await res.json()).pages ?? []);
    } finally {
      setSaving(null);
    }
  }

  /** Move `key` to `to` inside this page's list, then persist. */
  function move(p: Page, key: string, to: number) {
    const keys = p.sections.map((s) => s.key);
    const from = keys.indexOf(key);
    if (from < 0 || to < 0 || to >= keys.length || to === from) return;
    keys.splice(to, 0, keys.splice(from, 1)[0]);
    // optimistic: the row moves under the finger, the server confirms after
    setPages((cur) =>
      cur.map((x) => (x.page === p.page ? { ...x, sections: keys.map((k) => x.sections.find((s) => s.key === k)!) } : x))
    );
    void save(p.page, keys);
  }

  if (loading) return <p className="text-sm text-slate-500">טוען…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-black text-slate-900">סדר האלמנטים בעמודים</h2>
        <p className="mt-1 text-xs text-slate-500">
          גררו שורה, או השתמשו ב-▲▼, כדי לשנות את הסדר שבו הסקשנים מופיעים באתר. השינוי נכנס לתוקף מיד.
        </p>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {pages.map((p) => (
        <div key={p.page} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-black text-slate-800">
              {p.label}
              {p.custom && <span className="mr-2 rounded-full bg-indigo-50 px-2 py-0.5 text-2xs font-bold text-indigo-700">סדר מותאם</span>}
            </h3>
            <button
              type="button"
              onClick={() => reset(p.page)}
              disabled={!p.custom || saving === p.page}
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-2xs font-bold text-slate-500 hover:border-slate-300 hover:text-slate-700 disabled:opacity-40"
            >
              החזרה לסדר המקורי
            </button>
          </div>

          <ol className="space-y-1">
            {p.sections.map((s, i) => (
              <li
                key={s.key}
                draggable
                onDragStart={() => setDragKey(s.key)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (dragKey && dragKey !== s.key) move(p, dragKey, i); setDragKey(null); }}
                onDragEnd={() => setDragKey(null)}
                className={`flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 ${dragKey === s.key ? "opacity-50" : ""}`}
              >
                <span className="hidden cursor-grab text-slate-300 md:inline" aria-hidden>⠿</span>
                <span className="w-5 shrink-0 text-center text-2xs font-black text-slate-400 tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-slate-800">{s.label}</span>
                  {s.hint && <span className="block truncate text-2xs text-slate-400">{s.hint}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={`העלה את ${s.label}`}
                    onClick={() => move(p, s.key, i - 1)}
                    disabled={i === 0 || saving === p.page}
                    className="h-7 w-7 rounded-lg border border-slate-200 bg-white text-xs text-slate-500 disabled:opacity-30"
                  >▲</button>
                  <button
                    type="button"
                    aria-label={`הורד את ${s.label}`}
                    onClick={() => move(p, s.key, i + 1)}
                    disabled={i === p.sections.length - 1 || saving === p.page}
                    className="h-7 w-7 rounded-lg border border-slate-200 bg-white text-xs text-slate-500 disabled:opacity-30"
                  >▼</button>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
