"use client";

/**
 * Accessible "מה זה?" tooltip — the ⓘ next to a metric.
 *
 * NOT title= on purpose: title tooltips never fire on touch screens, appear
 * after a hover delay desktop users rarely wait out, and cannot be styled or
 * read reliably by screen readers. This is a real disclosure button:
 *
 *   - click/tap toggles (touch-first — most traffic is mobile)
 *   - hover opens on desktop as a convenience
 *   - Escape and clicking anywhere else close it
 *   - aria-expanded + aria-describedby wire it for screen readers
 *
 * The bubble is positioned with fixed coordinates measured from the trigger,
 * not CSS absolute: metric labels live inside overflow-x-auto table wrappers
 * (the mobile scroll pattern), and an absolutely-positioned bubble inside one
 * gets clipped by the very container that makes the table scrollable.
 */
import { useEffect, useId, useRef, useState } from "react";

export default function InfoTip({ text, label = "הסבר" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    if (btn) {
      const r = btn.getBoundingClientRect();
      const width = Math.min(288, window.innerWidth - 24);
      // centered on the trigger, clamped to the viewport
      const left = Math.max(12, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 12));
      setPos({ top: r.bottom + 8, left });
    }
    // Capture-phase, so clicks inside stopPropagation-happy neighbours still
    // close the bubble — but it MUST skip the trigger and the bubble itself:
    // the capture listener fires before the button's own onClick, so a naive
    // "close on any click" made the toggle re-open on every tap (close→toggle
    // batched to open), and closed the bubble despite its own stopPropagation.
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || bubbleRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onMouseEnter={() => setOpen(true)}
        className="inline-flex h-4 w-4 shrink-0 select-none items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-bold leading-none text-slate-400 align-[0.1em] transition-colors hover:border-indigo-400 hover:text-indigo-600"
      >
        i
      </button>
      {open && pos && (
        <div
          id={id}
          ref={bubbleRef}
          role="tooltip"
          dir="rtl"
          className="fixed z-[70] rounded-xl border border-slate-200 bg-white p-3 text-right text-xs font-normal leading-relaxed text-slate-600 shadow-lg"
          style={{ top: pos.top, left: pos.left, width: Math.min(288, typeof window !== "undefined" ? window.innerWidth - 24 : 288) }}
        >
          {text}
        </div>
      )}
    </>
  );
}
