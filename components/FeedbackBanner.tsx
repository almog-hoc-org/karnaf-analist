"use client";

import { CREDIT_EVENT } from "@/lib/feedbackOpen";

/**
 * Inline invitation to leave feedback — placed beside the tools people
 * actually use (deals manager, calculators), per the operator spec 8/2026.
 * Clicking opens the global FeedbackWidget (it listens for the event), so
 * there is ONE feedback flow, one spam defense, one inbox.
 */
export default function FeedbackBanner({ bonus }: { bonus: number }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(CREDIT_EVENT))}
      className="flex w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/50 px-4 py-2.5 text-xs text-slate-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50"
    >
      <span>💬 יש לכם תוספות או דברים שחסרים לכם?</span>
      <span className="font-bold text-indigo-700">רשמו לנו משוב וקבלו {bonus} קרדיטים ←</span>
    </button>
  );
}
