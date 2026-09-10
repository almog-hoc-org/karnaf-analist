/**
 * The year the neighbourhood table and the map describe.
 *
 * MEASURED 10.9.2026, טירת כרמל: in September the newest year (2026) had two
 * neighbourhoods over the sample floor and 2025 had nine. Taking the newest
 * year blindly showed a two-row table and failed the map's three-neighbourhood
 * gate, so a city with eleven drawn neighbourhoods showed no map at all.
 *
 * Rule: the newest year in which at least `minHoods` neighbourhoods have a
 * usable cell, looking at most `lookback` years behind the newest. Every year
 * thin → the newest year, as before (a small place is still shown, just thin).
 */
export function pickReferenceYear(
  cells: ReadonlyArray<{ neighborhood: string; year: number }>,
  minHoods: number,
  lookback = 2
): number {
  const hoodsByYear = new Map<number, Set<string>>();
  for (const c of cells) {
    if (!hoodsByYear.has(c.year)) hoodsByYear.set(c.year, new Set());
    hoodsByYear.get(c.year)!.add(c.neighborhood);
  }
  const newest = Math.max(...hoodsByYear.keys());
  for (let y = newest; y >= newest - lookback; y--) {
    if ((hoodsByYear.get(y)?.size ?? 0) >= minHoods) return y;
  }
  return newest;
}
