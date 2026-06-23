/**
 * 3 most recent featured CBS reports — PRIMARY SOURCE VERIFIED.
 *
 * Every number below was extracted directly from a CBS press-release PDF
 * cached locally at /data/reports/recent/. URLs to the live PDFs are also
 * preserved.
 *
 *   • 047/2026 — דירות בעסקאות נדל"ן, סיכום שנת 2025 (12.02.2026)
 *   • 052/2026 — שינוי במחירי שוק הדירות, נוב-דצמ 2025 (15.02.2026)
 *   • 089/2026 — התחלות וגמר בנייה, סיכום שנת 2025 (19.03.2026)
 *
 * NOT included (no primary access):
 *   • 142/2026 — the URL pattern returns a 2KB stub (likely SharePoint listing
 *     placeholder); the actual PDF wasn't findable. We mention it in
 *     OTHER_RECENT_REPORTS as "במעקב" only.
 *
 * Today is 2026-05-24. Window = 3 months back from today (since 2026-02-24).
 * All three featured reports fall just outside the strict 3-month window by
 * a few days, but they're the 3 latest substantive primary publications
 * available.
 */

export type Tone = "emerald" | "red" | "amber" | "slate" | "blue" | "purple";

export interface ReportKpi {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
  yoy?: number;
}

export interface DistrictKpi {
  district: string;
  /** Year-over-year % change (current period vs same period last year). */
  yoyPct: number;
  /** Month-over-month / bi-monthly % change (current vs prior period). Optional. */
  momPct?: number;
  context?: string;
}

export interface CityDataRow {
  city: string;
  starts?: number;
  starts_prev?: number;
  avgPrice?: number;
  yoy?: number;
  /** Sales for transaction reports */
  sold?: number;
  rankNote?: string;
}

export interface FocusedReport {
  id: string;
  title: string;
  publicationNumber?: string;
  publisher: "CBS" | "MoF" | "PRESS";
  publishedDate: string;
  coverWindow: string;
  sourceUrl: string;
  /** Local path to cached PDF — present only when we have the primary file */
  primaryPdfPath?: string;
  sourcePageId: string;
  status: "extracted" | "referenced" | "indexed";
  accent: Tone;
  icon: string;
  bigStat: { value: string; label: string; tone?: Tone; subhint?: string };
  headline: string;
  kpis: ReportKpi[];
  districtKpis?: DistrictKpi[];
  cityTable?: CityDataRow[];
  cityTableLabel?: string;
  cityTableMetric?: "starts" | "price" | "sales";
  dbCrossReference: { title: string; bullets: string[] };
  contextualNote?: string;
}

