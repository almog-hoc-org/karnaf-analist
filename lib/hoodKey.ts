/**
 * The one way this project compares two neighbourhood names.
 *
 * WHY IT EXISTS — MEASURED, NOT GUESSED
 * govmap is inconsistent about the same neighbourhood: `"הצפון הישן-החלק
 * הצפוני"` with a hyphen where a hand-written pattern used a space. Under an
 * exact match that difference dropped roughly 10,000 Tel Aviv transactions into
 * the "other" bucket. Collapsing hyphen↔space, stripping quotes and geresh, and
 * unifying doubled יי/וו is what fixed it.
 *
 * It now has a second caller, and that is why it moved out of
 * lib/city-subareas.ts into a file of its own: the neighbourhood MAP has to
 * join OpenStreetMap's `name` to the Tax Authority's spelling of the same
 * place, which is the identical problem. Two normalisers would drift, and the
 * drift would show up as a neighbourhood that has a shape but no price, or a
 * price but no shape — silently, on one city, months later.
 */
export function normHoodKey(s: string): string {
  return s
    .replace(/["'`׳״]/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/יי/g, "י")
    .replace(/וו/g, "ו")
    .replace(/\s+/g, " ")
    .trim();
}
