/**
 * City-level apartment transaction counts from CBS 047/2026.
 *
 * Source PDF: data/reports/recent/cbs_047_2026_transactions.pdf
 *   - Table B (page 6): NEW apartments sold per city — 23 cities
 *   - Table B continuation (page 7): SECOND-HAND apartments sold per city — 34 cities
 *
 * CBS only lists cities that crossed the 500-deals threshold in 2025. For all
 * smaller cities we return null and the UI shows "אין נתון מאומת".
 *
 * Numbers verified directly from the PDF: count, % YoY vs 2024, % vs 2023.
 */

export interface CbsTransactionsRow {
  city_name: string;
  /** Number of NEW (contractor) apartments sold in 2025. */
  new_sales_2025: number | null;
  /** % change vs 2024 — new apartments. */
  new_yoy_2024: number | null;
  /** % change vs 2023 — new apartments. */
  new_yoy_2023: number | null;
  /** Number of SECOND-HAND (yad shniya) apartments sold in 2025. */
  secondhand_sales_2025: number | null;
  /** % change vs 2024 — second-hand. */
  secondhand_yoy_2024: number | null;
  /** % change vs 2023 — second-hand. */
  secondhand_yoy_2023: number | null;
}

/**
 * Raw new-only rows from table B page 6 (23 cities).
 * NOTE the spelling — CBS uses "הרצלייה" (yud-yud) here, our city DB uses "הרצליה" (single yud).
 * We normalize to the DB spelling at the bottom of the file.
 */
const NEW_ROWS = [
  { city_name: "תל אביב-יפו",   c2025: 2372, y24: -23.7, y23: 95.2 },
  { city_name: "אופקים",         c2025: 2013, y24: -4.3,  y23: 351.3 },
  { city_name: "ירושלים",        c2025: 1911, y24: -35.4, y23: -19.0 },
  { city_name: "לוד",            c2025: 1611, y24: -11.7, y23: 488.0 },
  { city_name: "נתניה",          c2025: 1347, y24: -0.5,  y23: 56.6 },
  { city_name: "נתיבות",         c2025: 1120, y24: -21.8, y23: -3.9 },
  { city_name: "חיפה",           c2025: 1094, y24: -11.7, y23: 40.3 },
  { city_name: "באר יעקב",       c2025: 1024, y24: 59.8,  y23: 211.2 },
  { city_name: "אשדוד",          c2025: 1008, y24: -36.2, y23: -1.6 },
  { city_name: "פתח תקווה",      c2025: 985,  y24: -38.5, y23: 20.1 },
  { city_name: "אלעד",           c2025: 797,  y24: 17.2,  y23: 389.0 },
  { city_name: "רמת גן",         c2025: 760,  y24: -22.3, y23: 7.0 },
  { city_name: "אשקלון",         c2025: 747,  y24: -51.1, y23: -51.1 },
  { city_name: "שדרות",          c2025: 732,  y24: 1.9,   y23: -8.0 },
  { city_name: "הרצליה",         c2025: 726,  y24: 49.7,  y23: 192.7 },
  { city_name: "ראשון לציון",    c2025: 692,  y24: -23.8, y23: -22.1 },
  { city_name: "בת ים",          c2025: 651,  y24: -42.1, y23: 15.0 },
  { city_name: "באר שבע",        c2025: 611,  y24: -51.4, y23: -35.0 },
  { city_name: "קריית גת",       c2025: 606,  y24: -11.7, y23: 97.4 },
  { city_name: "בית שמש",        c2025: 590,  y24: -47.3, y23: -28.5 },
  { city_name: "טבריה",          c2025: 571,  y24: -5.1,  y23: 98.3 },
  { city_name: "נוף הגליל",      c2025: 535,  y24: 36.5,  y23: 414.4 },
];

/**
 * Raw secondhand-only rows from table B page 7 (34 cities).
 */
