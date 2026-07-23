/**
 * City → sub-area map.
 *
 * Each city has 3–6 sub-areas, each defined by a list of neighborhood-name
 * SUBSTRINGS (not exact names). When classifying a deal we test if any of
 * the substrings appears in the deal's `neighborhood` field. This lets us
 * cope with govmap returning slightly different spellings (e.g. "פלורנטין"
 * vs "צפון פלורנטין" vs "פלורנטין-יד אליהו" — they all match "פלורנטין").
 *
 * Maps are based on common real-estate convention (Tel Aviv municipality
 * districts, Jerusalem neighborhood clusters, etc.) — not an officially
 * canonical division. Use the source field in each entry to track who set
 * the boundary.
 *
 * Cities NOT in this map fall through to a "whole city" single row.
 */

export interface Subarea {
  /** Slug used in URLs + cache keys. ASCII-only. */
  slug: string;
  /** Display label in Hebrew. */
  label: string;
  /** Substring patterns that classify a neighborhood into this sub-area. */
  patterns: string[];
}

/**
 * "Other" bucket. We always show this row so that deals from neighborhoods
 * outside the curated patterns aren't silently dropped — the user sees the
 * count and can ask us to expand the map.
 */
export const OTHER_SUBAREA: Subarea = {
  slug: "other",
  label: 'אחר / לא ממופה',
  patterns: [],
};

