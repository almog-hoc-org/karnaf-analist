/**
 * System rules — every parameter the site's numbers depend on, editable from
 * the admin dashboard instead of being hard-coded. Consumers call getRuleNum()
 * / getRuleBool() with the same default they used to hard-code, so behaviour is
 * identical until an admin changes something.
 *
 * Stored in data/app.db (system_rules); cached in-process for 5s so a page
 * render doesn't hit sqlite dozens of times.
 */
import { appDb } from "./appDb";

export interface RuleDef {
  key: string;
  label: string;
  group: string;
  kind: "number" | "boolean" | "text";
  default: number | boolean | string;
  unit?: string;
  help: string;
  /** true = value edits are ignored, only the on/off switch matters */
  toggleOnly?: boolean;
}

/** The catalogue the admin screen renders — also the source of defaults. */
export const RULE_DEFS: RuleDef[] = [
  // ── classification ────────────────────────────────────────────────
  { key: "secondhand_min_age", label: "שנים משנת בנייה כדי להיחשב יד-שנייה", group: "סיווג עסקאות", kind: "number", default: 4, unit: "שנים",
    help: "עסקה שבה חלפו לפחות כך שנים משנת הבנייה מסווגת כיד-שנייה; פחות מכך — דירה חדשה." },
  { key: "modern_min_year", label: "שנת בנייה מינימלית ל\"בניין מודרני\"", group: "סיווג עסקאות", kind: "number", default: 2005,
    help: "דירת יד-שנייה בבניין שנבנה משנה זו ומעלה = \"מודרני\"; לפני כן = \"ישן\". דירת 4 חד׳ בבניין בן 10 שנים יקרה בעשרות אחוזים מ-4 חד׳ בבניין בן 50 — ההשוואות והאנומליות מפרידות ביניהם." },
  { key: "ref_year", label: "שנת ייחוס לחישובים", group: "סיווג עסקאות", kind: "number", default: 2025,
    help: "השנה המלאה האחרונה שממנה נגזרים מחירים ושינויים (2026 חלקית)." },
  { key: "class_fallback_on", label: "סיווג גיבוי כשאין שנת בנייה", group: "סיווג עסקאות", kind: "boolean", default: true, toggleOnly: true,
    help: "רשות המסים מפרסמת שנת בנייה 0 בחלק מהעסקאות (30% בטירת כרמל, 46% בעכו) — ובלי סיווג, גרף המחירים של אותן ערים עוקב אחרי תמהיל המכירות במקום אחרי השוק. כשמופעל, עסקה בלי שנת בנייה מסווגת לפי שדה \"חוק המכר\" של הרשות עצמה: חוק המכר חל רק על רכישה מקבלן, ולכן 0 = יד שנייה. עסקה שכן יש לה שנת בנייה לא מושפעת כלל. נמדד מול עסקאות עם שנת בנייה: דיוק 83%–93%." },
  { key: "class_use_prev_deals", label: "עסקה קודמת של אותו נכס = יד שנייה", group: "סיווג עסקאות", kind: "boolean", default: true, toggleOnly: true,
    help: "לכל נכס מצורפת היסטוריית העסקאות הקודמות שלו. אם הדירה כבר נמכרה בעבר היא אינה יכולה להיות מכירה ראשונה מקבלן. משמש רק כשגם שנת הבנייה וגם שדה חוק-המכר חסרים. דיוק-חיובי נמדד: 86%–99.6%." },

  // ── room classification by AREA (area is more reliable than the reported room count) ──
  // If a deal's area falls outside the range of its reported room count, the system
  // re-classifies it to the room count whose area-range matches. Fully editable here.
  { key: "room2_area_min", label: "2 חד׳ — שטח מינימלי", group: "סיווג חדרים לפי שטח", kind: "number", default: 35, unit: "מ\"ר",
    help: "טווח השטח התקין לדירת 2 חדרים. עסקה שדווחה כ-2 חד׳ אך שטחה מחוץ לטווח תסווג-מחדש לפי השטח (שטח אמין יותר מדיווח החדרים). מתחת ל-2חד׳-מינ׳ → 1 חדר/סטודיו." },
  { key: "room2_area_max", label: "2 חד׳ — שטח מקסימלי", group: "סיווג חדרים לפי שטח", kind: "number", default: 72, unit: "מ\"ר",
    help: "הגבול העליון של דירת 2 חדרים. הטווחים חופפים בכוונה — כשעסקה נופלת בחפיפה נשמר מספר החדרים שדווח." },
  { key: "room3_area_min", label: "3 חד׳ — שטח מינימלי", group: "סיווג חדרים לפי שטח", kind: "number", default: 55, unit: "מ\"ר",
    help: "הגבול התחתון של דירת 3 חדרים. עסקה שדווחה כ-3 חד׳ ושטחה קטן מכך תסווג-מחדש כלפי מטה." },
  { key: "room3_area_max", label: "3 חד׳ — שטח מקסימלי", group: "סיווג חדרים לפי שטח", kind: "number", default: 85, unit: "מ\"ר",
    help: "הגבול העליון של דירת 3 חדרים. מעליו העסקה מסווגת 4 חדרים." },
  { key: "room4_area_min", label: "4 חד׳ — שטח מינימלי", group: "סיווג חדרים לפי שטח", kind: "number", default: 75, unit: "מ\"ר",
    help: "הגבול התחתון של דירת 4 חדרים — הקטגוריה הנפוצה ביותר בשוק, ולכן הרגישה ביותר לסיווג שגוי." },
  { key: "room4_area_max", label: "4 חד׳ — שטח מקסימלי", group: "סיווג חדרים לפי שטח", kind: "number", default: 130, unit: "מ\"ר",
    help: "הגבול העליון של דירת 4 חדרים. מעליו העסקה מסווגת 5 חדרים." },
  { key: "room5_area_min", label: "5 חד׳ — שטח מינימלי", group: "סיווג חדרים לפי שטח", kind: "number", default: 95, unit: "מ\"ר",
    help: "הגבול התחתון של דירת 5 חדרים." },
  { key: "room5_area_max", label: "5 חד׳ — שטח מקסימלי", group: "סיווג חדרים לפי שטח", kind: "number", default: 145, unit: "מ\"ר",
    help: "הגבול העליון של דירת 5 חדרים. מעליו העסקה מסווגת 6 חדרים." },
  { key: "room6_area_min", label: "6 חד׳ — שטח מינימלי", group: "סיווג חדרים לפי שטח", kind: "number", default: 115, unit: "מ\"ר",
    help: "מעל 6חד׳-מקס׳ → 7 חדרים ומעלה." },
  { key: "room6_area_max", label: "6 חד׳ — שטח מקסימלי", group: "סיווג חדרים לפי שטח", kind: "number", default: 175, unit: "מ\"ר",
    help: "הגבול העליון של דירת 6 חדרים. מעליו העסקה מסווגת 7 חדרים ומעלה." },

  // ── history window ────────────────────────────────────────────────
  { key: "history_from_year", label: "שנת התחלה של עיבוד ההיסטוריה", group: "איכות מדגם", kind: "number", default: 1998,
    help: "כל שלבי הצינור (ניקוי, סיווג, אגרגציה) מעבדים עסקאות מהשנה הזו והלאה. עד 8/2026 הצינור עיבד רק עשור אחורה — והגרפים איבדו 18 שנות היסטוריה שקיימות במאגר. שינוי דורש ריצת pipeline מלאה כדי להשפיע." },

  // ── sample quality ────────────────────────────────────────────────
  { key: "min_deals_per_year", label: "מינימום עסקאות בשנה כדי להציג מחיר", group: "איכות מדגם", kind: "number", default: 10, unit: "עסקאות",
    help: "שנה עם פחות עסקאות מכך לא מקבלת נקודת מחיר בגרפים ובטבלאות." },
  { key: "govmap_only_min_deals", label: "מינימום עסקאות בשנה לקו govmap (ערים ללא כיסוי nadlan)", group: "איכות מדגם", kind: "number", default: 30, unit: "עסקאות",
    help: "בערים שבהן ל-nadlan אין כיסוי, סדרת \"כללי\" נבנית מ-govmap בלבד — מקור אחד לכל העשור, בלי לתפור מקורות (תפירה יוצרת קפיצות מזויפות של עשרות אחוזים). שנה תוצג רק אם יש בה לפחות כך עסקאות govmap." },
  { key: "govmap_only_min_years", label: "מינימום שנים לבחירת קו govmap לעיר", group: "איכות מדגם", kind: "number", default: 8, unit: "שנים",
    help: "עיר עוברת לקו govmap רק אם ל-govmap יש לפחות כך שנים תקינות והוא מכסה יותר שנים מ-nadlan. ההחלטה היא ברמת העיר לכל העשור." },
  { key: "ranking_min_per_scope", label: "מינימום עסקאות מכל סוג לכניסה לדירוג", group: "איכות מדגם", kind: "number", default: 10, unit: "עסקאות",
    help: "נרמול: עיר תיכנס לטבלאות הדירוג רק אם יש לה כך עסקאות מכל סוג (כללי, יד-2, חדשות)." },
  { key: "ranking_normalization_on", label: "הפעלת נרמול הדירוגים", group: "איכות מדגם", kind: "boolean", default: true, toggleOnly: true,
    help: "כשכבוי — כל עיר יכולה להופיע בדירוג, גם עם מדגם זעיר (לא מומלץ)." },
  { key: "city_min_total_deals", label: "מינימום עסקאות לעיר (סה\"כ 10 שנים)", group: "איכות מדגם", kind: "number", default: 150, unit: "עסקאות",
    help: "עיר עם פחות עסקאות פעילות מכך: נצבעת בצהוב בטבלאות (מדגם קטן — לא מייצג) ומוחרגת מכל הדירוגים באתר." },

  // ── sanity filters ────────────────────────────────────────────────
  { key: "min_area", label: "שטח דירה מינימלי", group: "סינון שפיות", kind: "number", default: 20, unit: "מ\"ר", help: "עסקאות מתחת לשטח זה נחשבות מחסן/חניה ולא נכללות." },
  { key: "max_area", label: "שטח דירה מקסימלי", group: "סינון שפיות", kind: "number", default: 500, unit: "מ\"ר", help: "מעל שטח זה — ככל הנראה נכס חריג/שגיאת מקור." },
  { key: "min_sqm_price", label: "מחיר למ\"ר מינימלי", group: "סינון שפיות", kind: "number", default: 2000, unit: "₪", help: "מתחת לזה — קרקע או רישום שגוי." },
  { key: "max_sqm_price", label: "מחיר למ\"ר מקסימלי", group: "סינון שפיות", kind: "number", default: 200000, unit: "₪", help: "מעל לזה — חריג קיצוני שמעוות ממוצעים." },
  { key: "anomaly_deviation_pct", label: "סטיית מחיר שמסמנת אנומליה (יד-2)", group: "אנומליות מחיר", kind: "number", default: 35, unit: "%",
    help: "עסקה שה-₪/מ\"ר שלה חורג ביותר מאחוז זה מה-חציון של אותו טיפוס-דירה (מספר-חדרים לפי שטח × בניין מודרני/ישן) באותה עיר ואותה שנה — מסווגת אנומליית-מחיר ולא נכנסת לממוצעים/גרפים. סימטרי (גם זנב תחתון — חצי-נכס/נומינלי, וגם זנב עליון — שגיאות-שטח). נמוך יותר = מחמיר יותר." },
  { key: "anomaly_large_area", label: "שטח גדול חשוד לעיוות ₪/מ״ר", group: "אנומליות מחיר", kind: "number", default: 120, unit: "מ\"ר",
    help: "עסקה ששטחה המדווח גדול מכך ושחורגת מחציון-הקוהורט שלה מסווגת אנומליה — דירות/בתים גדולים מאוד מעוותים את המחיר-למ״ר. 0 = מבטל את הכלל." },
  { key: "anomaly_city_mult", label: "רשת-ביטחון עירונית לאנומליה (מכפיל מחציון-העיר)", group: "אנומליות מחיר", kind: "number", default: 3, unit: "×",
    help: "רשת-ביטחון לקוהורטים דקים (עיירות קטנות, מספרי-חדרים נדירים) שאין בהם מספיק עסקאות לחציון-טיפוס: עסקה שה-₪/מ\"ר שלה גבוה מפי-כך מחציון העיר×שנה (כל החדרים), או נמוך מחלוקה בכך — מסווגת אנומליה בכל מקרה. תופס מחירים אבסורדיים (שגיאות-שטח) גם כשאין קבוצה מדויקת. רחב בכוונה (מערבב גדלים)." },

  // ── duplicate reports ─────────────────────────────────────────────
  // The tax authority sometimes publishes the SAME sale twice a few days apart
  // (correction/re-publication). Identical price + area + rooms + build-year is
  // effectively impossible by chance, so a repeat inside the window is one deal
  // reported twice — it inflates deal counts and double-weights that price.
  { key: "duplicate_detection_on", label: "הפעלת זיהוי כפילויות-דיווח", group: "כפילויות דיווח", kind: "boolean", default: true, toggleOnly: true,
    help: "כשמופעל — מקבץ של עסקאות זהות לחלוטין בהפרש ימים קצר נחשב דיווח כפול של אותה עסקה; נשמרת רשומה אחת (המפורטת ביותר) והשאר מוחרגות מהספירות ומהממוצעים. כשכבוי — כל הדיווחים נספרים בנפרד." },
  { key: "dupe_window_days", label: "חלון ימים בין דיווחים כפולים", group: "כפילויות דיווח", kind: "number", default: 7, unit: "ימים",
    help: "שתי עסקאות עם מחיר, שטח, מספר חדרים ושנת בנייה זהים שתאריכיהן קרובים עד כך ימים — נחשבות אותה עסקה שדווחה פעמיים. הגדלה תתפוס יותר כפילויות אך עלולה לאחד שתי מכירות אמיתיות של דירות זהות בבניין אחד." },
  { key: "dupe_price_tolerance", label: "סטיית מחיר מותרת בין כפילויות", group: "כפילויות דיווח", kind: "number", default: 0, unit: "₪",
    help: "0 = התאמת מחיר מדויקת (מומלץ — זה מה שהופך את הזיהוי לוודאי). ערך גדול מ-0 יתפוס גם דיווחים מתוקנים שבהם המחיר שונה במעט, במחיר של סיכון לאיחוד עסקאות שונות." },
  { key: "dupe_area_tolerance", label: "סטיית שטח מותרת בין כפילויות", group: "כפילויות דיווח", kind: "number", default: 0, unit: "מ\"ר",
    help: "0 = התאמת שטח מדויקת. כמו סטיית המחיר — הגדלה מרחיבה את הזיהוי ומגדילה את הסיכון לאיחוד שגוי." },
  { key: "dupe_require_same_unit", label: "הגנה: קומה/כתובת שונה = דירה אחרת", group: "כפילויות דיווח", kind: "boolean", default: true, toggleOnly: true,
    help: "בפרויקט קבלן נמכרות דירות זהות לגמרי במחירון זהה באותו שבוע — אלה מכירות אמיתיות ולא דיווח כפול. כשמופעל, מקבץ שבו הקומה או הכתובת שונות בין הרשומות אינו מסומן ככפילות מלאה. נמדד: במקבצים שבהם הדירה זהה בוודאות 82.5% מהדיווחים בהפרש יום אחד (חתימת פרסום-חוזר), ובמקבצים של דירות שונות רק 39.3% — ההגנה מפרידה נכון בין השניים." },
  { key: "dupe_same_building_max", label: "מקסימום עסקאות זהות באותו בניין (שוני בקומה בלבד)", group: "כפילויות דיווח", kind: "number", default: 2, unit: "עסקאות",
    help: "כשכל הפרטים זהים — מחיר, שטח, חדרים, כתובת ואותו שבוע — והשוני היחיד הוא הקומה: עד כך עסקאות נחשבות סבירות (שתי דירות זהות בבניין אחד). מעבר לכך זה כבר לא שוק אלא דיווח כפול, והעודפות מוחרגות. דוגמה שנתפסה: ירושלים ₪2,890,000, 98 מ\"ר, 5 עסקאות בשבוע אחד בקומות שונות." },

  // ── luxury deals ──────────────────────────────────────────────────
  // Two cumulative conditions, per the user's spec: an expensive deal is only an
  // outlier if it is ALSO expensive relative to its own category. A ₪5M penthouse
  // priced like every other 5-room apartment in that city is not a distortion.
  { key: "luxury_filter_on", label: "הפעלת סינון עסקאות יוקרה", group: "עסקאות יוקרה", kind: "boolean", default: true, toggleOnly: true,
    help: "כשמופעל — עסקאות שמקיימות את שני התנאים שלמטה אינן נכנסות לממוצעים, לחציונים ולגרפים. הן ממשיכות להיספר ולהופיע בפירוט העסקאות עם תווית \"יוקרה\" — העסקה קרתה, היא פשוט לא מייצגת את שוק הדיור בעיר." },
  { key: "luxury_min_price", label: "מחיר עסקה שממנו נבדקת יוקרה", group: "עסקאות יוקרה", kind: "number", default: 4_500_000, unit: "₪",
    help: "תנאי ראשון. עסקה מתחת לסכום זה לעולם אינה מסומנת יוקרה, יהיה המחיר למ\"ר אשר יהיה." },
  { key: "luxury_sqm_premium_pct", label: "פער ₪/מ\"ר מעל חציון הקטגוריה", group: "עסקאות יוקרה", kind: "number", default: 20, unit: "%",
    help: "תנאי שני, מצטבר. הקטגוריה = אותה עיר × אותה שנה × אותו מספר חדרים × אותו סוג (יד-שנייה/חדשה). רק אם המחיר למ\"ר גבוה באחוז זה מעל חציון הקטגוריה — העסקה יוקרה. דירה יקרה שהמחיר למ\"ר שלה תקין לקטגוריה שלה נשארת בחישוב." },
  { key: "luxury_min_cohort", label: "מינימום עסקאות בקטגוריה לבסיס השוואה", group: "עסקאות יוקרה", kind: "number", default: 10, unit: "עסקאות",
    help: "קטגוריה עם פחות עסקאות מכך אינה בסיס אמין לחציון — המערכת יורדת לקטגוריה רחבה יותר (עיר×שנה×סוג, ואז עיר×שנה). אם גם אלה דקות מדי, לא מסמנים כלל." },

  // ── deal comparison (/deals) ──────────────────────────────────────
  { key: "comp_years", label: "טווח שנים להשוואת עסקאות", group: "השוואת עסקאות", kind: "number", default: 5, unit: "שנים",
    help: "כמה שנים אחורה נסרקות עסקאות אמת להשוואה מול עסקה שהזנת." },
  { key: "comp_area_tight_pct", label: "סטיית שטח קפדנית", group: "השוואת עסקאות", kind: "number", default: 7, unit: "%",
    help: "ההשוואה הראשונה: אותו מספר חדרים ושטח בטווח הזה." },
  { key: "comp_area_wide_pct", label: "סטיית שטח מורחבת", group: "השוואת עסקאות", kind: "number", default: 20, unit: "%",
    help: "אם אין אף עסקה בטווח הקפדני — מרחיבים עד לטווח הזה." },
  { key: "comp_secondhand_only", label: "השוואה מול יד-שנייה בלבד", group: "השוואת עסקאות", kind: "boolean", default: true, toggleOnly: true,
    help: "מחירי דירות חדשות מקבלן מעוותים השוואה לדירה יד-שנייה. כשמופעל — נכללות רק עסקאות שסווגו יד-שנייה לפי שנת הבנייה." },
  { key: "comp_min_deals", label: "מינימום עסקאות להשוואה", group: "השוואת עסקאות", kind: "number", default: 1, unit: "עסקאות",
    help: "כמה עסקאות דומות מספיקות כדי להציג השוואה." },

  { key: "neighborhood_min_deals", label: "מינימום עסקאות בתא שכונה×שנה", group: "איכות מדגם", kind: "number", default: 8, unit: "עסקאות",
    help: "כמה עסקאות צריכות להיות בשכונה בשנה מסוימת כדי להציג לה מחיר. תא שכונתי קטן בהרבה מתא עירוני, ועסקה חריגה אחת מזיזה אותו — ולכן הסף כאן נפרד." },

  // ── administered prices (מחיר למשתכן) ────────────────────────────
  { key: "subsidized_max_ratio_pct", label: "סף מחיר מנהלי (% מחציון יד-2)", group: "איכות מדגם", kind: "number", default: 65, unit: "%",
    help: "עסקת דירה חדשה שמחירה למ\"ר נמוך מכך ביחס לחציון היד-שנייה באותה עיר ובאותה שנה נחשבת מחיר מנהלי (מחיר למשתכן). 65% נבחר בכוונה ברוחב: הנחת קבלן אמיתית כמעט לא מגיעה ל-35% הנחה, בעוד התוכנית נוחתת דרך קבע על 45-60% הנחה. העסקאות אינן מוחרגות — רק מסומנות." },
  { key: "subsidized_min_share_pct", label: "מתי שנה נחשבת מושפעת", group: "איכות מדגם", kind: "number", default: 25, unit: "%",
    help: "כמה מהעסקאות החדשות בשנה צריכות להיות במחיר מנהלי כדי שהשנה תסומן. שינוי מחיר שנמדד משנה כזו משקף גם שינוי בתמהיל ולא רק בשוק — ולכן מוצגת הערה ליד המספר." },

  // ── credits & access (the 7.8 model — every number editable, no deploy) ──
  { key: "paywall_on", label: "חומת הרשמה על עמודי ערים", group: "קרדיטים וגישה", kind: "boolean", default: true, toggleOnly: true,
    help: "מתג החירום של כל המודל: כבוי = האתר חוזר להתנהגות הפתוחה המלאה (כל עיר לכל גולש, בלי קרדיטים). עמוד הבית והדירוגים פתוחים תמיד." },
  { key: "demo_city", label: "עיר הדמו הפתוחה לכולם", group: "קרדיטים וגישה", kind: "text", default: "חיפה",
    help: "עמוד העיר הזו פתוח גם בלי הרשמה — חלון הראווה של עומק המערכת. חייב להיות שם עיר מדויק כפי שמופיע במאגר." },
  { key: "signup_bonus", label: "קרדיטים בהרשמה", group: "קרדיטים וגישה", kind: "number", default: 10,
    help: "יתרת הפתיחה של חשבון חדש. פתיחת עיר עולה קרדיט אחד לשבוע, כך שהמתנה = ~10 שבועות-עיר." },
  { key: "city_unlock_cost", label: "עלות פתיחת עיר", group: "קרדיטים וגישה", kind: "number", default: 1, unit: "קרדיט",
    help: "מחיר פתיחת עמוד עיר למשתמש רשום. 0 = כל הערים חינם לרשומים (החומה נשארת — רק המחיר יורד)." },
  { key: "unlock_days", label: "משך פתיחת עיר", group: "קרדיטים וגישה", kind: "number", default: 7, unit: "ימים",
    help: "כמה ימים עיר שנפתחה נשארת פתוחה. צפיות חוזרות בתוך החלון — חינם." },
  { key: "deal_save_cost", label: "עלות שמירת עסקה", group: "קרדיטים וגישה", kind: "number", default: 0, unit: "קרדיט",
    help: "מחיר שמירת עסקה ב-/deals. ברירת המחדל 0 בכוונה: שמירת עסקאות היא פעולת ה-retention החזקה ביותר — המחיר קיים כאן למקרה שתרצה להפעיל אותו (תומך בחצאים, למשל 0.5)." },
  { key: "referral_bonus", label: "בונוס הזמנת חבר", group: "קרדיטים וגישה", kind: "number", default: 10, unit: "קרדיטים",
    help: "זיכוי למפנה כשחבר נרשם עם הקוד שלו (מוטמע אוטומטית בקישורי השיתוף). החבר עצמו מקבל את בונוס ההרשמה הרגיל." },
  { key: "referral_daily_cap", label: "תקרת הפניות מזוכות ביום", group: "קרדיטים וגישה", kind: "number", default: 0,
    help: "אנטי-abuse: מעבר לכך הפניות באותו יום לא מזכות (החברים עדיין נרשמים כרגיל). 0 = ללא הגבלה — הזיכוי פר-חבר נשאר חד-פעמי בכל מקרה." },
  { key: "feedback_bonus", label: "בונוס משוב שאושר", group: "קרדיטים וגישה", kind: "number", default: 5, unit: "קרדיטים",
    help: "זיכוי על כל משוב שאישרת בלוח הניהול — לא על עצם השליחה. לא חד-פעמי: כל משוב שאושר מזכה, עד התקרה החודשית." },
  { key: "feedback_monthly_cap", label: "תקרת קרדיטים ממשובים בחודש", group: "קרדיטים וגישה", kind: "number", default: 20, unit: "קרדיטים",
    help: "אנטי-abuse: סך הקרדיטים שמשתמש יכול לצבור ממשובים בחודש קלנדרי. 0 = ללא תקרה." },
  { key: "monthly_free_grant", label: "מענק חודשי למשתמש חינמי", group: "קרדיטים וגישה", kind: "number", default: 2, unit: "קרדיטים",
    help: "הגשר עד השקת המנויים: משתמש שנגמרו לו הקרדיטים לא נתקע לצמיתות. לכבות (0) ביום שהמנויים עולים." },
];

