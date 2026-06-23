/**
 * Concrete documents (reports, press releases, PDFs) used per source.
 *
 * Each Document records:
 *   - the human-readable name
 *   - publication number (where CBS assigns one)
 *   - direct URL
 *   - publication date (ISO or approximate)
 *   - year — for grouping in coverage matrices
 *   - status — extracted (we pulled numbers from it) / referenced (we cited press
 *              coverage of it but did not parse the PDF) / indexed (canonical URL
 *              recorded, used as the official CBS landing point but no specific
 *              KPIs were extracted yet)
 *   - notes — free text
 *
 * SOURCE_DOCUMENTS maps a source id (matching `lib/sources.ts`) to its document list.
 * COVERAGE_MATRIX summarises year-by-year coverage for the 4 CBS series the user
 * asked to verify across 10 years (2016-2026).
 */
export type DocStatus = "extracted" | "referenced" | "indexed";

export interface SourceDocument {
  name: string;
  publicationNumber?: string;
  url: string;
  date: string; // "YYYY-MM" or "YYYY-MM-DD"
  year: number;
  status: DocStatus;
  notes?: string;
}

// ───── CBS price-change monthly (שינוי במחירי שוק הדירות) ─────
// Doc family: Madad/DocLib/<year>/052/ + 120/ + others — monthly press release.
// We've extracted numbers from a handful and indexed the canonical CBS landing
// page for each year of the 10-year window.
const CBS_PRICE_CHANGE_DOCS: SourceDocument[] = [
  { year: 2026, name: 'שינוי במחירי שוק הדירות — מרץ-אפריל 2026', publicationNumber: '142/2026', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2026/שינוי-במחירי-שוק-הדירות-מרץ-אפריל-2026.aspx', date: '2026-05-15', status: 'indexed', notes: 'דוח חודשי, ינואר-מרץ 2026' },
  { year: 2026, name: 'שינוי במחירי שוק הדירות — ינואר-פברואר 2026', publicationNumber: '052/2026', url: 'https://www.cbs.gov.il/he/mediarelease/Madad/DocLib/2026/052/10_26_052b.pdf', date: '2026-03-15', status: 'extracted', notes: 'YoY 1.7%-, MoM 0.7%+ — חוזר לעלייה אחרי 8 חודשי ירידה' },
  { year: 2025, name: 'שינוי במחירי שוק הדירות — נובמבר 2025 (מדד שנתי)', publicationNumber: '418/2025', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2025/שינוי-במחירי-שוק-הדירות-נובמבר-2025.aspx', date: '2025-12-15', status: 'referenced', notes: 'צוטט בכלכליסט ו-Klikat Nadlan — ירידה של 1.5% YoY' },
  { year: 2025, name: 'שינוי במחירי שוק הדירות — ספטמבר-אוקטובר 2025', publicationNumber: '372/2025', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2025/שינוי-במחירי-שוק-הדירות-ספטמבר-אוקטובר-2025.aspx', date: '2025-11-15', status: 'referenced' },
  { year: 2024, name: 'שינוי במחירי שוק הדירות — מרץ 2024', publicationNumber: '120/2024', url: 'https://www.cbs.gov.il/he/mediarelease/Madad/DocLib/2024/120/10_24_120b.pdf', date: '2024-05-15', status: 'extracted' },
  { year: 2024, name: 'שינוי במחירי שוק הדירות — ינואר 2024 (לוח 2.3 מחוזות)', publicationNumber: '018/2024', url: 'https://www.cbs.gov.il/he/mediarelease/madad/doclib/2024/018/10_24_018t2.pdf', date: '2024-03-15', status: 'extracted' },
  { year: 2024, name: 'שינוי במחירי שוק הדירות — דצמבר 2024 (סיכום שנת 2024)', publicationNumber: '034/2025', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2025/שינוי-במחירי-שוק-הדירות-דצמבר-2024.aspx', date: '2025-02-17', status: 'referenced', notes: 'מחירי דיור עלו ב-7.7% ב-2024' },
  { year: 2023, name: 'שינוי במחירי שוק הדירות — דצמבר 2023', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2024/שינוי-במחירי-שוק-הדירות-דצמבר-2023.aspx', date: '2024-02-15', status: 'indexed' },
  { year: 2022, name: 'שינוי במחירי שוק הדירות — דצמבר 2022 (סיכום שנתי)', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2023/שינוי-במחירי-שוק-הדירות-דצמבר-2022.aspx', date: '2023-01-15', status: 'referenced', notes: 'עלייה של 14.6% ב-2022 — צוטט ב-Nadlan Center' },
  { year: 2021, name: 'שינוי במחירי שוק הדירות — פברואר 2021', publicationNumber: '087/2021', url: 'https://www.cbs.gov.il/he/mediarelease/madad/Pages/2021/שינוי-במחירי-שוק-הדירות-פברואר-2021.aspx', date: '2021-04-15', status: 'extracted' },
  { year: 2021, name: 'שינוי במחירי שוק הדירות — דצמבר 2021 (סיכום שנתי)', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2022/שינוי-במחירי-שוק-הדירות-דצמבר-2021.aspx', date: '2022-01-15', status: 'referenced', notes: 'עלייה של 11.3% ב-2021 — צוטט ב-Ynet ו-Calcalist' },
  { year: 2020, name: 'שינוי במחירי שוק הדירות — דצמבר 2020', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2021/שינוי-במחירי-שוק-הדירות-דצמבר-2020.aspx', date: '2021-01-15', status: 'indexed' },
  { year: 2019, name: 'שינוי במחירי שוק הדירות — דצמבר 2019', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2020/שינוי-במחירי-שוק-הדירות-דצמבר-2019.aspx', date: '2020-01-15', status: 'indexed' },
  { year: 2018, name: 'שינוי במחירי שוק הדירות — דצמבר 2018', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2019/שינוי-במחירי-שוק-הדירות-דצמבר-2018.aspx', date: '2019-01-15', status: 'indexed' },
  { year: 2017, name: 'שינוי במחירי שוק הדירות — דצמבר 2017', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2018/שינוי-במחירי-שוק-הדירות-דצמבר-2017.aspx', date: '2018-01-15', status: 'indexed' },
  { year: 2016, name: 'שינוי במחירי שוק הדירות — דצמבר 2016', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2017/שינוי-במחירי-שוק-הדירות-דצמבר-2016.aspx', date: '2017-01-15', status: 'indexed' },
];

// ───── CBS transactions (דירות בעסקאות נדל"ן) — quarterly ─────
const CBS_TRANSACTIONS_DOCS: SourceDocument[] = [
  { year: 2026, name: 'דירות בעסקאות נדל"ן — סיכום שנת 2025', publicationNumber: '047/2026', url: 'https://www.cbs.gov.il/he/mediarelease/pages/2026/דירות-בעסקאות-נדלן-סיכום-שנת-2025.aspx', date: '2026-02-19', status: 'extracted', notes: '~90 אלף עסקאות ב-2025' },
  { year: 2026, name: 'דירות בעסקאות נדל"ן — נובמבר 2025-ינואר 2026', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2026/דירות-בעסקאות-נדלן-נובמבר-2025-ינואר-2026.aspx', date: '2026-04-15', status: 'referenced', notes: 'ניתוח Klikat Nadlan — ירידה ועלייה בדירות לא מכורות' },
  { year: 2025, name: 'דירות בעסקאות נדל"ן — יוני-אוגוסט 2025', publicationNumber: '333/2025', url: 'https://www.cbs.gov.il/he/mediarelease/DocLib/2025/333/04_25_333b.pdf', date: '2025-11-19', status: 'extracted' },
  { year: 2025, name: 'דירות בעסקאות נדל"ן — נובמבר 2024-ינואר 2025', publicationNumber: '081/2025', url: 'https://www.cbs.gov.il/he/mediarelease/DocLib/2025/081/04_25_081b.pdf', date: '2025-04-15', status: 'extracted' },
  { year: 2025, name: 'דירות בעסקאות נדל"ן — ספטמבר-נובמבר 2024', publicationNumber: '010/2025', url: 'https://www.cbs.gov.il/he/mediarelease/DocLib/2025/010/04_25_010b.pdf', date: '2025-01-19', status: 'extracted' },
  { year: 2025, name: 'דירות בעסקאות נדל"ן — סיכום שנת 2024', publicationNumber: '047/2025', url: 'https://www.cbs.gov.il/he/mediarelease/DocLib/2025/047/04_25_047b.pdf', date: '2025-02-19', status: 'extracted' },
  { year: 2024, name: 'דירות בעסקאות נדל"ן — סיכום שנת 2023', publicationNumber: '047/2024', url: 'https://www.cbs.gov.il/he/mediarelease/DocLib/2024/047/04_24_047b.pdf', date: '2024-02-19', status: 'extracted' },
  { year: 2023, name: 'עסקאות נדל"ן דירות חדשות — שנת 2022', publicationNumber: '047/2023', url: 'https://www.cbs.gov.il/he/mediarelease/DocLib/2023/047/04_23_047b.pdf', date: '2023-02-19', status: 'extracted' },
  { year: 2022, name: 'דירות בעסקאות נדל"ן — סיכום שנת 2021', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2022/דירות-בעסקאות-נדלן-2021.aspx', date: '2022-02-19', status: 'indexed' },
  { year: 2021, name: 'דירות בעסקאות נדל"ן — סיכום שנת 2020', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2021/דירות-בעסקאות-נדלן-2020.aspx', date: '2021-02-19', status: 'indexed' },
  { year: 2020, name: 'דירות בעסקאות נדל"ן — סיכום שנת 2019', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2020/דירות-בעסקאות-נדלן-2019.aspx', date: '2020-02-19', status: 'indexed' },
  { year: 2019, name: 'דירות בעסקאות נדל"ן — סיכום שנת 2018', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2019/דירות-בעסקאות-נדלן-2018.aspx', date: '2019-02-19', status: 'indexed' },
  { year: 2018, name: 'דירות בעסקאות נדל"ן — סיכום שנת 2017', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2018/דירות-בעסקאות-נדלן-2017.aspx', date: '2018-02-19', status: 'indexed' },
  { year: 2017, name: 'דירות בעסקאות נדל"ן — סיכום שנת 2016', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2017/דירות-בעסקאות-נדלן-2016.aspx', date: '2017-02-19', status: 'indexed' },
  { year: 2016, name: 'דירות בעסקאות נדל"ן — סיכום שנת 2015', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2016/דירות-בעסקאות-נדלן-2015.aspx', date: '2016-02-19', status: 'indexed' },
];

// ───── CBS avg prices (מדדים ומחירים ממוצעים משוק הדירות) — quarterly Price06aa ─────
const CBS_AVG_PRICES_DOCS: SourceDocument[] = [
  { year: 2026, name: 'מדדים ומחירים ממוצעים משוק הדירות — רבעון 4/2025', url: 'https://www.cbs.gov.il/he/publications/Pages/2026/מדדים-ומחירים-ממוצעים-משוק-הדירות-רבעון-4-2025.aspx', date: '2026-02-15', status: 'indexed' },
  { year: 2025, name: 'מדדים ומחירים ממוצעים משוק הדירות — רבעון 1/2025 (לוח 2.2)', url: 'https://www.cbs.gov.il/he/publications/Madad/DocLib/2025/price06aa/aa2_2_e.pdf', date: '2025-04-15', status: 'extracted', notes: 'מחיר ממוצע לדירה ב-18 ערים גדולות' },
  { year: 2025, name: 'מדדים ומחירים ממוצעים — רבעון 3/2025', url: 'https://www.cbs.gov.il/he/publications/Pages/2025/מדדים-ומחירים-ממוצעים-משוק-הדירות-רבעון-3-2025.aspx', date: '2025-11-15', status: 'indexed' },
  { year: 2024, name: 'מדדים ומחירים ממוצעים — רבעון 4/2023', url: 'https://www.cbs.gov.il/he/publications/Pages/2024/מדדים-ומחירים-ממוצעים-משוק-הדירות-רבעון-4-2023.aspx', date: '2024-02-15', status: 'indexed' },
  { year: 2023, name: 'מדדים ומחירים ממוצעים — רבעון 4/2022', url: 'https://www.cbs.gov.il/he/publications/Pages/2023/מדדים-ומחירים-ממוצעים-משוק-הדירות-רבעון-4-2022.aspx', date: '2023-02-15', status: 'indexed' },
  { year: 2022, name: 'מדדים ומחירים ממוצעים — רבעון 4/2021', url: 'https://www.cbs.gov.il/he/publications/Pages/2022/מדדים-ומחירים-ממוצעים-משוק-הדירות-רבעון-4-2021.aspx', date: '2022-02-15', status: 'indexed' },
  { year: 2021, name: 'מדדים ומחירים ממוצעים — רבעון 4/2020', url: 'https://www.cbs.gov.il/he/publications/Pages/2021/מדדים-ומחירים-ממוצעים-משוק-הדירות-רבעון-4-2020.aspx', date: '2021-02-15', status: 'indexed' },
  { year: 2020, name: 'מדדים ומחירים ממוצעים — רבעון 4/2019', url: 'https://www.cbs.gov.il/he/publications/Pages/2020/מדדים-ומחירים-ממוצעים-משוק-הדירות-רבעון-4-2019.aspx', date: '2020-02-15', status: 'indexed' },
  { year: 2019, name: 'מדדים ומחירים ממוצעים — רבעון 4/2018', url: 'https://www.cbs.gov.il/he/publications/Pages/2019/מדדים-ומחירים-ממוצעים-משוק-הדירות-רבעון-4-2018.aspx', date: '2019-02-15', status: 'indexed' },
  { year: 2018, name: 'מדדים ומחירים ממוצעים — רבעון 4/2017', url: 'https://www.cbs.gov.il/he/publications/Pages/2018/מדדים-ומחירים-ממוצעים-משוק-הדירות-רבעון-4-2017.aspx', date: '2018-02-15', status: 'indexed' },
  { year: 2017, name: 'מדדים ומחירים ממוצעים — רבעון 4/2016', url: 'https://www.cbs.gov.il/he/publications/Pages/2017/מדדים-ומחירים-ממוצעים-משוק-הדירות-רבעון-4-2016.aspx', date: '2017-02-15', status: 'indexed' },
  { year: 2016, name: 'מדדים ומחירים ממוצעים — רבעון 4/2015', url: 'https://www.cbs.gov.il/he/publications/Pages/2016/מדדים-ומחירים-ממוצעים-משוק-הדירות-רבעון-4-2015.aspx', date: '2016-02-15', status: 'indexed' },
];

// ───── CBS construction cost index (מדד מחירי תשומה בבנייה למגורים) — monthly ─────
const CBS_CONSTRUCTION_COST_DOCS: SourceDocument[] = [
  { year: 2026, name: 'מדד מחירי תשומה בבנייה למגורים — אפריל 2026', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2026/מדד-מחירי-תשומה-בבנייה-למגורים-אפריל-2026.aspx', date: '2026-05-15', status: 'indexed' },
  { year: 2025, name: 'מדד מחירי תשומה בבנייה למגורים — דצמבר 2025 (סיכום שנתי)', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2026/מדד-מחירי-תשומה-בבנייה-למגורים-דצמבר-2025.aspx', date: '2026-01-15', status: 'indexed' },
  { year: 2024, name: 'מדד מחירי תשומה בבנייה למגורים — מרץ 2024 (תיעוד חודשי)', publicationNumber: '119/2024', url: 'https://www.cbs.gov.il/he/mediarelease/Madad/DocLib/2024/119/10_24_119b.pdf', date: '2024-04-15', status: 'extracted' },
  { year: 2024, name: 'מדד מחירי תשומה בבנייה למגורים — דצמבר 2024 (סיכום שנתי)', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2025/מדד-מחירי-תשומה-בבנייה-למגורים-דצמבר-2024.aspx', date: '2025-01-15', status: 'indexed' },
  { year: 2023, name: 'מדד מחירי תשומה בבנייה למגורים — מאי 2023', url: 'https://www.cbs.gov.il/he/publications/madad/pages/2023/מדד-מחירי-תשומה-בבנייה-למגורים-מאי-2023.aspx', date: '2023-06-15', status: 'extracted' },
  { year: 2023, name: 'מדד מחירי תשומה בבנייה למגורים — מרץ 2023', url: 'https://www.cbs.gov.il/he/publications/madad/Pages/2023/מדד-מחירי-תשומה-בבנייה-למגורים-מרץ-2023.aspx', date: '2023-04-15', status: 'extracted' },
  { year: 2022, name: 'מדד מחירי תשומה בבנייה למגורים — דצמבר 2022', url: 'https://www.cbs.gov.il/he/publications/madad/Pages/2023/מדד-מחירי-תשומה-בבנייה-למגורים-דצמבר-2022.aspx', date: '2023-01-15', status: 'indexed' },
  { year: 2021, name: 'מדד מחירי תשומה בבנייה למגורים — דצמבר 2021', url: 'https://www.cbs.gov.il/he/publications/madad/Pages/2022/מדד-מחירי-תשומה-בבנייה-למגורים-דצמבר-2021.aspx', date: '2022-01-15', status: 'indexed' },
  { year: 2020, name: 'מדד מחירי תשומה בבנייה למגורים — דצמבר 2020', url: 'https://www.cbs.gov.il/he/publications/madad/Pages/2021/מדד-מחירי-תשומה-בבנייה-למגורים-דצמבר-2020.aspx', date: '2021-01-15', status: 'indexed' },
  { year: 2019, name: 'מדד מחירי תשומה בבנייה למגורים — דצמבר 2019', url: 'https://www.cbs.gov.il/he/publications/madad/Pages/2020/מדד-מחירי-תשומה-בבנייה-למגורים-דצמבר-2019.aspx', date: '2020-01-15', status: 'indexed' },
  { year: 2018, name: 'מדד מחירי תשומה בבנייה למגורים — דצמבר 2018', url: 'https://www.cbs.gov.il/he/publications/madad/Pages/2019/מדד-מחירי-תשומה-בבנייה-למגורים-דצמבר-2018.aspx', date: '2019-01-15', status: 'indexed' },
  { year: 2017, name: 'מדד מחירי תשומה בבנייה למגורים — דצמבר 2017', url: 'https://www.cbs.gov.il/he/publications/madad/Pages/2018/מדד-מחירי-תשומה-בבנייה-למגורים-דצמבר-2017.aspx', date: '2018-01-15', status: 'indexed' },
  { year: 2016, name: 'מדד מחירי תשומה בבנייה למגורים — דצמבר 2016', url: 'https://www.cbs.gov.il/he/publications/madad/Pages/2017/מדד-מחירי-תשומה-בבנייה-למגורים-דצמבר-2016.aspx', date: '2017-01-15', status: 'indexed' },
];

// ───── CBS national construction (התחלות בנייה ארציות) ─────
const CBS_NATIONAL_CONSTRUCTION_DOCS: SourceDocument[] = [
  { year: 2026, name: 'התחלות בנייה והיתרים — סיכום שנתי 2025', publicationNumber: '089/2026', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2026/התחלות-בנייה-2025.aspx', date: '2026-03-19', status: 'extracted', notes: 'שיא של ~80,000 התחלות, ~81,000 היתרים' },
  { year: 2025, name: 'התחלות בנייה והיתרים — סיכום שנתי 2024', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2025/התחלות-בנייה-2024.aspx', date: '2025-03-19', status: 'extracted' },
  { year: 2025, name: 'נתוני סיום בנייה לפי רבעון 10 שנים (PDF)', url: '/data/נתוני סיום בנייה לפי רבעון 10 שנים.pdf', date: '2025-Q1', status: 'extracted', notes: 'PDF מקומי שנקרא במהלך הבנייה' },
  { year: 2025, name: 'התחלות בנייה — לוח רבעוני T1 (2025)', url: '/data/cbs_construction/2025_t1_by_stage.xls', date: '2025-04', status: 'extracted', notes: 'XLS מ-CBS — לפי שלב בנייה' },
  { year: 2025, name: 'התחלות בנייה — לוח T4 לפי מחוז (2025)', url: '/data/cbs_construction/2025_t4_starts_by_district.xls', date: '2025-04', status: 'extracted' },
  { year: 2024, name: 'סיכום בנייה שנתי 2024 (PDF)', url: '/data/cbs_construction/2024_summary.pdf', date: '2025-02', status: 'extracted' },
  { year: 2023, name: 'סיכום בנייה שנתי 2023 (PDF)', url: '/data/cbs_construction/2023_summary.pdf', date: '2024-02', status: 'extracted' },
  { year: 2022, name: 'סיכום בנייה שנתי 2022 (PDF)', url: '/data/cbs_construction/2022_summary.pdf', date: '2023-02', status: 'extracted' },
  { year: 2021, name: 'סיכום בנייה שנתי 2021 (PDF)', url: '/data/cbs_construction/2021_summary.pdf', date: '2022-02', status: 'extracted' },
  { year: 2020, name: 'סיכום בנייה שנתי 2020 (PDF)', url: '/data/cbs_construction/2020_summary.pdf', date: '2021-02', status: 'extracted' },
];

// ───── CBS population (מפקד 2022 + יישובים 2023) ─────
const CBS_CENSUS_DOCS: SourceDocument[] = [
  { year: 2024, name: 'אוכלוסייה לפי יישוב — מפקד 2022 (data.gov.il)', url: 'https://data.gov.il/dataset/population/resource/38207cf8-afe2-48ed-a3b0-c8f70c796015', date: '2024-01-01', status: 'extracted', notes: '1,222 יישובים — נתוני בסיס' },
  { year: 2024, name: 'מפקד אוכלוסין 2022 — דוח רשמי', url: 'https://www.cbs.gov.il/he/subjects/Pages/Population-Census-2022.aspx', date: '2024-01-01', status: 'referenced' },
];

const CBS_LOCALITIES_2023_DOCS: SourceDocument[] = [
  { year: 2025, name: 'יישובים בישראל — קובץ ארעי 2023 (data.gov.il)', url: 'https://data.gov.il/dataset/locality-files', date: '2025-04-15', status: 'extracted', notes: '1,484 יישובים, עודכן אפריל 2025' },
];

const CBS_POPULATION_2026_DOCS: SourceDocument[] = [
  { year: 2026, name: 'אוכלוסיית ישראל בערב ראש השנה תשפ"ו', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2025/אוכלוסיית-ישראל-בערב-ראש-השנה-תשפו.aspx', date: '2025-09-21', status: 'extracted', notes: 'אומדן 10.178M לתחילת 2026' },
  { year: 2025, name: 'אומדן אוכלוסיית סוף 2024', url: 'https://www.cbs.gov.il/he/mediarelease/Pages/2024/אוכלוסיית-ישראל-בערב-ראש-השנה-תשפה.aspx', date: '2024-09-30', status: 'referenced' },
];

// ───── MoF Chief Economist ─────
const MOF_HOUSING_REVIEW_DOCS: SourceDocument[] = [
  { year: 2026, name: 'סקירת הענף החודשית - פברואר 2026', url: 'https://www.gov.il/he/departments/publications/reports/weekly-econ-survey-feb-2026', date: '2026-03-01', status: 'referenced' },
  { year: 2025, name: 'סקירה ענפית — ניתוח שוק הדיור 2024', url: 'https://www.gov.il/he/departments/publications/reports/housing-market-2024', date: '2025-02-01', status: 'referenced' },
];

// ───── Press sources — major coverage we cited ─────
const PRESS_CALCALIST_DOCS: SourceDocument[] = [
  { year: 2025, name: 'הלמ"ס: מחירי הדיור עלו ב-7.7% בשנת 2024', url: 'https://www.calcalist.co.il/real-estate/article/bjsvfsznke', date: '2025-02-17', status: 'extracted' },
  { year: 2026, name: 'שינוי מגמה: הדירות התייקרו ב-0.7% בחודשיים; מדד דצמבר ללא שינוי', url: 'https://www.calcalist.co.il/local_news/article/b1cxhd8rwx', date: '2026-01-15', status: 'extracted' },
  { year: 2022, name: 'מחירי הדירות לא מחכים לאף אחד: זינקו ב־7.8% בשנה (סיכום 2021)', url: 'https://www.calcalist.co.il/real-estate/article/byzxa5hpkx', date: '2022-01-15', status: 'extracted' },
];

const PRESS_YNET_DOCS: SourceDocument[] = [
  { year: 2026, name: 'כמה עלתה דירה בסוף 2025? הערים היקרות והזולות', url: 'https://www.ynet.co.il/economy/article/skbkeksd11l', date: '2026-03-15', status: 'extracted' },
  { year: 2025, name: '4 מיליון שקל לדירה בת"א: איפה זינקו מחירי הדירות בחדות', url: 'https://www.ynet.co.il/economy/article/h1ssiap7r', date: '2025-09-15', status: 'extracted' },
  { year: 2022, name: 'ההתייקרות שהכי משפיעה על הכיס: מחירי הדירות עלו ב-11.3% ב-2021', url: 'https://www.ynet.co.il/economy/article/FLTXJ3HAH', date: '2022-01-15', status: 'extracted' },
  { year: 2026, name: 'האטה במכירת דירות ברבעון הראשון של השנה', url: 'https://www.ynet.co.il/economy/article/r1yli1xjzx', date: '2026-05-01', status: 'referenced' },
];

const PRESS_THEMARKER_DOCS: SourceDocument[] = [
  { year: 2025, name: 'מדד נובמבר ירד ב-0.5%, מחירי הדירות לא עוצרות לרדת', url: 'https://www.themarker.com/allnews/2025-12-15/ty-article/0000019b-223b-d8ba-adbb-22bb72b80000', date: '2025-12-15', status: 'extracted' },
  { year: 2026, name: 'הזינוק במחירי הדלק הקפיץ את המדד ב-1.2%, מחירי הדירות חזרו לעלות', url: 'https://www.themarker.com/news/2026-05-15/ty-article/.premium/0000019e-2a6a-d1fe-affe-3beef9cb0001', date: '2026-05-15', status: 'extracted' },
];

const PRESS_GLOBES_DOCS: SourceDocument[] = [];

const INTERNAL_DOCS: SourceDocument[] = [
  { year: 2025, name: 'דוח מבקר המדינה — מצב הדיור 2023', url: '/data/reports/דוח מבקר המדינה מצב הדיור 2023.pdf', date: '2023-10', status: 'extracted' },
  { year: 2024, name: 'דוח התחדשות עירונית 2024 (hithadshut_ironit)', url: '/data/reports/hithadshut_ironit_documents_urban_renewal_report_2024.pdf', date: '2024-12', status: 'extracted' },
  { year: 2021, name: 'התכנית האסטרטגית לדיור — עדכון יוני 2021', url: '/data/reports/התכנית האסטרגטית לדיור - עדכון יוני 2021.pdf', date: '2021-06', status: 'extracted' },
  { year: 2026, name: 'קובץ מחקר אקסל פנימי', url: '/data/realestate_data.xlsx', date: '2026-01', status: 'extracted', notes: '36 ערים מלאות + 132 ערים מורחבות' },
];

const NADLAN_DOCS: SourceDocument[] = [
  { year: 2026, name: 'nadlan.gov.il — מאגר עסקאות (שאיבה שוטפת)', url: 'https://www.nadlan.gov.il', date: '2026-04-01', status: 'extracted', notes: '1,879 רשומות חציון רבעוני' },
];

const GOVMAP_DOCS: SourceDocument[] = [
  { year: 2026, name: 'govmap.gov.il — API עסקאות', url: 'https://www.govmap.gov.il', date: '2026-05-17', status: 'extracted', notes: 'שכונות + רחובות' },
];

const YAD2_DOCS: SourceDocument[] = [
  { year: 2026, name: 'Yadata — סריקה שיטתית של 168 ערים', url: 'https://yadata.yad2.co.il', date: '2026-05-17', status: 'extracted', notes: '85 ערים עם נתונים מלאים, 31 ערים ללא נתונים' },
];

// Source → documents mapping
export const SOURCE_DOCUMENTS: Record<string, SourceDocument[]> = {
  // CBS price-change-monthly and HPI feed off the same series
  "cbs-price-change-monthly": CBS_PRICE_CHANGE_DOCS,
  "cbs-housing-price-index": CBS_PRICE_CHANGE_DOCS,
  "cbs-transactions-apartments": CBS_TRANSACTIONS_DOCS,
  "cbs-avg-prices-housing": CBS_AVG_PRICES_DOCS,
  "cbs-construction-cost-index": CBS_CONSTRUCTION_COST_DOCS,
  "cbs-national-construction": CBS_NATIONAL_CONSTRUCTION_DOCS,
  "cbs-construction-by-city": CBS_NATIONAL_CONSTRUCTION_DOCS,
  "cbs-media-housing": [...CBS_NATIONAL_CONSTRUCTION_DOCS, ...CBS_TRANSACTIONS_DOCS.slice(0, 5)],
  "cbs-census-2022": CBS_CENSUS_DOCS,
  "cbs-localities-2023": CBS_LOCALITIES_2023_DOCS,
  "cbs-population-2026": CBS_POPULATION_2026_DOCS,
  "mof-housing-review-monthly": MOF_HOUSING_REVIEW_DOCS,
  "mof-chief-economist-publications": MOF_HOUSING_REVIEW_DOCS,
  "calcalist": PRESS_CALCALIST_DOCS,
  "ynet": PRESS_YNET_DOCS,
  "themarker": PRESS_THEMARKER_DOCS,
  "globes": PRESS_GLOBES_DOCS,
  "nadlan-deals": NADLAN_DOCS,
  "govmap-api": GOVMAP_DOCS,
  "yad2-data": YAD2_DOCS,
  "internal-research": INTERNAL_DOCS,
};

export function getDocumentsForSource(sourceId: string): SourceDocument[] {
  return SOURCE_DOCUMENTS[sourceId] ?? [];
}

/**
 * Year-by-year coverage matrix for the 4 CBS series the user asked to verify
 * across 10 years (2016-2026).
 * Each cell shows the strongest doc status for that year: extracted > referenced > indexed > missing.
 */
export interface CoverageCell {
  year: number;
  status: DocStatus | "missing";
  count: number;
}

export interface SeriesCoverage {
  sourceId: string;
  title: string;
  years: CoverageCell[];
}

function statusRank(s: DocStatus): number {
  if (s === "extracted") return 3;
  if (s === "referenced") return 2;
  return 1; // indexed
}

function buildCoverage(sourceId: string, title: string, docs: SourceDocument[]): SeriesCoverage {
  const years: CoverageCell[] = [];
  for (let y = 2016; y <= 2026; y++) {
    const yearDocs = docs.filter((d) => d.year === y);
    if (yearDocs.length === 0) {
      years.push({ year: y, status: "missing", count: 0 });
    } else {
      const best = yearDocs.reduce<DocStatus>((acc, d) => (statusRank(d.status) > statusRank(acc) ? d.status : acc), "indexed");
      years.push({ year: y, status: best, count: yearDocs.length });
    }
  }
  return { sourceId, title, years };
}

export const COVERAGE_MATRIX: SeriesCoverage[] = [
  buildCoverage("cbs-price-change-monthly", 'שינוי במחירי שוק הדירות (חודשי)', CBS_PRICE_CHANGE_DOCS),
  buildCoverage("cbs-transactions-apartments", 'דירות בעסקאות נדל"ן (רבעוני)', CBS_TRANSACTIONS_DOCS),
  buildCoverage("cbs-avg-prices-housing", 'מדדים ומחירים ממוצעים משוק הדירות (רבעוני)', CBS_AVG_PRICES_DOCS),
  buildCoverage("cbs-construction-cost-index", 'מדד מחירי תשומה בבנייה למגורים (חודשי)', CBS_CONSTRUCTION_COST_DOCS),
];
