"use client";

import { CREDIT_EVENT } from "@/lib/feedbackOpen";
import Icon from "@/components/Icon";

export default function FeedbackOpenButton({ label = "השאירו פידבק", className = "" }: { label?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(CREDIT_EVENT))}
      className={className || "inline-flex items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-700 transition hover:bg-indigo-100"}
    >
      <Icon name="chat" size="1em" />
      {label}
    </button>
  );
}
