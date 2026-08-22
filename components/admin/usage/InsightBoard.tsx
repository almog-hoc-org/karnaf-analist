"use client";

import { useMemo, useState } from "react";
import { withBasePath } from "@/lib/basePath";
import { buildUsageInsights, rankInsights, type Insight, type InsightTab } from "@/lib/usageInsights";
import type { UsagePayload } from "@/lib/usagePayload";

/**
 * The board that turns the dashboard's numbers into a list of things to do.
 *
 * It is the first thing on the page, above the KPI row, because the KPI row
 * answers "what are the numbers" and this answers "what should I do about
 * them" — and the second question is the one the operator actually came with.
 *
 * EACH CARD IS THREE SENTENCES AND A NUMBER, always in the same order:
 *   the number   — the headline, set large, because it is the evidence
 *   what it means — the interpretation the reader would otherwise have to supply
 *   what to do    — the recommendation, marked ← so it is findable at a glance
 * A card missing the third line is a fact, not an insight, and the engine does
 * not produce those.
 *
 * The mix is 85% fixes to 15% keeps (operator, 8/2026). The single "keep" card
 * is not decoration: it names the thing that is working, so it does not get
 * broken while something else is being fixed.
 */

const TONE: Record<string, { bar: string; chip: string; label: string }> = {
  "fix-3": { bar: "bg-rose-500", chip: "bg-rose-100 text-rose-800", label: "לתקן עכשיו" },
  "fix-2": { bar: "bg-amber-500", chip: "bg-amber-100 text-amber-800", label: "שווה טיפול" },
  "fix-1": { bar: "bg-sky-500", chip: "bg-sky-100 text-sky-800", label: "לשים לב" },
  "keep-1": { bar: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-800", label: "עובד — לשמר" },
};

function InsightCard({ insight, onNavigate }: { insight: Insight; onNavigate?: (tab: InsightTab) => void }) {
  const tone = TONE[`${insight.kind}-${insight.severity}`] ?? TONE["fix-1"];

  return (
    <article className="flex overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className={`w-1 shrink-0 ${tone.bar}`} aria-hidden />
      <div className="flex min-w-0 flex-1 gap-3 p-3">
        {/* The number carries the card. Set in the largest type here so the eye
            lands on the evidence before the prose. */}
        <div className="w-20 shrink-0 text-center sm:w-24">
          <p className="text-2xl font-black leading-none tabular-nums text-slate-900 sm:text-3xl" dir="ltr">
            {insight.metric}
          </p>
          <span className={`mt-1.5 inline-block rounded px-1.5 py-px text-2xs font-bold ${tone.chip}`}>
            {tone.label}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-bold text-slate-900">{insight.title}</h4>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">{insight.meaning}</p>
          <p className="mt-1.5 text-xs leading-relaxed font-semibold text-indigo-800">
            <span aria-hidden className="me-1">←</span>{insight.action}
          </p>
          {(insight.evidence || insight.href || insight.tab) && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-slate-400">
              {insight.evidence && <span>{insight.evidence}</span>}
              {insight.href && (
                <a
                  href={withBasePath(insight.href)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-indigo-600 hover:underline"
                >
                  פתח את העמוד ↗
                </a>
              )}
              {insight.tab && onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate(insight.tab!)}
                  className="font-bold text-indigo-600 hover:underline"
                >
                  לנתונים המלאים
                </button>
              )}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

export default function InsightBoard({
  data, onNavigate,
}: {
  data: UsagePayload;
  onNavigate?: (tab: InsightTab) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const { shown, rest } = useMemo(() => rankInsights(buildUsageInsights(data)), [data]);
  const list = showAll ? [...shown, ...rest] : shown;

  const fixes = shown.filter((i) => i.kind === "fix").length;
  const keeps = shown.filter((i) => i.kind === "keep").length;

  if (!list.length) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-6 text-center">
        <p className="text-sm font-bold text-slate-700">אין עדיין מספיק תנועה כדי להסיק משהו</p>
        <p className="mt-1 text-xs text-slate-500">
          כל חוק בלוח הזה דורש מינימום ראיות לפני שהוא מדבר. אחוזים שמחושבים על עשרה
          ביקורים זזים לפי התנהגות של אדם אחד, והמלצה שנגזרת מזה היא רעש בתחפושת של ניתוח.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-3">
      <header className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-black text-slate-900">
          💡 לוח תובנות
          <span className="ms-2 text-2xs font-normal text-slate-500">
            {fixes} לשיפור{keeps ? ` · ${keeps} לשימור` : ""}
          </span>
        </h3>
        <p className="text-2xs text-slate-500">
          נגזר מהנתונים בכל טעינה · כל סף מנומק בקוד
        </p>
      </header>

      <div className="space-y-2">
        {list.map((i) => (
          <InsightCard key={i.id} insight={i} onNavigate={onNavigate} />
        ))}
      </div>

      {rest.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-2xs font-bold text-indigo-700 hover:underline"
        >
          {showAll ? "הצג רק את החשובות" : `הצג עוד ${rest.length} תובנות`}
        </button>
      )}
    </section>
  );
}
