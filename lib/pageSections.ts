/**
 * The catalogue of re-orderable page sections.
 *
 * This is the vocabulary shared by three places: the admin screen that lists
 * them, the storage that remembers a chosen order, and the pages that render
 * them. Same shape and same purpose as RULE_DEFS in lib/systemRules.ts — the
 * catalogue is the source of both the labels and the DEFAULT order, so a page
 * whose order was never edited renders exactly as it is written in the JSX.
 *
 * The keys are not new: on the city page they are the `data-track-section`
 * slugs that already mark each section for the visibility analytics. One
 * vocabulary, so "which sections get read" and "in which order they appear"
 * can be read against each other.
 *
 * ADDING A SECTION: add it here in the position it should default to, and
 * register the node in the page's <OrderedSections>. A key that is in the
 * catalogue but missing from a stored order is appended, never dropped — see
 * lib/sectionOrder.ts.
 */

export type PageKey = "home" | "city";

export interface SectionDef {
  key: string;
  label: string;
  /** what a non-technical operator needs in order to recognise it on the page */
  hint?: string;
}

export const PAGE_LABELS: Record<PageKey, string> = {
  home: "עמוד הבית",
  city: "עמוד עיר",
};

export const PAGE_SECTIONS: Record<PageKey, SectionDef[]> = {
  home: [
    // hero-kpis leads on a WIDE screen only — the cards are hidden below sm:,
    // where the same three figures are a strip inside the header. So on a phone
    // the first orderable block a reader meets is price-gains, which is what
    // the operator asked for, without moving the desktop layout.
    { key: "hero-kpis", label: "שלושת הנתונים הגדולים", hint: "סה״כ עסקאות · 12 חודשים · שינוי ארצי (במחשב בלבד)" },
    { key: "price-gains", label: "שינויי מחיר — לבחירתך", hint: "טבלת הערים שעלו/ירדו, עם בורר טווח" },
    { key: "unsold-inventory", label: "מלאי דירות לא מכורות", hint: "חמש הערים עם המלאי הגדול ביותר" },
    { key: "rankings", label: "דירוגים מובילים", hint: "היקרות ביותר, התחלות בנייה" },
    { key: "market-insights", label: "תובנות שוק אוטומטיות" },
    { key: "cbs-sales", label: "מכירות ארציות — חדשות מול יד-2" },
    { key: "recent-reports", label: "דוחות עדכניים מהלמ״ס" },
  ],
  // The city page's keys are its existing `data-track-section` slugs wherever
  // it had one; the blocks that never carried a slug got one here, because a
  // block with no key cannot be given a position. Order below = the order the
  // page renders in when nothing was saved, which is the order it is written
  // in the JSX.
  city: [
    { key: "market-prices", label: "מחירים", hint: "מחיר חציוני לדירה, חלון 3/5 שנים" },
    { key: "market-live", label: "מצב שוק חי", hint: "מדדי לוחות" },
    { key: "chart-studio", label: "מגמות מחירים", hint: "שלושת הגרפים, הפילוחים והעסקאות" },
    { key: "neighborhoods", label: "שכונות — מפה וטבלה", hint: "מפת השכונות לצד טבלת המחירים" },
    { key: "price-summary", label: "מחירים לפי גודל דירה" },
    { key: "back-to-city", label: "שמירה, השוואה ושיתוף" },
    { key: "new-vs-secondhand", label: "חדשות מול יד-שנייה" },
    { key: "population-sources", label: "אוכלוסייה לפי מקור" },
    { key: "population", label: "מגמת אוכלוסייה" },
    { key: "median-prices", label: "מגמת מחירים חציוניים" },
    { key: "scattered-facts", label: "עובדות מדוחות הלמ״ס" },
    { key: "street-comparison", label: "השוואת מחירים ברחוב" },
    { key: "new-sales", label: "מכירות דירות חדשות" },
    { key: "permits", label: "היתרי בנייה לפי שנה" },
    { key: "correlation", label: "מתאמים" },
    { key: "inventory", label: "מלאי לא מכור" },
    { key: "dwelling-stock", label: "מלאי הדירות בעיר", hint: "יישובים מעל 50 אלף" },
    { key: "urban-renewal", label: "התחדשות עירונית" },
    { key: "insights", label: "תובנות" },
    { key: "supply-demand", label: "היצע מול ביקוש" },
    { key: "demography", label: "דמוגרפיה" },
    { key: "all-data", label: "כל הנתונים" },
  ],
};

export const PAGE_KEYS = Object.keys(PAGE_SECTIONS) as PageKey[];

export function isPageKey(v: string): v is PageKey {
  return v in PAGE_SECTIONS;
}

/** The catalogue order — what a page renders when nothing was ever saved. */
export function defaultOrder(page: PageKey): string[] {
  return PAGE_SECTIONS[page].map((s) => s.key);
}

/**
 * Reconcile a stored order against the catalogue.
 *
 * Two things this must never do, both of which a naive "just use the stored
 * list" would do:
 *   - drop a section that was ADDED to the catalogue after the order was saved
 *     (it would silently vanish from the live page),
 *   - keep a key that was REMOVED from the catalogue (it renders nothing and
 *     the operator sees a phantom row).
 * Known keys keep their saved position; new ones are appended in catalogue
 * order; unknown ones are dropped.
 */
export function reconcile(page: PageKey, stored: string[]): string[] {
  const known = new Set(defaultOrder(page));
  const kept = stored.filter((k) => known.has(k));
  const seen = new Set(kept);
  return [...kept, ...defaultOrder(page).filter((k) => !seen.has(k))];
}