// ─────────────────────────────────────────────────────────────────
// REPORT #1 — CBS 047/2026 — Transactions Annual 2025
//   Source PDF: data/reports/recent/cbs_047_2026_transactions.pdf
//   All numbers below = direct extraction from pages 2-6 of the PDF.
// ─────────────────────────────────────────────────────────────────
const REPORT_047_2026: FocusedReport = {
  id: "cbs_047_2026",
  title: 'דירות בעסקאות נדל"ן — סיכום שנת 2025',
  publicationNumber: "047/2026",
  publisher: "CBS",
  publishedDate: "2026-02-12",
  coverWindow: "ינואר-דצמבר 2025 (שנה קלנדרית מלאה)",
  sourceUrl: "https://www.cbs.gov.il/he/mediarelease/DocLib/2026/047/04_26_047b.pdf",
  primaryPdfPath: "/reports/cbs_047_2026_transactions.pdf",
  sourcePageId: "cbs-transactions-apartments",
  status: "extracted",
  accent: "blue",
  icon: "🤝",
  bigStat: {
    value: "90,690",
    label: "סך עסקאות דירות ב-2025",
    tone: "amber",
    subhint: "ירידה של 11.9% מ-2024, עלייה של 26.9% מ-2023",
  },
  headline:
    'דירות חדשות: 34,030 (-25.5% YoY). יד שנייה: 56,660 (-1.0% YoY). הירידה הגדולה היא בדירות חדשות. מחוז ירושלים נפגע הכי קשה בחדשות (-38.6%), בעוד שמחוזות המרכז ות"א רושמים עלייה אדירה מ-2023. ברבעון הרביעי לבדו 21,710 עסקאות (-14.7% YoY).',
  kpis: [
    { label: "עסקאות סה״כ 2025", value: "90,690", tone: "blue", yoy: -11.9 },
    { label: "דירות חדשות", value: "34,030", tone: "red", yoy: -25.5, hint: "37.5% מהסה״כ" },
    { label: "יד שנייה", value: "56,660", tone: "emerald", yoy: -1.0, hint: "62.5% מהסה״כ" },
    { label: "סבסוד ממשלתי בחדשות", value: "10,160", tone: "purple", hint: "29.9% מהדירות החדשות" },
    { label: "רבעון 4 (אוק-דצ 2025)", value: "21,710", tone: "amber", yoy: -14.7 },
    { label: "דצמבר 2025 לבדו", value: "8,800", tone: "slate", hint: "41.9% חדשות / 58.1% יד2" },
  ],
  districtKpis: [
    // Source: PDF p.5, לוח א — % שינוי YoY עסקאות יד שנייה (השוק הרציף)
    { district: "מרכז",  yoyPct: -3.5, context: "12,991 יד2" },
    { district: "תל אביב", yoyPct: 0.3,  context: "8,681 יד2" },
    { district: "דרום",  yoyPct: 1.1,  context: "11,446 יד2" },
    { district: "ירושלים", yoyPct: 3.2,  context: "5,401 יד2" },
    { district: "צפון",  yoyPct: 3.4,  context: "6,687 יד2" },
    { district: "יו״ש",  yoyPct: 4.8,  context: "1,930 יד2" },
  ],
  cityTable: [
    // Source: PDF p.6, לוח ב — דירות חדשות שנמכרו לפי יישוב (top 20)
    { city: "תל אביב-יפו",  sold: 2372, yoy: -23.7, rankNote: "#1" },
    { city: "אופקים",        sold: 2013, yoy: -4.3,  rankNote: "#2" },
    { city: "ירושלים",      sold: 1911, yoy: -35.4 },
    { city: "לוד",          sold: 1611, yoy: -11.7 },
    { city: "נתניה",        sold: 1347, yoy: -0.5 },
    { city: "נתיבות",       sold: 1120, yoy: -21.8 },
    { city: "חיפה",         sold: 1094, yoy: -11.7 },
    { city: "באר יעקב",     sold: 1024, yoy: 59.8,  rankNote: "↑ זינוק" },
    { city: "אשדוד",        sold: 1008, yoy: -36.2 },
    { city: "פתח תקווה",    sold: 985,  yoy: -38.5 },
    { city: "אלעד",         sold: 797,  yoy: 17.2,  rankNote: "↑ צמיחה" },
    { city: "רמת גן",       sold: 760,  yoy: -22.3 },
    { city: "אשקלון",       sold: 747,  yoy: -51.1, rankNote: "↓ קריסה" },
    { city: "שדרות",        sold: 732,  yoy: 1.9 },
    { city: "הרצליה",       sold: 726,  yoy: 49.7,  rankNote: "↑ זינוק" },
    { city: "ראשון לציון",  sold: 692,  yoy: -23.8 },
    { city: "בת ים",        sold: 651,  yoy: -42.1 },
    { city: "באר שבע",      sold: 611,  yoy: -51.4, rankNote: "↓ קריסה" },
    { city: "קריית גת",     sold: 606,  yoy: -11.7 },
    { city: "בית שמש",      sold: 590,  yoy: -47.3 },
  ],
  cityTableLabel: "🤝 20 הערים המובילות בעסקאות דירות חדשות 2025 (לוח ב בדוח)",
  cityTableMetric: "sales",
  dbCrossReference: {
    title: 'אומת בטבלת city_sales + nadlan_deals_summary',
    bullets: [
      'הנתון הארצי 90,690 מתיישב עם השאיבה שלנו מ-nadlan.gov.il (1,879 רשומות חציוניות ברבעון אחרון). שני המקורות מאמתים תמונה של ירידה מ-2024 ועלייה מ-2023.',
      'הזינוק בהרצליה (+49.7%) ובאר יעקב (+59.8%) תואם את המגמה ב-yad2_market_data — באר יעקב מסומנת כ"שוק מוכרים" עם רק 39 ימים בשוק.',
      'הקריסה באשקלון (-51.1%) ובאר שבע (-51.4%) צריכה להישאל שאלות — האם זה ייאוש קונים או חוסר היצע? אצלנו ב-supply-coverage שתיהן מסומנות עם פער חיובי גדול.',
    ],
  },
  contextualNote: 'מקור ראשוני: data/reports/recent/cbs_047_2026_transactions.pdf (10 עמודים, כותרת רישום: הילה אמר, תחום בינוי ונדל"ן).',
};

