import type { ReactNode } from "react";

/**
 * "new ← old" — one definition of how this site shows a value that changed.
 *
 * THE BUG THIS EXISTS TO KILL
 * The direction used to be decided by the Unicode bidi algorithm, which means
 * it was decided by the CONTENT. Written as `{from} ← {to}` inside an RTL
 * page:
 *
 *   ₪12,345 ← ₪15,000   → digits and ₪ only, no strong-LTR character, so the
 *                         run stays RTL and renders new-on-the-left. Correct.
 *   ₪0.39M ← ₪0.67M     → the Latin "M" is a strong LTR character. Rule N1
 *                         resolves the arrow to L, the whole run becomes LTR,
 *                         and it renders new-on-the-RIGHT. Backwards.
 *
 * Those two lines sat in the same card, one above the other, showing the same
 * kind of relationship in opposite directions — and which one you got depended
 * on whether the formatter happened to append a letter. That is not something
 * a reader can be expected to decode, and it is not something the next
 * formatter change should be able to re-break.
 *
 * THE FIX IS STRUCTURAL, NOT TEXTUAL
 * Flexbox lays out its children by ITS OWN direction and ignores the bidi class
 * of the text inside them. So the pair is a flex row with `dir="ltr"` and the
 * DOM order [new, arrow, old]: left-to-right on screen, always, whatever the
 * values contain. Each value keeps its own internal LTR run, which is how a
 * price should read regardless of the surrounding page direction.
 *
 * THE RULE (operator, 8/2026), applied everywhere on the site:
 *   · the CURRENT value is on the left, and is the emphasised one
 *   · the OLD value is on the right, and is muted
 *   · the arrow always points right-to-left: ←
 */

export function FromTo({
  from, to, size = "sm", className = "",
}: {
  /** the older value — rendered muted, on the right */
  from: ReactNode;
  /** the current value — rendered bold, on the left */
  to: ReactNode;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const toSize = size === "md" ? "text-base" : size === "sm" ? "text-sm" : "text-xs";
  const fromSize = size === "md" ? "text-sm" : "text-xs";
  return (
    <span dir="ltr" className={`inline-flex items-baseline gap-1 tabular-nums ${className}`}>
      <b className={`${toSize} font-bold text-slate-900`}>{to}</b>
      <span aria-hidden className="text-slate-400">←</span>
      <span className={`${fromSize} font-normal text-slate-500`}>{from}</span>
    </span>
  );
}

/**
 * The same rule for a pair of YEARS ("2025 ← 2022").
 *
 * A year range is the same relationship with the same reading order, and
 * letting it drift the other way would reintroduce exactly the inconsistency
 * above one component over.
 */
export function YearRange({ from, to, className = "" }: { from: number; to: number; className?: string }) {
  return (
    <span dir="ltr" className={`inline-flex items-baseline gap-0.5 tabular-nums ${className}`}>
      <span>{to}</span>
      <span aria-hidden className="text-slate-400">←</span>
      <span>{from}</span>
    </span>
  );
}

/** Plain-text form, for emails and anywhere JSX cannot go. Same order. */
export function fromToText(from: string | number, to: string | number): string {
  return `${to} ← ${from}`;
}