export const CITY_SUBAREAS: Record<string, Subarea[]> = {
  "תל אביב-יפו": [
    { slug: "north-old",  label: "צפון ישן",   patterns: ["הצפון הישן", "בבלי", "צהלה", "רמת אביב", "אפקה", "נווה אביבים", "מעוז אביב"] },
    { slug: "north-new",  label: "צפון חדש",   patterns: ["רמת החייל", "תל ברוך", "הצפון החדש", "נווה שרת", "הדר יוסף", "כוכב הצפון", "גלי תכלת", "נווה דן"] },
    { slug: "center",     label: "מרכז",        patterns: ["לב העיר", "מרכז העיר", "נחלת יצחק", "גני שרונה", "שרונה", "רוטשילד", "שוק הכרמל", "מונטיפיורי", "כרם התימנים", "גן העיר", "מערב לב העיר"] },
    { slug: "south",      label: "דרום",        patterns: ["פלורנטין", "נווה צדק", "יד אליהו", "התקווה", "נווה שאנן", "ביצרון", "כפר שלם", "שכונת התקווה", "ק. שלום"] },
    { slug: "yafo",       label: "יפו",         patterns: ["יפו", "עג'מי", "עגמי", "צהלון", "נווה גולן", "ג'בליה"] },
  ],
  "ירושלים": [
    { slug: "center",     label: "מרכז",        patterns: ["מרכז העיר", "נחלאות", "רחביה", "מאה שערים", "טלביה", "גאולה", "זכרון משה"] },
    { slug: "west",       label: "דרום-מערב",   patterns: ["קטמון", "בקעה", "ארנונה", "מקור חיים", "המושבה הגרמנית", "גילה", "הולילנד", "מלחה"] },
    { slug: "north-haredi", label: "צפון/חרדי", patterns: ["רמות", "סנהדריה", "רמת שלמה", "בית ישראל", "מאה שערים", "הר נוף"] },
    { slug: "east",       label: "מזרח",        patterns: ["פסגת זאב", "נווה יעקב", "רמת אשכול", "תלפיות מזרח", "ארמון הנציב", "ענתות"] },
    { slug: "south-new",  label: "דרום חדש",    patterns: ["גילה", "קרית מנחם", "עיר גנים", "קיריה לאומית", "מבשרת"] },
  ],
  "חיפה": [
    { slug: "carmel",     label: "כרמל",        patterns: ["כרמל", "מרכז הכרמל", "כרמליה", "הר הכרמל", "אחוזה", "רוממה", "דניה"] },
    { slug: "merkaz",     label: "מרכז העיר",  patterns: ["הדר", "מרכז העיר", "הדר הכרמל", "ואדי סאליב", "ואדי ניסנאס", "סלע"] },
    { slug: "downtown",   label: "עיר תחתית",  patterns: ["עיר תחתית", "ואדי", "חליסה", "שכונת התקווה"] },
    { slug: "krayot-east", label: "מזרח חיפה",  patterns: ["נווה שאנן", "רמת אלון", "גבעת דאוניה", "כרמל צרפתי", "תל עמל", "רמת התשבי", "קרית אליעזר"] },
  ],
  "ראשון לציון": [
    { slug: "old-city",   label: "העיר הישנה", patterns: ["נווה דקלים", "רמת אליהו", "נווה ים", "המוצא", "נחלת יהודה", "המוסדות"] },
    { slug: "new-west",   label: "מערב חדש",   patterns: ["נווה הים", "כפר אריה", "נווה חוף", "מערב ראשון", "ים", "גנים"] },
    { slug: "east",       label: "מזרח",        patterns: ["סביוני", "אברמסקי", "פלמ\"ח", "רמב\"ם", "קרית רבין", "מזרח ראשון"] },
  ],
  "פתח תקווה": [
    { slug: "center",     label: "מרכז",        patterns: ["מרכז העיר", "אם המושבות", "הדר גנים", "כפר גנים"] },
    { slug: "north",      label: "צפון",        patterns: ["כפר אברהם", "נווה גנים", "רמת ורבר", "צפון פ\"ת"] },
    { slug: "south",      label: "דרום",        patterns: ["נוה עוז", "אחדות", "מחנה יהודה", "שפירא", "רמת סיב"] },
  ],
  "אשדוד": [
    { slug: "old",        label: "אזור ישן",   patterns: ["א", "ב", "ג", "ד", "ה", "ו", "סיטי"] },
    { slug: "north",      label: "צפון",        patterns: ["יב", "יג", "טז", "יז", "צפון א"] },
    { slug: "south",      label: "דרום",        patterns: ["ח", "ט", "י", "יא", "יד", "טו", "סטופ"] },
  ],
  "נתניה": [
    { slug: "center",     label: "מרכז",        patterns: ["מרכז העיר", "קריית השרון", "הצפון הישן"] },
    { slug: "north",      label: "צפון",        patterns: ["נווה איתמר", "פולג", "קריית נורדאו", "ניצה"] },
    { slug: "south",      label: "דרום",        patterns: ["רמת אפרים", "עיר ימים", "רמת חן", "רמת פולג"] },
  ],
  "באר שבע": [
    { slug: "old",        label: "עיר עתיקה",  patterns: ["העיר העתיקה", "ב", "ג"] },
    { slug: "north",      label: "צפון",        patterns: ["נווה זאב", "רמות", "נווה נוי"] },
    { slug: "south",      label: "דרום",        patterns: ["נחל בקע", "רמות הרכס", "ו", "ז"] },
    { slug: "east",       label: "מזרח",        patterns: ["נווה מנחם", "רגר", "דרום מערב"] },
  ],
  "רמת גן": [
    { slug: "north",      label: "צפון",        patterns: ["הצפון הישן", "מרום נווה", "נווה יהושע", "כיר רמת גן"] },
    { slug: "center",     label: "מרכז",        patterns: ["מרכז העיר", "הבורסה", "אבן גבירול"] },
    { slug: "south",      label: "דרום",        patterns: ["תל גנים", "רמת חן", "דרום רמת גן", "פרדס כץ"] },
  ],
  "בני ברק": [
    { slug: "north",      label: "צפון",        patterns: ["רמת אלחנן", "פרדס כץ", "צפון בני ברק"] },
    { slug: "center",     label: "מרכז",        patterns: ["מרכז בני ברק", "רחוב רבי עקיבא"] },
    { slug: "south",      label: "דרום",        patterns: ["קריית הרצוג", "זכרון מאיר", "דרום בני ברק"] },
  ],
  "חולון": [
    { slug: "old",        label: "ישן",         patterns: ["נווה ארזים", "קריית פנחס איילון", "המוסדות", "ק. בן גוריון"] },
    { slug: "new",        label: "חדש",         patterns: ["נווה רמז", "קרית שרת", "גן הפועל", "חולון 26"] },
  ],
  "בת ים": [
    { slug: "old",        label: "ישן",         patterns: ["נווה עופר", "רמת יוסף", "אזור התעשייה"] },
    { slug: "new",        label: "חדש",         patterns: ["רמת הנשיא", "פרי הים", "חוף בת ים"] },
  ],
  "רחובות": [
    { slug: "old",        label: "מרכז ישן",   patterns: ["שכונת אושה", "פרדסים", "מרכז העיר"] },
    { slug: "new",        label: "מערב חדש",   patterns: ["נווה יהודה", "קיריית משה", "רחובות ההיי-טק"] },
  ],
  "הרצליה": [
    { slug: "pituach",    label: "פיתוח",       patterns: ["הרצליה פיתוח", "פיתוח", "מרינה"] },
    { slug: "center",     label: "מרכז",        patterns: ["מרכז הרצליה", "ויצמן", "יד התשעה"] },
    { slug: "old",        label: "ישנה",        patterns: ["נווה ישראל", "נווה עמל"] },
  ],
  "כפר סבא": [
    { slug: "north",      label: "צפון",        patterns: ["נווה אביב", "קפלן צפון"] },
    { slug: "center",     label: "מרכז",        patterns: ["מרכז העיר", "התחנה"] },
    { slug: "south",      label: "דרום",        patterns: ["נווה מנחם", "רמת קסם", "אלפי מנשה"] },
  ],
  "מודיעין-מכבים-רעות": [
    { slug: "modiin",     label: "מודיעין",     patterns: ["הציפורים", "הכרמים", "בוכמן", "נוף איילון", "קייזר", "מרום"] },
    { slug: "maccabim",   label: "מכבים-רעות",  patterns: ["מכבים", "רעות"] },
  ],
  "בית שמש": [
    { slug: "old",        label: "ישן",         patterns: ["שכונת ב", "שכונת ג", "קריית גורן"] },
    { slug: "rama",       label: "רמה",          patterns: ["רמת בית שמש"] },
  ],
  "אשקלון": [
    { slug: "old",        label: "מרכז ישן",   patterns: ["אפרידר", "ברנע", "שמשון"] },
    { slug: "new",        label: "חדש",         patterns: ["נווה אילן", "גני הדר"] },
    { slug: "marina",     label: "חוף ומרינה", patterns: ["מרינה", "חוף"] },
  ],
  "רעננה": [
    { slug: "old",        label: "ישנה",        patterns: ["נוף ים", "המרכז", "רעננה הישנה"] },
    { slug: "new",        label: "חדשה",        patterns: ["רעננה הצפונית", "ברנדיס", "נוה זמר"] },
  ],
  "גבעתיים": [
    { slug: "borochov",   label: "בורוכוב",     patterns: ["בורוכוב", "המעלות"] },
    { slug: "center",     label: "מרכז",        patterns: ["מרכז גבעתיים", "ארלוזורוב"] },
    { slug: "rambam",     label: "רמב\"ם",      patterns: ["רמב\"ם", "רמבם", "שינקין"] },
  ],
};

