/**
 * Titles and framing for the national stat pages — one definition, shared.
 *
 * Moved out of app/stats/[metric]/page.tsx so the admin usage dashboard can
 * label a row with the same words the page itself shows. A dashboard that
 * displays a title the site stopped using is worse than one showing the raw
 * slug: a slug is obviously a slug, and a stale title looks correct.
 *
 * Nothing here interpolates a live value, which is why the whole config could
 * move as a const — unlike the ranking subtitles, which build from refYear()
 * and must be evaluated per render (see lib/rankingMeta.ts).
 */

export type Metric =
  | "national-construction"
  | "avg-price-per-sqm"
  | "total-population"
  | "apartments-needed"
  | "construction-cost-index"
  | "national-hpi";

export const METRIC_CONFIG: Record<
  Metric,
  {
    title: string;
    subtitle: string;
    icon: string;
    accent: "cyan" | "emerald" | "amber" | "purple";
    source: string;
  }
> = {
  "national-construction": {
    title: "בנייה למגורים בישראל — היסטוריה ארצית",
    subtitle: "היתרי בנייה, התחלות בנייה וגמרי בנייה — לאורך השנים",
    icon: "construction",
    accent: "emerald",
    source: 'הלשכה המרכזית לסטטיסטיקה (למ"ס)',
  },
  "avg-price-per-sqm": {
    title: "מחיר ממוצע למ\"ר — לאורך השנים",
    subtitle: "מחיר ממוצע למטר רבוע בכל הערים במאגר",
    icon: "money",
    accent: "cyan",
    source: "nadlan.gov.il + מחקר פנימי",
  },
  "total-population": {
    title: "אוכלוסיית הערים — לאורך השנים",
    subtitle: "סך האוכלוסייה בכל 168 הערים במאגר",
    icon: "users",
    accent: "purple",
    source: 'הלשכה המרכזית לסטטיסטיקה (למ"ס)',
  },
  "apartments-needed": {
    title: "דירות נדרשות — חישוב לפי שנה",
    subtitle: "מספר הדירות הנדרשות לפי גידול אוכלוסייה מחולק בנפשות לדירה",
    icon: "building",
    accent: "amber",
    source: 'חישוב מקומי על בסיס נתוני למ"ס',
  },
  "construction-cost-index": {
    title: 'מדד מחירי תשומה בבנייה למגורים',
    subtitle: "עלויות בנייה (חומרי גלם, עבודה, ציוד) — 10 שנים אחורה",
    icon: "bricks",
    accent: "amber",
    source: 'הלשכה המרכזית לסטטיסטיקה (למ"ס)',
  },
  "national-hpi": {
    title: 'מדד מחירי דירות — לאומי',
    subtitle: 'שינויים שנתיים וחודשיים במחירי דירות — נתוני למ"ס',
    icon: "trend-up",
    accent: "cyan",
    source: 'הלשכה המרכזית לסטטיסטיקה (למ"ס)',
  },
};
