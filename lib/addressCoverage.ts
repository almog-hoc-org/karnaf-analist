/**
 * Where exact addresses come from, and since when.
 *
 * Street + house number ride on two channels: the govmap feed (2016+, partial)
 * and the nadlan.gov.il capture, which an anonymous session only opens for the
 * last 60 months — the campaign of 4–5.9.2026 therefore starts at 9/2021.
 * Deals before that mostly carry no street at all (~370k rows), and every page
 * that shows a building or a street history has to say so once, in one
 * sentence, or the gap reads as a bug.
 */
export const ADDRESS_COVERAGE_FROM = "9/2021";

/** One sentence for the reader, shared by /check, the building page and the street page. */
export const ADDRESS_COVERAGE_NOTE =
  `כתובות מדויקות (רחוב ומספר) קיימות במאגר לעסקאות מ-${ADDRESS_COVERAGE_FROM} ואילך; עסקאות ותיקות יותר נספרות בסטטיסטיקת השכונה והעיר, אך לא ניתן לשייך אותן לבניין.`;