/**
 * Build a list of (cityName, subarea) tuples for ALL mapped cities.
 * Used by the prefetch runner to enumerate the work.
 */
export function listMappedCities(): string[] {
  return Object.keys(CITY_SUBAREAS);
}

/**
 * Classify a single deal's neighborhood into a sub-area slug.
 * Returns:
 *   - the matching sub-area's slug if a pattern matches
 *   - "other" if no pattern matches but the city IS mapped
 *   - null if the city itself isn't in the map (caller should treat it as
 *     a single whole-city area)
 */
/**
 * Normalise a neighborhood/pattern for matching. govmap is inconsistent:
 * `"הצפון הישן-החלק הצפוני"` (hyphen) vs a pattern written with a space would
 * never match under exact `includes()`, dumping ~10K TLV deals into "אחר".
 * We collapse hyphens↔space, strip quotes/geresh, and unify doubled יי/וו.
 */
function normHood(s: string): string {
  return s
    .replace(/["'`׳״]/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/יי/g, "י")
    .replace(/וו/g, "ו")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifySubarea(cityName: string, neighborhood: string | null | undefined): string | null {
  const areas = CITY_SUBAREAS[cityName];
  if (!areas) return null;
  if (!neighborhood) return OTHER_SUBAREA.slug;
  const clean = normHood(neighborhood);
  for (const area of areas) {
    for (const pattern of area.patterns) {
      if (clean.includes(normHood(pattern))) return area.slug;
    }
  }
  return OTHER_SUBAREA.slug;
}

/**
 * Return the ordered list of sub-areas for a city (including the "other"
 * bucket at the end). Returns a single "whole city" entry for unmapped cities.
 */
export function getSubareas(cityName: string): Subarea[] {
  const areas = CITY_SUBAREAS[cityName];
  if (!areas) {
    return [{ slug: "whole", label: "סך כל העיר", patterns: [] }];
  }
  return [...areas, OTHER_SUBAREA];
}
