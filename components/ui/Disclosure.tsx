import type { ReactNode } from "react";

/**
 * Advanced options, closed until the reader asks for them.
 *
 * Native <details>/<summary>: keyboard and screen-reader support for free, it
 * works before hydration, and a server component can use it. Same element the
 * admin's CollapsibleCard already uses, without the admin chrome.
 *
 * `summary` is the one line shown while closed — say what is inside ("סוג
 * עסקה, חדרים, שנים"), not just "עוד".
 */
export default function Disclosure({
  label,
  summary,
  defaultOpen = false,
  className = "",
  children,
}: {
  label: ReactNode;
  summary?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className={`group ${className}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold text-slate-600 hover:text-indigo-700 [&::-webkit-details-marker]:hidden">
        <span className="text-xs text-slate-400 group-open:hidden" aria-hidden>◂</span>
        <span className="hidden text-xs text-slate-400 group-open:inline" aria-hidden>▾</span>
        <span>{label}</span>
        {summary && <span className="text-xs font-medium text-slate-400">{summary}</span>}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