const SECONDHAND_ROWS = [
  { city_name: "ירושלים",                c2025: 3727, y24: -2.8,  y23: 26.9 },
  { city_name: "חיפה",                   c2025: 3632, y24: -7.6,  y23: 9.2 },
  { city_name: "באר שבע",                c2025: 2961, y24: -12.9, y23: 7.7 },
  { city_name: "תל אביב-יפו",            c2025: 2787, y24: 10.1,  y23: 48.5 },
  { city_name: "אשקלון",                 c2025: 1815, y24: 0.9,   y23: 44.0 },
  { city_name: "פתח תקווה",              c2025: 1751, y24: -8.0,  y23: 33.4 },
  { city_name: "נתניה",                  c2025: 1588, y24: -3.2,  y23: 34.8 },
  { city_name: "ראשון לציון",            c2025: 1523, y24: -1.8,  y23: 57.5 },
  { city_name: "אשדוד",                  c2025: 1508, y24: -4.4,  y23: 36.5 },
  { city_name: "בית שמש",                c2025: 1304, y24: 18.7,  y23: 73.6 },
  { city_name: "רמת גן",                 c2025: 1165, y24: -5.7,  y23: 38.7 },
  { city_name: "חולון",                  c2025: 1040, y24: -7.1,  y23: 24.7 },
  { city_name: "בת ים",                  c2025: 998,  y24: -7.0,  y23: 24.8 },
  { city_name: "רחובות",                 c2025: 926,  y24: -10.4, y23: 20.7 },
  { city_name: "בני ברק",                c2025: 914,  y24: -6.2,  y23: 19.8 },
  { city_name: "עפולה",                  c2025: 896,  y24: -4.9,  y23: 19.0 },
  { city_name: "קריית גת",               c2025: 849,  y24: 4.7,   y23: 35.6 },
  { city_name: "חדרה",                   c2025: 814,  y24: -13.1, y23: 28.6 },
  { city_name: "לוד",                    c2025: 808,  y24: -3.6,  y23: 15.3 },
  { city_name: "קריית אתא",              c2025: 771,  y24: 5.6,   y23: 7.7 },
  { city_name: "מודיעין-מכבים-רעות",    c2025: 701,  y24: -4.8,  y23: 48.8 },
  { city_name: "נהרייה",                 c2025: 668,  y24: 3.2,   y23: 20.8 },
  { city_name: "הרצליה",                 c2025: 661,  y24: 11.1,  y23: 59.3 },
  { city_name: "אילת",                   c2025: 654,  y24: 7.0,   y23: 30.3 },
  { city_name: "קריית מוצקין",           c2025: 630,  y24: -16.8, y23: 20.7 },
  { city_name: "קריית ים",               c2025: 623,  y24: 16.7,  y23: 35.4 },
  { city_name: "נתיבות",                 c2025: 617,  y24: 9.0,   y23: 84.2 },
  { city_name: "קריית ביאליק",           c2025: 610,  y24: -5.4,  y23: 52.5 },
  { city_name: "טבריה",                  c2025: 605,  y24: 0.8,   y23: 10.6 },
  { city_name: "כפר סבא",                c2025: 600,  y24: -1.8,  y23: 49.3 },
  { city_name: "רמלה",                   c2025: 596,  y24: -6.6,  y23: 19.2 },
  { city_name: "ראש העין",               c2025: 591,  y24: 5.5,   y23: 116.5 },
  { city_name: "חריש",                   c2025: 537,  y24: -5.1,  y23: 77.2 },
  { city_name: "עכו",                    c2025: 510,  y24: -3.6,  y23: 3.4 },
];

// Merge both tables into a single per-city record. A city that appears only
// in one table gets nulls for the other side.
const MERGED = new Map<string, CbsTransactionsRow>();
for (const r of NEW_ROWS) {
  MERGED.set(r.city_name, {
    city_name: r.city_name,
    new_sales_2025: r.c2025,
    new_yoy_2024: r.y24,
    new_yoy_2023: r.y23,
    secondhand_sales_2025: null,
    secondhand_yoy_2024: null,
    secondhand_yoy_2023: null,
  });
}
for (const r of SECONDHAND_ROWS) {
  const existing = MERGED.get(r.city_name);
  if (existing) {
    existing.secondhand_sales_2025 = r.c2025;
    existing.secondhand_yoy_2024 = r.y24;
    existing.secondhand_yoy_2023 = r.y23;
  } else {
    MERGED.set(r.city_name, {
      city_name: r.city_name,
      new_sales_2025: null,
      new_yoy_2024: null,
      new_yoy_2023: null,
      secondhand_sales_2025: r.c2025,
      secondhand_yoy_2024: r.y24,
      secondhand_yoy_2023: r.y23,
    });
  }
}
const ROWS: CbsTransactionsRow[] = Array.from(MERGED.values());

const BY_NAME = new Map<string, CbsTransactionsRow>();
for (const r of ROWS) BY_NAME.set(r.city_name, r);

export function getCbsTransactionsForCity(cityName: string): CbsTransactionsRow | null {
  return BY_NAME.get(cityName) ?? null;
}

export function allCbsTransactionsCities(): CbsTransactionsRow[] {
  return ROWS;
}

export const CBS_TRANSACTIONS_SOURCE = {
  publicationNumber: "047/2026",
  /** the calendar year the table describes — every display derives from this */
  dataYear: 2025,
  pdfUrl: "/reports/cbs_047_2026_transactions.pdf",
  pdfUrlCbs:
    "https://www.cbs.gov.il/he/mediarelease/DocLib/2026/047/04_26_047b.pdf",
  publishedDate: "2026-02-12",
  description: 'CBS פרסום 047/2026 — לוח ב, עמ׳ 6 — דירות חדשות שנמכרו, יישובים נבחרים, 2025',
};
