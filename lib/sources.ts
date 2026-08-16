/**
 * Structured registry of all data sources used by the system.
 * Each source has:
 *   - identity (id, name, organization)
 *   - access metadata (URL, schedule)
 *   - data linkage (what it feeds in our DB)
 *   - publication schedule for next-expected prediction
 */

export type SourceColor = "cyan" | "emerald" | "amber" | "purple" | "rose";
export type CategoryKey = "cbs" | "tax" | "market" | "press" | "mof" | "internal";

export type PublicationSchedule =
  | { type: "monthly"; dayOfMonth?: number; note?: string }
  | { type: "quarterly"; quartersOffsetDays?: number; note?: string }
  | { type: "annual"; monthOfYear?: number; note?: string }
  | { type: "irregular"; note?: string }
  | { type: "continuous"; note?: string };

export interface Source {
  id: string;                          // slug used in /sources/[id]
  name: string;                        // Hebrew name
  organization: string;                // CBS / MoF / Tax Authority / etc.
  category: CategoryKey;
  description: string;
  url: string;
  monitorUrl?: string;                 // URL to poll for new publications
  usedFor: string;
  feedsTables?: string[];              // DB tables this source feeds
  publicationDate?: string;            // last known publication
  publicationSchedule?: PublicationSchedule;
  language: "he" | "en";
}

export interface Category {
  key: CategoryKey;
  title: string;
  icon: string;
  color: SourceColor;
  description: string;
}

export const CATEGORIES: Category[] = [
  {
    key: "cbs",
    title: 'הלשכה המרכזית לסטטיסטיקה (למ"ס)',
    icon: "📊",
    color: "cyan",
    description: 'המקור הרשמי של מדינת ישראל לנתוני אוכלוסייה, בנייה ומדדי מחירים',
  },
  {
    key: "mof",
    title: 'הכלכלן הראשי – משרד האוצר',
    icon: "🏛️",
    color: "purple",
    description: 'סקירות חודשיות של שוק הדיור והנדל"ן מהכלכלן הראשי באוצר',
  },
  {
    key: "tax",
    title: 'רשות המסים – אגף מקרקעין',
    icon: "🏠",
    color: "emerald",
    description: 'נתוני עסקאות נדל"ן אמיתיות שדווחו לרשות המסים',
  },
  {
    key: "market",
    title: 'מקורות שוק נדל"ן פרטיים',
    icon: "🏘️",
    color: "amber",
    description: 'אתרי שוק לאימות וקבלת נתונים משלימים על עסקאות ומחירי שוק',
  },
  {
    key: "press",
    title: 'דוחות וכתבות פיננסיות',
    icon: "📰",
    color: "rose",
    description: 'מקורות כתבות לאימות נתונים והקשר',
  },
  {
    key: "internal",
    title: 'מקורות פנימיים',
    icon: "📂",
    color: "amber",
    description: 'מחקרים וקבצי נתונים שנאספו פנימית',
  },
];

