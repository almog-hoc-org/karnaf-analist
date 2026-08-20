"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A dashboard card that folds away, and remembers whether it was folded.
 *
 * WHY NATIVE <details> AND NOT A useState TOGGLE
 * The browser already implements this: keyboard operation, the correct ARIA
 * semantics, and — the part usually lost in a hand-rolled version — find-in-page
 * that can open a collapsed section to reveal a match. Reimplementing it means
 * reimplementing all three, usually badly. The only thing added here is
 * remembering the state, because a dashboard that re-collapses everything on
 * each visit is a dashboard nobody folds.
 *
 * The state lives in localStorage under the card's `id`. Changing an id resets
 * that card to its default and nothing else, which is the right failure mode.
 *
 * `summary` is what shows while the card is closed, so it must carry the one
 * number worth scanning — "25 עמודים · 3 מבוי סתום". A collapsed card whose
 * header says only its title forces the reader to open all of them to find out
 * which one is interesting, and then folding has cost more than it saved.
 */
export default function CollapsibleCard({
  id, title, summary, hint, action, defaultOpen = false, children,
}: {
  /** stable key for the remembered open/closed state */
  id: string;
  title: string;
  /** the scannable one-liner shown in the header, open or closed */
  summary?: ReactNode;
  /** the explanation of how to read this panel, shown only when open */
  hint?: string;
  /** e.g. a CSV button; rendered inside the header but outside the toggle */
  action?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const KEY = `karnaf_admin_card_${id}`;
  const [open, setOpen] = useState(defaultOpen);
  // The stored value is read AFTER mount, never during render: reading
  // localStorage while rendering makes the server and client markup disagree,
  // and React resolves that by discarding the client value — so the card would
  // silently ignore what it remembered.
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === "1" || raw === "0") setOpen(raw === "1");
    } catch { /* storage blocked — defaults are fine */ }
    hydrated.current = true;
  }, [KEY]);

  useEffect(() => {
    if (!hydrated.current) return;
    try { localStorage.setItem(KEY, open ? "1" : "0"); } catch { /* ignore */ }
  }, [KEY, open]);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="rounded-2xl border border-slate-200 bg-white"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3 hover:bg-slate-50">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="text-slate-400 transition-transform">{open ? "▾" : "◂"}</span>
          <span className="text-sm font-bold text-slate-900">{title}</span>
          {summary && <span className="text-2xs text-slate-500">{summary}</span>}
        </span>
        {action && (
          // Inside the summary but outside the toggle: clicking CSV must not
          // fold the card it is exporting.
          <span onClick={(e) => e.preventDefault()}>{action}</span>
        )}
      </summary>
      <div className="border-t border-slate-100 px-4 py-3">
        {hint && <p className="mb-3 text-2xs leading-relaxed text-slate-500">{hint}</p>}
        {children}
      </div>
    </details>
  );
}
