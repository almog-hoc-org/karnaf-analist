import { withBasePath } from "@/lib/basePath";
import Icon from "@/components/Icon";

/**
 * Standard provenance caption for every KPI on the dashboard.
 *
 * The user is a real-estate consultant who needs to defend every number when
 * showing the page to a client. Each KPI must show:
 *   • source — where the number came from
 *   • period — what window/year it covers
 *   • updated — when CBS/we last refreshed it (optional, falls back to source pub date)
 *
 * Renders as one tight line of slate-500 micro-text. Source can be a URL/path
 * so the user can click straight to the official PDF.
 *
 * Example:
 *   <NumberCaption
 *     source='למ"ס 150/2026'
 *     sourceHref="/reports/cbs_150_2026_prices.pdf"
 *     period="פבר-מרץ 2026"
 *     updated="15.5.26"
 *   />
 *   →   📎 למ"ס 150/2026 • פבר-מרץ 2026 • עודכן 15.5.26
 */
export interface NumberCaptionProps {
  /** Where the number came from. e.g., 'למ"ס 150/2026', 'nadlan.gov.il', 'מאגר פנימי'. */
  source: string;
  /** Optional link to the source (PDF, page, or external site). */
  sourceHref?: string;
  /** Period covered. e.g., 'פבר-מרץ 2026', 'שנת 2025', 'Q4 2025'. */
  period: string;
  /** Optional last-updated date. Free-form Hebrew date string. */
  updated?: string;
  /** Optional methodology hint to render after period. e.g., 'דו-חודשי, ארעי'. */
  method?: string;
  /** Visual size — defaults to "xs". "xxs" is tighter for dense lists. */
  size?: "xxs" | "xs";
  /** Optional alignment override; defaults to natural (RTL right). */
  align?: "right" | "center" | "start";
  /** When true, render the source as a plain span (not an <a>). Use this
   * whenever the caption is INSIDE a parent <Link> / <a>, since nested links
   * are illegal HTML and produce hydration errors. */
  insideLink?: boolean;
}

export default function NumberCaption({
  source,
  sourceHref,
  period,
  updated,
  method,
  size = "xs",
  align,
  insideLink,
}: NumberCaptionProps) {
  const textSize = size === "xxs" ? "text-2xs" : "text-2xs";
  const alignCls = align === "center" ? "justify-center" : align === "start" ? "justify-start" : "";

  // withBasePath is applied at the render point rather than at each literal:
  // every caller passes a public/ path such as "/reports/…pdf", and wrapping
  // here means a new caller cannot forget it.
  const sourceNode = sourceHref && !insideLink ? (
    <a
      href={withBasePath(sourceHref)}
      target="_blank"
      rel="noopener noreferrer"
      className="text-cyan-700 hover:underline font-semibold"
    >
      {source}
    </a>
  ) : (
    <span className={`font-semibold ${insideLink ? "text-cyan-700 group-hover:underline" : "text-slate-600"}`}>
      {source}
    </span>
  );

  return (
    <div className={`flex flex-wrap items-center gap-x-1.5 gap-y-0 mt-1 ${textSize} text-slate-500 ${alignCls}`}>
      <span className="opacity-60" aria-hidden><Icon name="attachment" size="1em" /></span>
      {sourceNode}
      <span className="text-slate-400">•</span>
      <span>{period}</span>
      {method && (
        <>
          <span className="text-slate-400">•</span>
          <span className="italic">{method}</span>
        </>
      )}
      {updated && (
        <>
          <span className="text-slate-400">•</span>
          <span>עודכן {updated}</span>
        </>
      )}
    </div>
  );
}

/**
 * Re-export friendly preset components for common KPIs. Keeps the source
 * citations canonical so they don't drift across the codebase.
 */

interface PresetProps { updated?: string; insideLink?: boolean }

export function CbsPricesCaption({ updated, insideLink }: PresetProps = {}) {
  return (
    <NumberCaption
      source='למ"ס 150/2026'
      sourceHref="/reports/cbs_150_2026_prices.pdf"
      period="פבר-מרץ 2026"
      method="דו-חודשי, ארעי"
      updated={updated ?? "15.5.26"}
      insideLink={insideLink}
    />
  );
}

export function CbsConstructionCaption({ updated, insideLink }: PresetProps = {}) {
  return (
    <NumberCaption
      source='למ"ס 089/2026'
      sourceHref="/reports/cbs_089_2026_construction.pdf"
      period="שנת 2025"
      method="קלנדרית מלאה"
      updated={updated ?? "19.3.26"}
      insideLink={insideLink}
    />
  );
}

export function CbsTransactionsCaption({ updated, insideLink }: PresetProps = {}) {
  return (
    <NumberCaption
      source='למ"ס 047/2026'
      sourceHref="/reports/cbs_047_2026_transactions.pdf"
      period="שנת 2025"
      method="חדשות + יד שנייה"
      updated={updated ?? "12.2.26"}
      insideLink={insideLink}
    />
  );
}

export function NadlanCaption({ period, insideLink }: { period: string; insideLink?: boolean }) {
  return (
    <NumberCaption
      source="nadlan.gov.il / Govmap"
      sourceHref="https://www.nadlan.gov.il"
      period={period}
      method="רשות המסים"
      insideLink={insideLink}
    />
  );
}