export const SOURCES: Source[] = [
  // ───── CBS ─────
  {
    id: "cbs-dwellings-2025",
    name: 'יחס אוכלוסייה למספר דירות ביישובים מעל 50 אלף תושבים — 2025',
    organization: 'הלשכה המרכזית לסטטיסטיקה',
    category: "cbs",
    description: 'מספר דירות (2025) מול אוכלוסייה (סוף יוני 2025) ב-40 היישובים הגדולים, והיחס ביניהם. הארצי: 3,015,855 דירות מול 9,862,317 תושבים = 3.27 נפשות לדירה.',
    url: 'https://www.cbs.gov.il/he/publications/Pages/2025/%D7%93%D7%99%D7%A8%D7%95%D7%AA.aspx',
    monitorUrl: 'https://www.cbs.gov.il/he/publications/Pages/2025/%D7%93%D7%99%D7%A8%D7%95%D7%AA.aspx',
    usedFor: 'מלאי הדירות בעיר ונפשות לדירה — כרטיס מלאי הדירות בעמוד העיר, עמודת "נפשות/דירה" בטבלת הערים, וההשוואה הארצית בתובנות',
    feedsTables: ['city.total_apartments', 'city.people_per_apartment', 'city.dwellings_year', 'city.dwellings_population'],
    publicationDate: '2025-06-30',
    publicationSchedule: { type: "irregular", note: "פרסום שנתי של הלמ״ס; מכוסים רק יישובים מעל 50 אלף תושבים" },
    language: "he",
  },
  {
    id: "cbs-census-2022",
    name: 'נתוני אוכלוסייה לפי יישוב — מפקד 2022',
    organization: 'הלשכה המרכזית לסטטיסטיקה',
    category: "cbs",
    description: 'אוכלוסייה לפי יישוב, 1,222 יישובים — נתונים מבסיס המפקד הרשמי',
    url: 'https://data.gov.il/dataset/population/resource/38207cf8-afe2-48ed-a3b0-c8f70c796015',
    monitorUrl: 'https://data.gov.il/dataset/population',
    usedFor: 'אוכלוסיית בסיס 2021-2022 לכל עיר',
    feedsTables: ['city.population_2021', 'city.population_2022', 'population_by_year'],
    publicationDate: '2024-01-01',
    publicationSchedule: { type: "irregular", note: "מפקד אוכלוסין מתבצע אחת לעשור" },
    language: "he",
  },
  {
    id: "cbs-localities-2023",
    name: 'יישובים בישראל — קובץ ארעי 2023',
    organization: 'הלשכה המרכזית לסטטיסטיקה',
    category: "cbs",
    description: 'אוכלוסייה משתנה לפי יישוב, 1,484 יישובים',
    url: 'https://data.gov.il/dataset/locality-files',
    monitorUrl: 'https://data.gov.il/dataset/locality-files',
    usedFor: 'אוכלוסייה 2023 (ארעי) — עודכן אפריל 2025',
    feedsTables: ['city.population_2024', 'population_by_year'],
    publicationDate: '2025-04-15',
    publicationSchedule: { type: "annual", monthOfYear: 4, note: "עדכון שנתי באפריל" },
    language: "he",
  },
  {
    id: "cbs-national-construction",
    name: 'התחלות בנייה ארציות',
    organization: 'הלשכה המרכזית לסטטיסטיקה',
    category: "cbs",
    description: 'נתוני התחלות בנייה, היתרים וגמרי בנייה לפי שנה',
    url: 'https://www.cbs.gov.il/he/subjects/Pages/בנייה.aspx',
    monitorUrl: 'https://www.cbs.gov.il/he/mediarelease/Pages/default.aspx?topic_id=0&Subject=15',
    usedFor: 'טבלת בנייה ארצית 2016-2025',
    feedsTables: ['national_construction'],
    publicationDate: '2026-03-19',
    publicationSchedule: { type: "quarterly", quartersOffsetDays: 90, note: "דוח רבעוני, כ-90 יום אחרי תום הרבעון" },
    language: "he",
  },
  {
    id: "cbs-construction-by-city",
    name: 'התחלות בנייה לפי יישוב — דוח רבעוני',
    organization: 'הלשכה המרכזית לסטטיסטיקה',
    category: "cbs",
    description: 'הודעות לעיתונות עם התחלות בנייה לפי יישוב — ~30 ערים גדולות',
    url: 'https://www.cbs.gov.il/he/mediarelease',
    monitorUrl: 'https://www.cbs.gov.il/he/mediarelease/Pages/default.aspx?topic_id=0&Subject=15',
    usedFor: '243 רשומות בנייה לפי עיר ושנה (2017-2025)',
    feedsTables: ['cbsPressData', 'construction_starts'],
    publicationDate: '2026-03-19',
    publicationSchedule: { type: "quarterly", quartersOffsetDays: 90 },
    language: "he",
  },
  {
    id: "cbs-housing-price-index",
    name: 'מדד מחירי דירות',
    organization: 'הלשכה המרכזית לסטטיסטיקה',
    category: "cbs",
    description: 'מדד שינוי מחירי דירות לפי מחוז ולפי ערים גדולות',
    url: 'https://www.cbs.gov.il/he/subjects/Pages/מדד-מחירי-דירות.aspx',
    monitorUrl: 'https://www.cbs.gov.il/he/mediarelease/Pages/default.aspx?topic_id=0&Subject=16',
    usedFor: 'אימות מגמות מחירים, מדד שינוי שנתי',
    feedsTables: [],
    publicationDate: '2026-02-15',
    publicationSchedule: { type: "monthly", dayOfMonth: 15, note: "פרסום בערך באמצע כל חודש" },
    language: "he",
  },
  {
    id: "cbs-price-change-monthly",
    name: 'שינוי במחירי שוק הדירות',
    organization: 'הלשכה המרכזית לסטטיסטיקה',
    category: "cbs",
    description: 'הודעה חודשית: שינוי באחוזים במחירי דירות חודש-מול-חודש קודם, שנה לאחור, לפי מחוז',
    url: 'https://www.cbs.gov.il/he/Subjects/Pages/שינוי-במחירי-שוק-הדירות.aspx',
    monitorUrl: 'https://www.cbs.gov.il/he/mediarelease/Pages/default.aspx?topic_id=0&Subject=16',
    usedFor: 'מדידת מגמת מחירים חודשית — שינוי % YoY ו-MoM',
    feedsTables: ['scattered_city_facts'],
    publicationDate: '2026-04-15',
    publicationSchedule: { type: "monthly", dayOfMonth: 15, note: 'פרסום ב-15 לחודש (מתפרסם חודשיים אחרי המדידה)' },
    language: "he",
  },
  {
    id: "cbs-transactions-apartments",
    name: 'דירות בעסקאות נדל"ן',
    organization: 'הלשכה המרכזית לסטטיסטיקה',
    category: "cbs",
    description: 'דוח רבעוני: מספר דירות בעסקאות, מחירים ממוצעים לפי מחוז ולפי 18 ערים גדולות',
    url: 'https://www.cbs.gov.il/he/Subjects/Pages/דירות-בעסקאות-נדלן.aspx',
    monitorUrl: 'https://www.cbs.gov.il/he/mediarelease/Pages/default.aspx?topic_id=0&Subject=16',
    usedFor: 'אימות מספרי עסקאות רבעוניים ומחירים ממוצעים',
    feedsTables: ['nadlan_price_trends', 'scattered_city_facts'],
    publicationDate: '2026-03-15',
    publicationSchedule: { type: "quarterly", quartersOffsetDays: 75, note: 'רבעוני, כ-75 יום אחרי תום הרבעון' },
    language: "he",
  },
  {
    id: "cbs-avg-prices-housing",
    name: 'מדד ומחירים ממוצעים משוק הדירות',
    organization: 'הלשכה המרכזית לסטטיסטיקה',
    category: "cbs",
    description: 'דוח רבעוני: מחיר ממוצע לדירה ולפי מספר חדרים, ב-18 ערים גדולות',
    url: 'https://www.cbs.gov.il/he/Subjects/Pages/מדד-מחירי-דירות-ומחירים-ממוצעים-משוק-הדירות.aspx',
    monitorUrl: 'https://www.cbs.gov.il/he/mediarelease/Pages/default.aspx?topic_id=0&Subject=16',
    usedFor: 'מחיר ממוצע לדירה לפי עיר, סגמנטציה לפי גודל דירה',
    feedsTables: ['city.price_per_sqm_2026', 'scattered_city_facts'],
    publicationDate: '2026-02-15',
    publicationSchedule: { type: "quarterly", quartersOffsetDays: 75 },
    language: "he",
  },
  {
    id: "cbs-construction-cost-index",
    name: 'מדד מחירי תשומה בבנייה למגורים',
    organization: 'הלשכה המרכזית לסטטיסטיקה',
    category: "cbs",
    description: 'מדד חודשי של עלויות תשומה בבנייה — חומרי גלם (מלט, פלדה), עבודה, ציוד',
    url: 'https://www.cbs.gov.il/he/Subjects/Pages/מדד-מחירי-תשומה-בבנייה-למגורים.aspx',
    monitorUrl: 'https://www.cbs.gov.il/he/mediarelease/Pages/default.aspx?topic_id=0&Subject=15',
    usedFor: 'הקשר לעלויות בנייה — משפיע על מחירי דירות חדשות',
    feedsTables: ['scattered_city_facts'],
    publicationDate: '2026-04-15',
    publicationSchedule: { type: "monthly", dayOfMonth: 15, note: 'פרסום ב-15 לחודש' },
    language: "he",
  },
  {
    id: "cbs-media-housing",
    name: 'הודעות לעיתונות — שוק הדיור',
    organization: 'הלשכה המרכזית לסטטיסטיקה',
    category: "cbs",
    description: 'דוחות תקופתיים על שוק הדיור והבנייה',
    url: 'https://www.cbs.gov.il/he/mediarelease/Pages/default.aspx?topic_id=0',
    monitorUrl: 'https://www.cbs.gov.il/he/mediarelease/Pages/default.aspx?topic_id=0',
    usedFor: 'אימות נתוני בנייה ארציים',
    feedsTables: ['national_construction', 'cbsPressData'],
    publicationDate: '2026-03-19',
    publicationSchedule: { type: "monthly", note: "מספר הודעות בחודש" },
    language: "he",
  },
  {
    id: "cbs-population-2026",
    name: 'אוכלוסיית ישראל — תחילת 2026',
    organization: 'הלשכה המרכזית לסטטיסטיקה',
    category: "cbs",
    description: 'אומדן אוכלוסייה בסוף 2025 (10.178M)',
    url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2025/אוכלוסיית-ישראל-בערב-ראש-השנה-תשפו.aspx',
    monitorUrl: 'https://www.cbs.gov.il/he/mediarelease/Pages/default.aspx?topic_id=0&Subject=11',
    usedFor: 'תחזית אוכלוסייה ארצית 2026',
    feedsTables: ['city.population_2026'],
    publicationDate: '2025-12-31',
    publicationSchedule: { type: "annual", monthOfYear: 12, note: "פרסום בסוף השנה לקראת השנה החדשה" },
    language: "he",
  },

  // ───── MoF Chief Economist ─────
  {
    id: "mof-housing-review-monthly",
    name: 'סקירת שוק הנדל"ן החודשית — הכלכלן הראשי',
    organization: 'הכלכלן הראשי במשרד האוצר',
    category: "mof",
    description: 'סקירה חודשית של מכירות, השכרה, פעילות קבלנים ומשקיעים בשוק הדיור',
    // OfficeId verified live 2026-07-30 via GetOfficesList (the previous GUID
    // 8baeed5f-… returned 0 results — a root cause of "הרענון לא מוצא כלום").
    // Discovery itself now goes through lib/govil-fetcher.ts (openapi-gc host).
    url: 'https://www.gov.il/he/collectors/publications?OfficeId=f41159c1-7867-41c3-bc0a-cbfe0da1bb1a',
    monitorUrl: 'https://www.gov.il/he/collectors/publications?OfficeId=f41159c1-7867-41c3-bc0a-cbfe0da1bb1a',
    usedFor: 'נתוני מכירות לפי אזור, פעילות משקיעים, רוכשי דירות זרים',
    feedsTables: ['scattered_city_facts'],
    publicationDate: '2026-03-01',
    publicationSchedule: { type: "monthly", dayOfMonth: 1, note: "פרסום בתחילת כל חודש לחודש הקודם" },
    language: "he",
  },
  {
    id: "mof-chief-economist-publications",
    name: 'פרסומי הכלכלן הראשי',
    organization: 'הכלכלן הראשי במשרד האוצר',
    category: "mof",
    description: 'כל הפרסומים של הכלכלן הראשי — סקירות, ניירות עמדה, ניתוחים',
    url: 'https://www.gov.il/he/departments/mof_chief_economist',
    monitorUrl: 'https://www.gov.il/he/departments/mof_chief_economist',
    usedFor: 'מקור משלים לדוחות החודשיים',
    feedsTables: ['scattered_city_facts'],
    publicationDate: '2026-03-01',
    publicationSchedule: { type: "continuous", note: "פרסום שוטף" },
    language: "he",
  },

  // ───── Tax Authority / Nadlan ─────
  {
    id: "nadlan-deals",
    name: 'nadlan.gov.il — מאגר עסקאות נדל"ן',
    organization: 'רשות המסים',
    category: "tax",
    description: 'מאגר עסקאות הדיור הציבורי של ישראל — כל העסקאות שדווחו לרשות המסים',
    url: 'https://www.nadlan.gov.il',
    usedFor: 'מחיר חציוני רבעוני לפי עיר (1,879 רשומות)',
    feedsTables: ['nadlan_price_trends'],
    publicationDate: '2026-04-01',
    publicationSchedule: { type: "continuous", note: "עדכון כמעט בזמן אמת" },
    language: "he",
  },
  {
    id: "govmap-api",
    name: 'govmap.gov.il — API עסקאות',
    organization: 'רשות המסים',
    category: "tax",
    description: 'ממשק GIS לעסקאות, אותו מאגר נתונים כמו nadlan.gov.il',
    url: 'https://www.govmap.gov.il',
    usedFor: 'עסקאות לפי שכונה ורחוב (השוואת מחירים)',
    feedsTables: ['deals_cache (file-based)'],
    publicationDate: '2026-05-17',
    publicationSchedule: { type: "continuous" },
    language: "he",
  },

  // ───── Market ─────
  {
    id: "yad2-data",
    name: 'יד 2 — Yad2 Data',
    organization: 'יד 2',
    category: "market",
    description: 'נתוני מחירים, ימי שיווק וכמות מודעות לפי עיר',
    url: 'https://yadata.yad2.co.il',
    usedFor: 'נתוני שוק משלימים לערים גדולות',
    feedsTables: ['yad2_market_data'],
    publicationDate: '2026-04-01',
    publicationSchedule: { type: "continuous" },
    language: "he",
  },
  // madlan removed from the catalog (operator request, 8/2026): it was listed
  // as a one-off verification aid, is not a feed, and naming a commercial
  // competitor on the sources page implied an ongoing dependency that no
  // longer exists. The historical spot-check it described is documented in git.
  {
    id: "madadirot",
    name: 'מדדי הדירות — Madadirot',
    organization: 'Madadirot',
    category: "market",
    description: 'מאגר מחירי דירות מעודכן לפי עיר',
    url: 'https://www.madadirot.co.il',
    usedFor: 'מחיר למ"ר לערים שלא היו במחקר המקורי (38 ערים)',
    feedsTables: ['city.price_per_sqm_2026'],
    publicationSchedule: { type: "continuous" },
    language: "he",
  },

  // ───── Press ─────
  {
    id: "globes",
    name: 'Globes — גלובס נדל"ן',
    organization: 'Globes',
    category: "press",
    description: 'כתבות וניתוחי שוק נדל"ן',
    url: 'https://www.globes.co.il/news/real_estate.aspx',
    usedFor: 'אימות מחירי שוק, ערים חריגות',
    publicationSchedule: { type: "continuous" },
    language: "he",
  },
  {
    id: "calcalist",
    name: 'Calcalist — כלכליסט',
    organization: 'Calcalist',
    category: "press",
    description: 'כתבות וניתוחים על שוק הדיור',
    url: 'https://www.calcalist.co.il/real-estate',
    usedFor: 'אימות מגמות שוק',
    publicationSchedule: { type: "continuous" },
    language: "he",
  },
  {
    id: "ynet",
    name: 'Ynet — ynet כלכלה',
    organization: 'Ynet',
    category: "press",
    description: 'דיווח שוטף על שוק הנדל"ן',
    url: 'https://www.ynet.co.il/economy',
    usedFor: 'אימות נתונים ועדכוני בנייה',
    publicationSchedule: { type: "continuous" },
    language: "he",
  },
  {
    id: "themarker",
    name: 'TheMarker — דה מרקר נדל"ן',
    organization: 'TheMarker',
    category: "press",
    description: 'כתבות עומק על שוק הדיור',
    url: 'https://www.themarker.com/realestate',
    usedFor: 'אימות נתוני שוק לרבעון',
    publicationSchedule: { type: "continuous" },
    language: "he",
  },

  // ───── Internal ─────
  {
    id: "internal-research",
    name: 'קובץ מחקר אקסל מקורי',
    organization: 'מחקר פנימי',
    category: "internal",
    description: 'מחקר פנימי שמשמש בסיס לחישובים הראשיים',
    url: '#',
    usedFor: 'בסיס לכל הנתונים הראשוניים — 36 ערים מלאות + 132 ערים מורחבות',
    feedsTables: ['city'],
    publicationSchedule: { type: "irregular" },
    language: "he",
  },
  {
    id: "data-gov-il",
    name: 'data.gov.il — פורטל הנתונים הפתוחים',
    organization: 'ממשלת ישראל',
    category: "internal",
    description: 'פורטל הנתונים הפתוחים של ממשלת ישראל',
    url: 'https://data.gov.il',
    usedFor: 'גישה ל-API של נתוני למ"ס באמצעות resource_id',
    publicationSchedule: { type: "continuous" },
    language: "he",
  },
  {
    id: "urban-renewal-districts",
    name: 'מתחמי התחדשות עירונית',
    organization: 'הרשות הממשלתית להתחדשות עירונית',
    category: "internal",
    description: 'רשימת המתחמים המוכרזים להתחדשות עירונית — מסלול, סטטוס תכנוני, יח"ד קיימות ומוצעות — דרך פורטל הנתונים הפתוחים',
    url: 'https://data.gov.il',
    usedFor: 'מודול ההתחדשות העירונית בעמודי הערים (טבלת מתחמים פר עיר)',
    feedsTables: ['urban_renewal_projects'],
    publicationSchedule: { type: "irregular" },
    language: "he",
  },
];

