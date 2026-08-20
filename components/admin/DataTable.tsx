"use client";

import { useMemo, useState, type ReactNode } from "react";
import { downloadCsv } from "@/lib/csv";

/**
 * One dense, sortable table for the whole dashboard.
 *
 * WHY ONE COMPONENT AND NOT SEVEN HAND-WRITTEN TABLES
 * The dashboard had seven, each built separately, and they had already drifted:
 * some sorted, some did not, alignment differed, and only some exported. Every
 * new panel meant re-deciding solved questions. This holds the answers once —
 * numbers right-aligned in tabular figures, headers sortable, the export
 * derived from the same column definitions the table renders.
 *
 * THE IN-CELL BAR is the part that earns its keep. A column of numbers
 * requires the reader to do the division; a bar behind the number shows the
 * share of the total at a glance, which is what "which pages matter" actually
 * asks. It is drawn behind the text rather than beside it so it costs no
 * width — in a dense console, width is the scarce resource.
 */

export interface Column<T> {
  key: string;
  label: string;
  /** what to render; omit for a plain value read from `sort` */
  render?: (row: T) => ReactNode;
  /** numeric value used for sorting AND for the in-cell bar */
  sort?: (row: T) => number | string;
  align?: "start" | "end";
  /** draw a proportional bar behind this cell, scaled to the column's max */
  bar?: boolean;
  /** value for the CSV export; falls back to `sort` */
  csv?: (row: T) => string | number;
  width?: string;
}

export default function DataTable<T>({
  rows, columns, initialSort, csvName, empty = "אין נתונים בתקופה.", maxRows,
}: {
  rows: T[];
  columns: Column<T>[];
  /** column key to sort by on first render — descending */
  initialSort?: string;
  /** filename (without extension) enables the CSV button */
  csvName?: string;
  empty?: string;
  /** show only the first N until the reader asks for the rest */
  maxRows?: number;
}) {
  const [sortKey, setSortKey] = useState<string | null>(initialSort ?? null);
  const [desc, setDesc] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sort) return rows;
    const get = col.sort;
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      const cmp = typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y), "he");
      return desc ? -cmp : cmp;
    });
  }, [rows, columns, sortKey, desc]);

  // Bar scale per column, from ALL rows rather than the visible page — so
  // collapsing the table does not silently rescale every bar in it.
  const maxes = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of columns) {
      if (!c.bar || !c.sort) continue;
      let max = 0;
      for (const r of rows) {
        const v = c.sort(r);
        if (typeof v === "number" && v > max) max = v;
      }
      m.set(c.key, max);
    }
    return m;
  }, [rows, columns]);

  if (!rows.length) return <p className="py-3 text-xs text-slate-400">{empty}</p>;

  const visible = maxRows && !expanded ? sorted.slice(0, maxRows) : sorted;

  const toggle = (key: string) => {
    if (sortKey === key) setDesc((d) => !d);
    else { setSortKey(key); setDesc(true); }
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-2xs uppercase text-slate-400">
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  className={`py-1.5 font-bold ${c.align === "end" ? "text-left" : "text-right"} ${c.sort ? "cursor-pointer select-none hover:text-slate-700" : ""}`}
                  onClick={c.sort ? () => toggle(c.key) : undefined}
                  aria-sort={sortKey === c.key ? (desc ? "descending" : "ascending") : undefined}
                >
                  {c.label}
                  {sortKey === c.key && <span aria-hidden className="ms-0.5">{desc ? "▾" : "▴"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50/70">
                {columns.map((c) => {
                  const max = maxes.get(c.key) ?? 0;
                  const v = c.bar && c.sort ? c.sort(row) : null;
                  const pct = typeof v === "number" && max > 0 ? (v / max) * 100 : 0;
                  return (
                    <td
                      key={c.key}
                      className={`relative py-1.5 ${c.align === "end" ? "text-left tabular-nums" : "text-right"}`}
                    >
                      {pct > 0 && (
                        <span
                          aria-hidden
                          className="absolute inset-y-0.5 end-0 rounded bg-indigo-100/70"
                          style={{ width: `${pct}%` }}
                        />
                      )}
                      <span className="relative">
                        {c.render ? c.render(row) : String(c.sort?.(row) ?? "")}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        {maxRows && sorted.length > maxRows ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-2xs font-bold text-indigo-600 hover:underline"
          >
            {expanded ? "הצג פחות" : `הצג את כל ${sorted.length} השורות`}
          </button>
        ) : <span />}
        {csvName && (
          <button
            type="button"
            onClick={() => downloadCsv(
              csvName,
              columns.map((c) => c.label),
              sorted.map((r) => columns.map((c) => (c.csv ?? c.sort)?.(r) ?? "")),
            )}
            className="rounded border border-slate-200 px-2 py-0.5 text-2xs font-bold text-slate-500 hover:bg-slate-50"
          >
            CSV
          </button>
        )}
      </div>
    </div>
  );
}