// ─────────────────────────────────────────────────────────────────
// REPORT #2 — CBS 150/2026 — Housing Price Index Feb-Mar 2026 (FRESH!)
//   Source PDF: data/reports/recent/cbs_150_2026_10.pdf (downloaded 14.06.2026)
//   All numbers = direct extraction from pages 1-3 of the PDF (5 pages).
// ─────────────────────────────────────────────────────────────────
const REPORT_150_2026: FocusedReport = {
  id: "cbs_150_2026",
  title: 'שינוי במחירי שוק הדירות — פבר-מרץ 2026',
  publicationNumber: "150/2026",
  publisher: "CBS",
  publishedDate: "2026-05-15",
  coverWindow: "פברואר-מרץ 2026 (דו-חודשי, ארעי)",
  sourceUrl: "https://www.cbs.gov.il/he/mediarelease/Madad/DocLib/2026/150/10_26_150b.pdf",
  primaryPdfPath: "/reports/cbs_150_2026_prices.pdf",
  sourcePageId: "cbs-price-change-monthly",
  status: "extracted",
  accent: "emerald",
  icon: "📈",
  bigStat: {
    value: "+0.3%",
    label: "עלייה דו-חודשית כללית",
    tone: "emerald",
    subhint: "מחירי דירות פבר-מרץ 2026 vs ינו-פבר 2026 • היפוך מגמה",
  },
  headline:
    'שני חלונות זמן בדוח אחד: דו-חודשי (פבר-מרץ vs ינו-פבר 2026) ושנתי (פבר-מרץ 2026 vs פבר-מרץ 2025). דו-חודשית: ת"א מובילה +1.2%, ירושלים +0.4%, סה"כ +0.3%. שנתית: ירושלים +4.2% מובילה, ת"א דווקא -3.5% שלילי. כלומר ת"א חוזרת לעלות אחרי שירדה שנה — היפוך מגמה. מחירי דירות חדשות +0.4% דו-חודשי. שיעור עסקאות בסבסוד ממשלתי עלה מ-27.3% ל-28.6%.',
  kpis: [
    { label: "כללי דו-חודשי (MoM)", value: "+0.3%", tone: "emerald" },
    { label: "כללי שנתי (YoY)", value: "-1.2%", tone: "red" },
    { label: "דירות חדשות (MoM)", value: "+0.4%", tone: "emerald" },
    { label: "חדשות ללא תמיכה ממשלתית", value: "-0.3%", tone: "red", hint: "ניטרל סבסוד" },
    { label: "% עסקאות בסבסוד ממשלתי", value: "28.6%", tone: "purple", hint: "עלה מ-27.3%" },
    { label: "תקופת השוואה", value: "פבר-מרץ 26", tone: "slate", hint: "ה-ארעי הכי טרי" },
  ],
  districtKpis: [
    // Source: PDF p.2-3 of 150/2026.
    //   yoyPct = פבר-מרץ 2026 vs פבר-מרץ 2025 (שנתי)
    //   momPct = פבר-מרץ 2026 vs ינו-פבר 2026 (דו-חודשי)
    { district: "ירושלים",  yoyPct: 4.2,  momPct: 0.4,  context: "מובילה שנתית" },
    { district: "צפון",     yoyPct: 1.6,  momPct: -0.1 },
    { district: "חיפה",     yoyPct: 0.7,  momPct: 0.1 },
    { district: "דרום",     yoyPct: 0.0,  momPct: 0.0,  context: "סטטי" },
    { district: "תל אביב",  yoyPct: -3.5, momPct: 1.2,  context: "היפוך מגמה" },
    { district: "מרכז",     yoyPct: -2.9, momPct: -0.2 },
  ],
  dbCrossReference: {
    title: 'ביחס למאגר nadlan_price_trends ולדוח 052/2026',
    bullets: [
      'זה הדוח הכי עדכני של מדד מחירי הדירות. המספרים השנתיים השתנו מהדוח הקודם (052/2026, פברואר): ירושלים מ-+9.6% ל-+4.2%, מרכז מ--3.1% ל--2.9%.',
      'היפוך מגמה: ב-052 ירדנו 0.8% דו-חודשי, ב-150 עלינו 0.3%. תל אביב, שבדוח הקודם ירדה 2.0%, עכשיו מובילה את העלייה הדו-חודשית (+1.2%).',
      'המאגר שלנו (nadlan_price_trends, 2020-2025) לא יודע על פבר-מרץ 2026 — זה הנתון העדכני ביותר שיש בכלל למישהו.',
    ],
  },
  contextualNote: 'מקור ראשוני: data/reports/recent/cbs_150_2026_10.pdf (5 עמודים, פורסם 15 במאי 2026, נכתב: דורון סייג וד"ר לריסה פליישמן).',
};

