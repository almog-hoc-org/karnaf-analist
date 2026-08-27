"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Click a number, get an input — the /deals table's field editor.
 *
 * THE ONLY WAY TO FIX A WRONG PRICE USED TO BE DELETE-AND-RETYPE, while the
 * server action already accepted a one-field patch. This closes the UI gap
 * and steps around the two traps the action's shape sets:
 *
 *   · An EMPTY input must save null, never 0 — Number("") is 0, and a deal
 *     "priced" at ₪0 poisons every comparison it appears in. Same guard the
 *     add-form uses.
 *   · Every event stops propagation: the row above it opens the detail panel
 *     on any click, and "I clicked the price to fix it" must not also mean
 *     "and the row exploded open".
 *
 * Enter or blur saves (only when the value actually changed), Escape reverts.
 */
export default function InlineEdit({
  value, onSave, fmt, placeholder = "—", suffix, className = "",
}: {
  value: number | null;
  onSave: (v: number | null) => void;
  /** how the resting (non-editing) state renders the number */
  fmt: (v: number) => string;
  placeholder?: string;
  /** e.g. ' מ״ר' after the input, orientation hint while typing */
  suffix?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = parseInlineDraft(draft);
    if (next === undefined) return; // garbage: keep the old value
    if (next === value) return;
    onSave(next);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(value == null ? "" : String(value));
          setEditing(true);
        }}
        title="לחצו לעריכה"
        className={`cursor-text rounded px-1 -mx-1 text-right tabular-nums transition-colors hover:bg-indigo-50 hover:ring-1 hover:ring-indigo-200 ${className}`}
      >
        {value == null ? <span className="text-slate-300">{placeholder}</span> : fmt(value)}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") setEditing(false);
        }}
        inputMode="decimal"
        dir="ltr"
        className="w-24 rounded-md border border-indigo-300 bg-white px-1.5 py-0.5 text-right text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-200"
      />
      {suffix && <span className="text-2xs text-slate-400">{suffix}</span>}
    </span>
  );
}

/** The empty-to-null parse, exported for the test that pins it. */
export function parseInlineDraft(draft: string): number | null | undefined {
  const t = draft.trim();
  if (t === "") return null;
  const n = Number(t.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : undefined; // undefined = invalid, keep old
}
