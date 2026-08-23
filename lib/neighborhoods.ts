import { prisma } from "./db";
import { cachedMarket } from "./cache";
import { getRuleNum } from "./systemRules";

/**
 * Neighbourhood price levels, from `neighborhood_year_stats` (written by the
 * aggregation, in the same transaction as the city stats).
 *
 * WHAT THIS ANSWERS
 * "Which part of this city is expensive, and which part is moving." Until now
 * the site could answer that for the country and for the city and then stopped
 * — while the aggregation was computing every neighbourhood's median on every
 * run to build the mix-adjusted series, and discarding it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not rank a neighbourhood the site has thin data for. Every figure
 * here carries its own n, the caller shows it, and a cell under the admin floor
 * was never written in the first place.
 *
 * Missing table (before the aggregation has run with this stage) degrades to an
 * empty list, exactly like the behaviour that shipped before it existed.
 */

export interface NeighborhoodCell {
  neighborhood: string;
  year: number;
  sqm: number | null;
  medianSqm: number | null;
  medianPrice: number | null;
  n: number;
}

export interface NeighborhoodSummary {
  neighborhood: string;
  /** latest year with a usable cell */
  year: number;
  sqm: number;
  n: number;
  /** % change vs the comparison year, when both ends exist */
  changePct: number | null;
  fromYear: number | null;
}

async function loadCellsUncached(
  cityName: string,
  scope: "all" | "secondhand"
): Promise<NeighborhoodCell[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      neighborhood: string; year: number; avg_sqm: number | null;
      median_sqm: number | null; median_price: number | null; n: number;
    }>>(
      `SELECT neighborhood, year, avg_sqm, median_sqm, median_price, n
         FROM neighborhood_year_stats
        WHERE city_name = ? AND scope = ? AND room_bucket = 'all'
        ORDER BY neighborhood, year`,
      cityName,
      scope
    );
    return rows.map((r) => ({
      neighborhood: r.neighborhood,
      year: Number(r.year),
      sqm: r.avg_sqm === null ? null : Number(r.avg_sqm),
      medianSqm: r.median_sqm === null ? null : Number(r.median_sqm),
      medianPrice: r.median_price === null ? null : Number(r.median_price),
      n: Number(r.n),
    }));
  } catch {
    return []; // aggregation has not written the table yet
  }
}

export const loadNeighborhoodCells = cachedMarket(loadCellsUncached, ["neighborhood-cells"]);

/**
 * One row per neighbourhood: latest level and change over `years`, plus the
 * city's own level in the reference year.
 *
 * `citySqm` is computed from THESE cells rather than from
 * nadlan_year_room_stats on purpose. The two tables share a source but not a
 * population — a city figure includes deals with no neighbourhood recorded —
 * so a city number shown beside these rows has to come from the same rows, or
 * the header quietly describes a different set of deals than the table does.
 */
export async function neighborhoodSummary(
  cityName: string,
  opts: { scope?: "all" | "secondhand"; years?: number } = {}
): Promise<{ rows: NeighborhoodSummary[]; year: number | null; citySqm: number | null }> {
  const scope = opts.scope ?? "secondhand";
  const span = opts.years ?? 3;
  const cells = await loadNeighborhoodCells(cityName, scope);
  if (!cells.length) return { rows: [], year: null, citySqm: null };

  const usable = cells.filter((c) => c.sqm != null && c.sqm > 0);
  if (!usable.length) return { rows: [], year: null, citySqm: null };

  // The latest year the city as a whole has coverage in — not each
  // neighbourhood's own latest, which would compare 2026 against 2021.
  const refYear = Math.max(...usable.map((c) => c.year));
  const atRef = usable.filter((c) => c.year === refYear);
  if (!atRef.length) return { rows: [], year: null, citySqm: null };

  const totalN = atRef.reduce((s, c) => s + c.n, 0);
  const citySqm = totalN > 0 ? atRef.reduce((s, c) => s + c.sqm! * c.n, 0) / totalN : null;

  const fromYear = refYear - span;
  const byNb = new Map<string, NeighborhoodCell[]>();
  for (const c of usable) byNb.set(c.neighborhood, [...(byNb.get(c.neighborhood) ?? []), c]);

  const rows: NeighborhoodSummary[] = [];
  for (const c of atRef) {
    const hist = byNb.get(c.neighborhood) ?? [];
    const base = hist.find((h) => h.year === fromYear) ?? null;
    rows.push({
      neighborhood: c.neighborhood,
      year: refYear,
      sqm: c.sqm!,
      n: c.n,
      changePct: base ? (c.sqm! / base.sqm! - 1) * 100 : null,
      fromYear: base ? base.year : null,
    });
  }
  rows.sort((a, b) => b.sqm - a.sqm);
  return { rows, year: refYear, citySqm };
}

/** The floor a cell had to clear to exist at all — shown next to the table. */
export function neighborhoodMinDeals(): number {
  return getRuleNum("neighborhood_min_deals", 8);
}
