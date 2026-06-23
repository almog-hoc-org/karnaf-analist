/**
 * Findings & targets extracted from:
 *   "התוכנית האסטרטגית לדיור 2017-2040 — מעקב יוני 2021"
 *   (National Economic Council — אגף תכנון אסטרטגי)
 *   ↳ /data/reports/התכנית האסטרגטית לדיור - עדכון יוני 2021.pdf
 *
 * Numbers are quoted directly from the report (page numbers cited inline).
 * Used by the /national dashboard to visualize plan-vs-reality.
 */

export interface DistrictTarget {
  district: string;
  // Annual building targets for the period, in '000 units
  jewish_2021_2025: number | null;
  non_jewish_2021_2025: number | null;
  jewish_2026_2030: number | null;
  non_jewish_2026_2030: number | null;
}

// Table 6 (page 21) — annual completion targets, '000 units
export const DISTRICT_TARGETS_2021_2030: DistrictTarget[] = [
  { district: "ירושלים",  jewish_2021_2025: 4.3,  non_jewish_2021_2025: 3.1,  jewish_2026_2030: 4.8,  non_jewish_2026_2030: 3.3 },
  { district: "צפון",     jewish_2021_2025: 4.9,  non_jewish_2021_2025: 5.3,  jewish_2026_2030: 5.5,  non_jewish_2026_2030: 5.4 },
  { district: "חיפה",     jewish_2021_2025: 4.3,  non_jewish_2021_2025: 1.8,  jewish_2026_2030: 4.8,  non_jewish_2026_2030: 1.8 },
  { district: "מרכז",     jewish_2021_2025: 14.0, non_jewish_2021_2025: 0.8,  jewish_2026_2030: 13.9, non_jewish_2026_2030: 0.9 },
  { district: "תל אביב",  jewish_2021_2025: 7.9,  non_jewish_2021_2025: null, jewish_2026_2030: 9.0,  non_jewish_2026_2030: null },
  { district: "אשקלון",   jewish_2021_2025: 4.4,  non_jewish_2021_2025: null, jewish_2026_2030: 5.3,  non_jewish_2026_2030: null },
  { district: "באר שבע",  jewish_2021_2025: 3.6,  non_jewish_2021_2025: 2.4,  jewish_2026_2030: 4.9,  non_jewish_2026_2030: 2.7 },
  { district: "יו\"ש",    jewish_2021_2025: 3.0,  non_jewish_2021_2025: null, jewish_2026_2030: 3.5,  non_jewish_2026_2030: null },
];

// Totals (page 21)
export const NATIONAL_TARGETS = {
  total_jewish_annual_2021_2025: 46.4,
  total_non_jewish_annual_2021_2025: 13.4,
  total_jewish_annual_2026_2030: 51.7,
  total_non_jewish_annual_2026_2030: 14.1,
  total_annual_2021_2025: 59.8,
  total_annual_2026_2030: 65.8,
} as const;

// Table 5 (page 20) — accumulated 2006-2022 shortfall in non-Jewish localities
export const NON_JEWISH_SHORTFALL_2006_2022 = [
  { district: "ירושלים", completions_k: 9,  demand_k: 39, gap_k: -30, pct: -77 },
  { district: "צפון",    completions_k: 63, demand_k: 82, gap_k: -19, pct: -23 },
  { district: "חיפה",    completions_k: 11, demand_k: 27, gap_k: -16, pct: -60 },
  { district: "מרכז",    completions_k: 7,  demand_k: 15, gap_k: -8,  pct: -50 },
  { district: "דרום",    completions_k: 8,  demand_k: 34, gap_k: -26, pct: -76 },
] as const;

// Headline narratives — quoted from pages 7-8
export const HEADLINE_FINDINGS = [
  {
    title: "פער של 4,000 יח\"ד בשנה",
    text: "הביקוש הארצי לדיור בשנים 2016-2019 היה גבוה בכ-4,000 יחידות בשנה מהיעדים שנקבעו בתוכנית האסטרטגית. הסיבה: קצב גידול האוכלוסייה היה גבוה מהתחזית.",
    severity: "amber" as const,
    page: 7,
  },
  {
    title: "מצטבר של 90,000 יח\"ד חוסר (2006-2015)",
    text: "ביישובים יהודיים ומעורבים הצטבר מחסור ארצי של כ-90 אלף יחידות דיור בשנים 2006-2015. מעל מחצית הפער במחוזות תל אביב ומרכז.",
    severity: "red" as const,
    page: 13,
  },
  {
    title: "50% מחסור בחברה הלא יהודית",
    text: "בשנים 2006-2022 הגיעו סיומי הבנייה ביישובי החברה הלא יהודית רק ל-98 אלף יח\"ד מתוך 197 אלף שנדרשו — פער של 99 אלף (-50%).",
    severity: "red" as const,
    page: 20,
  },
  {
    title: "המלצה: יישוב חרדי קרוב למרכז",
    text: "80% מהאוכלוסייה החרדית מתגוררת במרכז הארץ, בעוד שרוב המענים המוצעים מתמקדים בפריפריה. הוועדה ממליצה על הקמת יישוב חרדי קרוב למרכז.",
    severity: "amber" as const,
    page: 22,
  },
  {
    title: "התחדשות עירונית: 30% מהבנייה במרכז",
    text: "בשנים 2015-2019 נבנו כ-37,000 יח\"ד בהתחדשות עירונית. במחוזות ת\"א ומרכז היוותה ההתחדשות 30% מכלל הבנייה. 75% מההתחדשות הייתה תמ\"א 38 — שעומדת להתבטל.",
    severity: "amber" as const,
    page: 7,
  },
  {
    title: "פיתוח כלכלי-אזורי בחיפה ובאר שבע",
    text: "הוועדה ממליצה על קידום מטרופולינים חיפה ובאר שבע כמענה לגידול אוכלוסייה — הרחבת תעסוקה איכותית (היי-טק), שירותי בריאות וחינוך.",
    severity: "emerald" as const,
    page: 8,
  },
] as const;

// 2021-2030 annual demand forecast (Table 6 totals)
export const ANNUAL_DEMAND_FORECAST = {
  "2021-2025": 59800,
  "2026-2030": 65800,
} as const;
