"use client";

import type { FunnelStage } from "@/lib/events";

/**
 * The funnel, drawn so the LOSS is what you see.
 *
 * A funnel chart usually shows the surviving bar at each step, which makes the
 * eye follow what remains. The thing worth acting on is the opposite — how
 * many were lost between two steps, and the biggest single drop is the one
 * place where work pays off most. So each row carries the survivors as a solid
 * bar, the loss as a faded remainder, and the drop is called out in words
 * between the rows.
 *
 * The steepest drop is marked. On a six-step funnel the largest loss is not
 * always obvious by eye, especially when an early step is much wider than the
 * rest, and finding it is the entire point of looking.
 *
 * Deliberately hand-drawn divs rather than a charting library: this is a
 * stack of proportional bars, and the library version costs a canvas, an
 * animation and a tooltip to render six rectangles.
 */
export default function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const top = stages[0]?.n ?? 0;
  if (!top) return <p className="py-4 text-xs text-slate-400">אין עדיין תנועה בתקופה.</p>;

  // Biggest absolute loss between consecutive steps — where the work pays off.
  let worst = -1, worstLoss = 0;
  for (let i = 1; i < stages.length; i++) {
    const loss = stages[i - 1].n - stages[i].n;
    if (loss > worstLoss) { worstLoss = loss; worst = i; }
  }

  return (
    <div className="space-y-0.5">
      {stages.map((s, i) => {
        const widthPct = Math.max((s.n / top) * 100, s.n ? 2 : 0);
        const lost = i === 0 ? 0 : stages[i - 1].n - s.n;
        const isWorst = i === worst && worstLoss > 0;
        return (
          <div key={s.key}>
            {i > 0 && (
              <div className="flex items-center gap-2 py-0.5 ps-40">
                <span className={`text-2xs tabular-nums ${isWorst ? "font-bold text-rose-600" : "text-slate-400"}`}>
                  ↓ {lost.toLocaleString("he-IL")} נשרו ({100 - s.ofPreviousPct}%)
                  {isWorst && " — הנשירה הגדולה ביותר"}
                </span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="w-40 shrink-0 truncate text-xs text-slate-600" title={s.label}>{s.label}</span>
              <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-slate-100">
                <div
                  className={`flex h-full items-center justify-end px-2 text-2xs font-bold text-white ${isWorst ? "bg-rose-500" : "bg-indigo-500"}`}
                  style={{ width: `${widthPct}%` }}
                >
                  {s.n ? s.n.toLocaleString("he-IL") : ""}
                </div>
              </div>
              <span className="w-14 shrink-0 text-left text-2xs tabular-nums text-slate-500">
                {i === 0 ? "" : `${s.ofPreviousPct}%`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