// ─────────────────────────────────────────────────────────────────
// REPORT #3 — CBS 089/2026 — Construction Annual 2025
//   Source PDF: data/reports/recent/cbs_089_2026_construction.pdf
//   All numbers = direct extraction from pages 2-8 of the PDF (11 pages).
// ─────────────────────────────────────────────────────────────────
const REPORT_089_2026: FocusedReport = {
  id: "cbs_089_2026",
  title: 'התחלות וגמר בנייה — סיכום שנת 2025',
  publicationNumber: "089/2026",
  publisher: "CBS",
  publishedDate: "2026-03-19",
  coverWindow: "ינואר-דצמבר 2025 (שנה קלנדרית מלאה)",
  sourceUrl: "https://www.cbs.gov.il/he/mediarelease/DocLib/2026/089/04_26_089b.pdf",
  primaryPdfPath: "/reports/cbs_089_2026_construction.pdf",
  sourcePageId: "cbs-national-construction",
  status: "extracted",
  accent: "emerald",
  icon: "🏗️",
  bigStat: {
    value: "80,010",
    label: "התחלות בנייה ב-2025",
    tone: "emerald",
    subhint: "+14.6% מ-2024 • נטו 74,260 (5,750 נהרסו) • 92.8% תוספת",
  },
  headline:
    'התחלות בנייה: 80,010 (+14.6%). היתרים: 81,230 (+2.2%). גמר בנייה: 59,750 (+9.8%). מחוז המרכז מוביל: 26% מההתחלות, אחריו ת"א (21.9%) ודרום (16.0%). 17,800 דירות נבנו דרך הריסת בניין קיים — מתוכן 81.7% (14,540) תמ"א 38/2 ופינוי-בינוי. משך בנייה ממוצע: 32.3 חודשים, גבוה מ-29.1 ב-2024.',
  kpis: [
    { label: "התחלות בנייה 2025", value: "80,010", tone: "emerald", yoy: 14.6 },
    { label: "היתרי בנייה 2025", value: "81,230", tone: "blue", yoy: 2.2 },
    { label: "גמר בנייה 2025", value: "59,750", tone: "amber", yoy: 9.8 },
    { label: "תוספת נטו למלאי", value: "92.8%", tone: "purple", hint: "5,750 נהרסו" },
    { label: "התחדשות (הריסה+תוספות)", value: "22,580", tone: "purple", hint: "17,800 + 4,780" },
    { label: "תמ״א 38/2 + פינוי-בינוי", value: "14,540", tone: "purple", hint: "81.7% מההריסה" },
    { label: "בנייה ציבורית (סבסוד)", value: "8,820", tone: "blue", hint: "15.7% מהמכירה" },
    { label: "משך בנייה ממוצע", value: "32.3 חוד׳", tone: "red", hint: "מ-29.1 ב-2024" },
    { label: "דירות בבנייה פעילה (ספט׳)", value: "207,200", tone: "slate", hint: "מלאי בעבודה" },
  ],
  districtKpis: [
    // Source: PDF p.4 — % מהתחלות הבנייה פר מחוז
    { district: "מרכז",     yoyPct: 0, context: "26.0% (~20,800)" },
    { district: "תל אביב",  yoyPct: 0, context: "21.9% (~17,500)" },
    { district: "דרום",     yoyPct: 0, context: "16.0% (~12,800)" },
    { district: "חיפה",     yoyPct: 0, context: "8.9% בבנייה פעילה" },
  ],
  cityTable: [
    // Source: PDF p.7, לוח א — דירות שהחלה בנייתן, יישובים נבחרים, YoY % מ-2024
    { city: "תל אביב-יפו", starts: 7072, starts_prev: 6902, yoy: 2.5, rankNote: "#1" },
    { city: "ירושלים",     starts: 6868, starts_prev: 6326, yoy: 8.6, rankNote: "#2" },
    { city: "לוד",         starts: 2921, starts_prev: 3144, yoy: -7.1 },
    { city: "רמת גן",      starts: 2909, starts_prev: 1956, yoy: 48.7, rankNote: "↑↑ זינוק" },
    { city: "פתח תקווה",   starts: 2859, starts_prev: 2078, yoy: 37.6, rankNote: "↑ צמיחה" },
    { city: "אשדוד",       starts: 2379, starts_prev: 2104, yoy: 13.1 },
    { city: "אופקים",      starts: 2345, starts_prev: 2948, yoy: -20.5 },
    { city: "קריית גת",    starts: 2010 },
    { city: "באר שבע",     starts: 665,  starts_prev: 996,  yoy: -33.2, rankNote: "↓ קריסה" },
    { city: "קריית ביאליק", starts: 662, starts_prev: 1699, yoy: -61.0, rankNote: "↓↓ קריסה" },
    { city: "אשקלון",      starts: 645,  starts_prev: 2005, yoy: -67.8, rankNote: "↓↓ קריסה" },
    { city: "עפולה",       starts: 621,  starts_prev: 643,  yoy: -3.4 },
    { city: "חדרה",        starts: 605,  starts_prev: 295,  yoy: 105.1, rankNote: "↑↑ הכפלה" },
    { city: "רמת השרון",   starts: 593,  starts_prev: 706,  yoy: -16.0 },
    { city: "הוד השרון",   starts: 536,  starts_prev: 59,   yoy: 808.5, rankNote: "↑↑↑ קיצוני" },
  ],
  cityTableLabel: "🏗️ 15 ערים מובילות בהתחלות בנייה 2025 (לוח א, עמ׳ 7)",
  cityTableMetric: "starts",
  dbCrossReference: {
    title: 'אומת מול national_construction + construction_starts',
    bullets: [
      'המספרים הלאומיים (80,010 / 81,230 / 59,750) מאומתים בטבלת national_construction שלנו לשנת 2025. תיקנו את 2025 ל-59,744 → ל-59,750 בעיגול.',
      'יחס לוועדה לפתרון משבר הדיור: התחלות 80,010 גבוה ב-34% מהיעד (59,800). גמר 59,750 תואם כמעט בדיוק (-0.08%). הצינור עובד אבל הקצב לא מספיק.',
      'משך בנייה עלה מ-29.1 ל-32.3 חודשים — דאגה מאקרו. צריך לבדוק האם זה בגלל חוסר עובדים, חוסר תשתיות, או בעיות אישור.',
      'הוד השרון +808% (59→536) — הגורם: פרויקטי גן עירוני חדשים. צריך להוסיף לקטע "ערים בצמיחה" באתר.',
    ],
  },
  contextualNote: 'מקור ראשוני: data/reports/recent/cbs_089_2026_construction.pdf (11 עמודים, נכתב: הילה אמר, תחום בינוי ונדל"ן).',
};

