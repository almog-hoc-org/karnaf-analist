"use client";

import type { CohortRow } from "@/lib/events";

/**
 * Retention by signup week, as a heat map.
 *
 * WHY A GRID AND NOT THREE NUMBERS
 * One retention figure cannot separate "the product got better" from "last
 * month's traffic was worse" — both move the average. A cohort grid can: each
 * row is a fixed group of people, so reading DOWN a column shows whether newer
 * cohorts retain better than older ones, which is the only way to tell a
 * product change from a traffic change.
 *
 * The colour scale is deliberately anchored at 0–60% rather than to the
 * observed maximum. Auto-scaling to the data makes a terrible month look
 * healthy — the darkest cell is always dark, whatever it holds — which is
 * exactly the reassurance a retention chart must not provide.
 */
const CELL_HINT = "אחוז מהנרשמים באותו שבוע שחזרו לאתר בתוך פרק הזמן";

function tone(pct: number | null): string {
  if (pct == null) return "bg-slate-50 text-slate-300";
  if (pct === 0) return "bg-slate-100 text-slate-400";
  if (pct < 15) return "bg-indigo-50 text-indigo-900";
  if (pct < 30) return "bg-indigo-100 text-indigo-900";
  if (pct < 45) return "bg-indigo-300 text-white";
  if (pct < 60) return "bg-indigo-500 text-white";
  return "bg-indigo-700 text-white";
}

export default function CohortGrid({ rows }: { rows: CohortRow[] }) {
  if (!rows.length) return <p className="py-4 text-xs text-slate-400">אין עדיין נרשמים בתקופה.</p>;

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[380px] text-xs">
        <thead>
          <tr className="text-2xs uppercase text-slate-400">
            <th className="py-1 text-right font-bold">שבוע הרשמה</th>
            <th className="py-1 text-center font-bold">נרשמו</th>
            <th className="py-1 text-center font-bold" title={CELL_HINT}>יום</th>
            <th className="py-1 text-center font-bold" title={CELL_HINT}>שבוע</th>
            <th className="py-1 text-center font-bold" title={CELL_HINT}>חודש</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const cells = [pct(c.d1, c.signups), pct(c.d7, c.signups), pct(c.d30, c.signups)];
            return (
              <tr key={c.week}>
                <td className="py-0.5 pe-2 text-right tabular-nums text-slate-600" dir="ltr">{c.week}</td>
                <td className="py-0.5 px-1 text-center tabular-nums font-bold text-slate-800">{c.signups}</td>
                {cells.map((v, i) => (
                  <td key={i} className="p-0.5">
                    <div className={`rounded py-1 text-center text-2xs font-bold tabular-nums ${tone(v)}`}>
                      {v == null ? "—" : `${v}%`}
                    </div>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