export function getSourceById(id: string): Source | null {
  return SOURCES.find((s) => s.id === id) ?? null;
}

export function getSourcesByCategory(cat: CategoryKey): Source[] {
  return SOURCES.filter((s) => s.category === cat);
}

export function getCategoryByKey(key: CategoryKey): Category | null {
  return CATEGORIES.find((c) => c.key === key) ?? null;
}

/**
 * Compute the next expected publication date from a source's schedule.
 * Returns null for irregular/continuous sources.
 */
export function nextExpectedPublication(source: Source): Date | null {
  if (!source.publicationSchedule || !source.publicationDate) return null;
  const last = new Date(source.publicationDate);
  if (isNaN(last.getTime())) return null;

  const schedule = source.publicationSchedule;
  const next = new Date(last);

  switch (schedule.type) {
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      if (schedule.dayOfMonth) next.setDate(schedule.dayOfMonth);
      return next;
    case "quarterly":
      next.setMonth(next.getMonth() + 3);
      return next;
    case "annual":
      next.setFullYear(next.getFullYear() + 1);
      if (schedule.monthOfYear) next.setMonth(schedule.monthOfYear - 1);
      return next;
    case "irregular":
    case "continuous":
      return null;
  }
}

export function formatScheduleHe(schedule?: PublicationSchedule): string {
  if (!schedule) return "לא ידוע";
  switch (schedule.type) {
    case "monthly":
      return schedule.note ?? "חודשי";
    case "quarterly":
      return schedule.note ?? "רבעוני";
    case "annual":
      return schedule.note ?? "שנתי";
    case "irregular":
      return schedule.note ?? "לא סדיר";
    case "continuous":
      return schedule.note ?? "שוטף";
  }
}
