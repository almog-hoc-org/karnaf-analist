import { RANKING_TITLES, type RankingType } from "./rankingMeta";
import { METRIC_CONFIG, type Metric } from "./statMeta";

/**
 * What IS this page? — turning a logged path into something a human can act on.
 *
 * THE PROBLEM THIS SOLVES
 * The usage dashboard was reporting rows like `/`, `/rankings/highest-gain`
 * and `/city/%D7%97%D7%99%D7%A4%D7%94`. Every one of those is answerable only
 * by someone who already knows the routing table — which means the person the
 * dashboard exists for could not read it. "Where do people leave?" is not a
 * question about paths.
 *
 * WHY A MAP AND NOT THE PAGES' OWN metadata
 * Next's `metadata` export is a build-time module property. There is no
 * runtime lookup from a path string to the metadata of the route that would
 * serve it, and fetching each page to read its <title> would turn a dashboard
 * render into dozens of HTTP requests. So the fixed routes are listed here,
 * and the dynamic ones resolve through the SAME dictionaries the pages
 * themselves render from (lib/rankingMeta, lib/statMeta) — a title can drift
 * out of sync only if someone deliberately edits one of those and not the
 * page, which is now impossible because the page reads it too.
 *
 * UNKNOWN PATHS FALL BACK TO THEMSELVES. A guessed label is worse than a raw
 * path: the path is visibly a path, and a wrong-but-plausible name sends the
 * reader to the wrong conclusion with confidence.
 */

export interface PageLabel {
  /** human name, e.g. "עמוד עיר — חיפה" */
  label: string;
  /** the path itself, for the link and for the small grey line under the name */
  href: string;
  /** coarse grouping, so the dashboard can aggregate "all city pages" */
  kind: "home" | "city" | "ranking" | "stat" | "source" | "report" | "tool" | "legal" | "other";
}

/** Fixed routes. Keys are exact paths. */
const STATIC_LABELS: Record<string, { label: string; kind: PageLabel["kind"] }> = {
  "/": { label: "עמוד הבית", kind: "home" },
  "/cities": { label: "טבלת כל הערים", kind: "tool" },
  "/compare": { label: "השוואת ערים", kind: "tool" },
  "/check": { label: "בדיקת מחיר דירה ספציפית", kind: "tool" },
  "/calculators": { label: "מחשבונים", kind: "tool" },
  "/national": { label: "דשבורד לאומי", kind: "stat" },
  "/rankings": { label: "כל הדירוגים", kind: "ranking" },
  "/sources": { label: "מקורות הנתונים", kind: "source" },
  "/reports": { label: "פרסומים ודוחות", kind: "report" },
  "/stats": { label: "מדדים ארציים", kind: "stat" },
  "/methodology": { label: "מתודולוגיה — איך המספרים מחושבים", kind: "legal" },
  "/account": { label: "החשבון שלי", kind: "tool" },
  "/privacy": { label: "מדיניות פרטיות", kind: "legal" },
  "/terms": { label: "תנאי שימוש", kind: "legal" },
  "/accessibility": { label: "הצהרת נגישות", kind: "legal" },
  "/stats/yad2-market-data": { label: "מצב שוק חי — לפי עיר", kind: "stat" },
  "/stats/supply-coverage": { label: "כיסוי נתוני היצע ופער ביקוש", kind: "stat" },
};

/** A URL segment as a person wrote it — "%D7%97%D7%99%D7%A4%D7%94" is not a name. */
function decodeSegment(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg; // a malformed escape is still better shown than thrown
  }
}

/** Turn a slug into something readable when there is no dictionary entry. */
function humanizeSlug(seg: string): string {
  return decodeSegment(seg).replace(/[-_]/g, " ").trim();
}

export function labelForPath(rawPath: string): PageLabel {
  const path = (rawPath || "").split("?")[0].replace(/\/+$/, "") || "/";

  const fixed = STATIC_LABELS[path];
  if (fixed) return { label: fixed.label, href: path, kind: fixed.kind };

  const seg = path.split("/").filter(Boolean);

  if (seg[0] === "city" && seg[1]) {
    return { label: `עמוד עיר — ${decodeSegment(seg[1])}`, href: path, kind: "city" };
  }
  if (seg[0] === "rankings" && seg[1]) {
    const title = RANKING_TITLES[decodeSegment(seg[1]) as RankingType];
    return { label: title ? `דירוג — ${title}` : `דירוג — ${humanizeSlug(seg[1])}`, href: path, kind: "ranking" };
  }
  if (seg[0] === "stats" && seg[1]) {
    const cfg = METRIC_CONFIG[decodeSegment(seg[1]) as Metric];
    return { label: cfg ? cfg.title : `מדד — ${humanizeSlug(seg[1])}`, href: path, kind: "stat" };
  }
  if (seg[0] === "sources" && seg[1]) {
    return { label: `מקור — ${humanizeSlug(seg[1])}`, href: path, kind: "source" };
  }
  if (seg[0] === "reports" && seg[1]) {
    return { label: `פרסום — ${humanizeSlug(seg[1])}`, href: path, kind: "report" };
  }

  // Not a route this file knows. Say so by showing the path, not by inventing.
  return { label: path, href: path, kind: "other" };
}

/**
 * Hebrew names for the tracked sections of a city page.
 *
 * The slugs are written as `data-track-section` attributes in
 * app/city/[slug]/page.tsx. Keeping the names here rather than reading the
 * heading text at runtime means the dashboard groups stably even when a
 * heading is reworded — and a reworded heading is exactly the kind of change
 * that would otherwise split one section into two rows halfway through a month.
 */
export const SECTION_LABELS: Record<string, string> = {
  "price-summary": "מחירים לפי גודל דירה",
  "chart-studio": "סטודיו הגרפים",
  "market-live": "מצב שוק חי",
  "neighborhoods": "מחירים לפי שכונה",
  "deals-table": "פירוט העסקאות",
  "population": "מגמת אוכלוסייה",
  "median-prices": "מגמת מחירים חציוניים",
  "new-sales": "מכירות דירות חדשות",
  "permits": "היתרי בנייה",
  "correlation": "ניתוח קורלציה",
  "inventory": "מלאי ומכירות",
  "insights": "תובנות אנליטיות",
  "supply-demand": "היצע וביקוש",
  "urban-renewal": "התחדשות עירונית",
  "dwelling-stock": "מלאי הדירות בעיר",
  "demography": "דמוגרפיה ודיור",
  "all-data": "כל הנתונים",
  "back-to-city": "חזרה לעיר",
};

export function sectionLabel(slug: string): string {
  return SECTION_LABELS[slug] ?? slug;
}