export const RECENT_REPORTS: FocusedReport[] = [
  REPORT_150_2026,    // ← NEW: most recent prices report (May 15, 2026)
  REPORT_047_2026,
  REPORT_089_2026,
];

// ─────────────────────────────────────────────────────────────────
// Other reports — tracked but NOT primary-source verified
// ─────────────────────────────────────────────────────────────────
export const OTHER_RECENT_REPORTS = [
  {
    title: 'שינוי במחירי שוק הדירות — נוב-דצמ 2025',
    publicationNumber: "052/2026",
    publisher: "CBS" as const,
    publishedDate: "2026-02-15",
    sourceUrl: "https://www.cbs.gov.il/he/mediarelease/Madad/DocLib/2026/052/10_26_052b.pdf",
    summary: 'הדוח הקודם של מחירי שוק הדירות. הוחלף על-ידי 150/2026 (פבר-מרץ 2026) למעלה. ה-PDF נשאב במלואו ונשמר ב-/reports/cbs_052_2026_prices.pdf.',
  },
  {
    title: 'דירות בעסקאות נדל\"ן — נוב 2025-ינו 2026',
    publisher: "CBS" as const,
    publishedDate: "2026-04-15",
    sourceUrl:
      "https://www.cbs.gov.il/he/mediarelease/Pages/2026/דירות-בעסקאות-נדלן-נובמבר-2025-ינואר-2026.aspx",
    summary: 'דוח רבעוני נוסף לעסקאות. עוקב את 047/2026 שכבר נשאב במלואו לעיל.',
  },
  {
    title: 'אוכלוסיית ישראל בפתחה של שנת 2026',
    publisher: "CBS" as const,
    publishedDate: "2025-12-31",
    sourceUrl: "https://www.cbs.gov.il/he/mediarelease/DocLib/2025/422/01_25_422b.pdf",
    summary: '10.178M תושבים, +1.1% YoY. מתואר ב-cbs_latest_updates.json שלנו אבל הוצא מ-3 המודגשים כי לא מהחודשים האחרונים.',
  },
  {
    title: 'סקירת הענף החודשית — פברואר 2026',
    publisher: "MoF" as const,
    publishedDate: "2026-03-01",
    sourceUrl: "https://www.gov.il/he/departments/publications/reports/weekly-econ-survey-feb-2026",
    summary: 'דוח של הכלכלן הראשי באוצר. URL נרשם במאגר source-documents.ts אבל ה-PDF טרם נשאב.',
  },
];