const DEFAULTS = new Map(RULE_DEFS.map((r) => [r.key, r]));

export interface RuleRow { key: string; value: string; enabled: number; updated_at: string }

function ensureTable() {
  appDb().exec(`CREATE TABLE IF NOT EXISTS system_rules (
    key TEXT PRIMARY KEY,
    value TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

let cache: Map<string, RuleRow> | null = null;
let cacheAt = 0;
const TTL_MS = 5_000;

function rows(): Map<string, RuleRow> {
  const now = Date.now();
  if (cache && now - cacheAt < TTL_MS) return cache;
  try {
    ensureTable();
    const all = appDb().prepare("SELECT key, value, enabled, updated_at FROM system_rules").all() as RuleRow[];
    cache = new Map(all.map((r) => [r.key, r]));
  } catch {
    cache = new Map();
  }
  cacheAt = now;
  return cache;
}

export function invalidateRuleCache() { cache = null; cacheAt = 0; }

/**
 * PRECEDENCE — read this before passing `fallback`:
 *   1. the stored override in system_rules (when present and enabled)
 *   2. the default declared in RULE_DEFS
 *   3. the caller's `fallback` — ONLY when the key is absent from RULE_DEFS
 *
 * So for any key that RULE_DEFS declares — which is every key in use — the
 * `fallback` argument is dead. It reads like a default and never behaves as
 * one. Three call sites were written `getRuleNum("secondhand_min_age", 3)` and
 * silently evaluated to 4, which is also where the "≥ 3" claims in the schema
 * comments came from.
 *
 * The precedence itself is correct — RULE_DEFS should win over a scattered
 * literal — so it is documented rather than changed. Prefer omitting
 * `fallback` entirely for known keys; it exists for keys not yet declared.
 */
export function getRuleNum(key: string, fallback?: number): number {
  const def = Number(DEFAULTS.get(key)?.default ?? fallback ?? 0);
  const r = rows().get(key);
  if (!r || r.enabled === 0) return def;
  const v = Number(r.value);
  return Number.isFinite(v) ? v : def;
}

export function getRuleBool(key: string, fallback?: boolean): boolean {
  const def = Boolean(DEFAULTS.get(key)?.default ?? fallback ?? true);
  const r = rows().get(key);
  if (!r) return def;
  return r.enabled === 1;
}

export function getRuleText(key: string, fallback?: string): string {
  const def = String(DEFAULTS.get(key)?.default ?? fallback ?? "");
  const r = rows().get(key);
  if (!r || r.enabled === 0) return def;
  return r.value ?? def;
}

/** Everything the admin screen needs: definition + current effective value. */
export function listRules(): Array<RuleDef & { value: number | boolean | string; enabled: boolean; overridden: boolean }> {
  const cur = rows();
  return RULE_DEFS.map((d) => {
    const r = cur.get(d.key);
    const enabled = r ? r.enabled === 1 : true;
    let value: number | boolean | string = d.default;
    if (r && r.value != null && r.value !== "") {
      value = d.kind === "number" ? Number(r.value) : d.kind === "boolean" ? r.enabled === 1 : r.value;
    } else if (d.kind === "boolean") {
      value = enabled;
    }
    return { ...d, value, enabled, overridden: !!r };
  });
}

export function setRule(key: string, value: string, enabled: boolean) {
  ensureTable();
  appDb().prepare(
    `INSERT INTO system_rules (key, value, enabled, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, enabled=excluded.enabled, updated_at=CURRENT_TIMESTAMP`
  ).run(key, value, enabled ? 1 : 0);
  invalidateRuleCache();
}

export function resetRule(key: string) {
  ensureTable();
  appDb().prepare("DELETE FROM system_rules WHERE key=?").run(key);
  invalidateRuleCache();
}

/** Timestamp of the newest rule change — used for the "apply changes" banner. */
export function lastRuleChange(): string | null {
  try {
    const r = appDb().prepare("SELECT MAX(updated_at) m FROM system_rules").get() as any;
    return r?.m ?? null;
  } catch { return null; }
}
