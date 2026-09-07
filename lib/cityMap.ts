/**
 * The neighbourhood map's data: shapes from the collector, prices from the
 * aggregation, and the join between them.
 *
 * THE JOIN IS THE WHOLE PROBLEM. Price rows are keyed by the neighbourhood
 * name as the Tax Authority wrote it; shapes are keyed by OpenStreetMap's
 * `name` for the same place. They do not match one-for-one — a hyphen, a
 * geresh, a doubled yod. normHoodKey (lib/hoodKey.ts) exists for exactly this
 * and is used by both sides, so the two can never drift apart.
 *
 * NEITHER SIDE DISAPPEARS QUIETLY. A shape with no price is drawn in grey and
 * says so; a price with no shape stays in the table. The alternative — showing
 * only what matched — turns a join failure into what looks like a city with no
 * deals in half its neighbourhoods.
 */
import { prisma } from "./db";
import { cachedMarket } from "./cache";
import { normHoodKey } from "./hoodKey";
import { getRuleNum } from "./systemRules";
import type { NeighborhoodSummary } from "./neighborhoods";
import type { BBox } from "./geo";

export interface MapShape {
  neighborhood: string;
  normName: string;
  path: string;
  cx: number;
  cy: number;
}

export interface MapLine {
  kind: "road" | "water" | "coast";
  rank: number;
  name: string | null;
  path: string;
  length: number;
}

export interface CityMapGeometry {
  shapes: MapShape[];
  lines: MapLine[];
  /**
   * The PADDED lon/lat box the collector handed to makeProjector — the one
   * transform every stored path went through. A deal's lon/lat projected
   * through makeProjector(bbox) with the default pad lands exactly on the
   * shapes; through anything else it slides off them. null when the
   * collector has not written city_map_meta (older fixtures).
   */
  bbox: BBox | null;
}

/** A shape joined to its price row, ready to draw. */
export interface MappedNeighborhood {
  neighborhood: string;
  path: string;
  cx: number;
  cy: number;
  /** null when the shape exists but no price row cleared the sample floor. */
  summary: NeighborhoodSummary | null;
  /** 0..4, or null with no price. Deeper = more expensive. */
  bin: number | null;
}

export interface CityMapView {
  neighborhoods: MappedNeighborhood[];
  lines: MapLine[];
  /** ₪/m² boundaries of the five bins, for the legend. */
  binEdges: number[];
  matched: number;
  /** Price rows with no shape — they stay in the table; the header says how many. */
  unmatchedPriced: string[];
}

/* Missing tables mean the collector has not run for this city, which is the
 * normal state for every city outside the pilot. Same shape as
 * lib/neighborhoods: degrade to empty, never throw. */
async function loadGeometryUncached(cityName: string): Promise<CityMapGeometry> {
  let shapes: MapShape[] = [];
  let lines: MapLine[] = [];
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      neighborhood: string; norm_name: string; path_d: string; cx: number | null; cy: number | null;
    }>>(
      `SELECT neighborhood, norm_name, path_d, cx, cy FROM neighborhood_shapes WHERE city_name = ?`,
      cityName
    );
    shapes = rows.map((r) => ({
      neighborhood: r.neighborhood,
      normName: r.norm_name,
      path: r.path_d,
      cx: Number(r.cx ?? 0),
      cy: Number(r.cy ?? 0),
    }));
  } catch { /* collector has not run */ }
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      kind: string; rank: number; name: string | null; path_d: string; length: number | null;
    }>>(
      `SELECT kind, rank, name, path_d, length FROM city_map_lines WHERE city_name = ? ORDER BY rank`,
      cityName
    );
    lines = rows.map((r) => ({
      kind: r.kind as MapLine["kind"],
      rank: Number(r.rank),
      name: r.name,
      path: r.path_d,
      length: Number(r.length ?? 0),
    }));
  } catch { /* collector has not run */ }
  let bbox: BBox | null = null;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      min_lon: number | null; min_lat: number | null; max_lon: number | null; max_lat: number | null;
    }>>(`SELECT min_lon, min_lat, max_lon, max_lat FROM city_map_meta WHERE city_name = ?`, cityName);
    const m = rows[0];
    if (m && m.min_lon != null && m.min_lat != null && m.max_lon != null && m.max_lat != null) {
      bbox = { minLon: Number(m.min_lon), minLat: Number(m.min_lat), maxLon: Number(m.max_lon), maxLat: Number(m.max_lat) };
    }
  } catch { /* collector has not run */ }
  return { shapes, lines, bbox };
}

export const loadCityMapGeometry = cachedMarket(loadGeometryUncached, ["city-map-geometry"]);

/** A local street (rank 6–7) with its extent, so a box on screen can pick its own. */
export interface MapStreet extends MapLine {
  minx: number; miny: number; maxx: number; maxy: number;
}

async function loadStreetsUncached(cityName: string): Promise<MapStreet[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      rank: number; name: string | null; path_d: string; length: number | null; minx: number; miny: number; maxx: number; maxy: number;
    }>>(`SELECT rank, name, path_d, length, minx, miny, maxx, maxy FROM city_map_streets WHERE city_name = ?`, cityName);
    return rows.map((r) => ({
      kind: "road", rank: Number(r.rank), name: r.name, path: r.path_d, length: Number(r.length ?? 0),
      minx: Number(r.minx), miny: Number(r.miny), maxx: Number(r.maxx), maxy: Number(r.maxy),
    }));
  } catch { return []; }
}

/** The whole city's local streets, cached; the route slices them per box. */
export const loadCityStreets = cachedMarket(loadStreetsUncached, ["city-streets"]);

/** The streets whose extent crosses the box — pure, so it is tested. */
export function streetsInBox<T extends { minx: number; miny: number; maxx: number; maxy: number }>(
  streets: T[], box: { x: number; y: number; w: number; h: number }
): T[] {
  const x1 = box.x + box.w, y1 = box.y + box.h;
  return streets.filter((s) => s.maxx >= box.x && s.minx <= x1 && s.maxy >= box.y && s.miny <= y1);
}

/**
 * Five bins over the city's OWN neighbourhoods.
 *
 * Quantiles, not fixed shekel thresholds: ₪22,000/m² is expensive in Beer Sheva
 * and cheap in Tel Aviv, and an absolute scale paints a whole city one shade
 * and says nothing. Quantiles guarantee the map uses its full range in every
 * city, which is the only way the colour carries information.
 *
 * Exported for the tests — the edge cases (one neighbourhood, all-equal prices)
 * are exactly where a naive quantile divides by zero or emits NaN.
 */
export function priceBins(values: number[], count = 5): number[] {
  const sorted = [...values].filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const edges: number[] = [];
  for (let i = 1; i < count; i++) {
    const idx = (sorted.length - 1) * (i / count);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    edges.push(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
  }
  return edges;
}

/** Which bin a value falls in, given the edges from priceBins. */
export function binOf(value: number, edges: number[]): number {
  let i = 0;
  while (i < edges.length && value >= edges[i]) i++;
  return i;
}

/** The two thresholds that decide whether a city gets a map at all. */
export function mapMinNeighborhoods(): number {
  return getRuleNum("map_min_neighborhoods", 3);
}
export function mapMinMatchRatio(): number {
  return getRuleNum("map_min_match_ratio", 0.5);
}

/**
 * Join shapes to prices and decide whether the result is worth showing.
 *
 * Returns null when it is not: a map missing most of its city reads as "no
 * deals over there", which is a stronger and wronger claim than showing no map.
 */
export function buildCityMap(
  geometry: CityMapGeometry,
  summaries: NeighborhoodSummary[]
): CityMapView | null {
  if (geometry.shapes.length === 0) return null;

  const byKey = new Map<string, NeighborhoodSummary>();
  for (const s of summaries) byKey.set(normHoodKey(s.neighborhood), s);

  const usedKeys = new Set<string>();
  const edges = priceBins(summaries.map((s) => s.sqm));

  const neighborhoods: MappedNeighborhood[] = geometry.shapes.map((shape) => {
    let summary = byKey.get(shape.normName) ?? null;
    if (!summary) {
      // Second pass: one name contains the other ("פלורנטין" vs "צפון
      // פלורנטין"). Only accepted when exactly ONE price row is a candidate —
      // an ambiguous containment would attach the wrong price to a shape, and
      // a wrong number on a map is worse than a grey one.
      const candidates = [...byKey.entries()].filter(
        ([k]) => !usedKeys.has(k) && (k.includes(shape.normName) || shape.normName.includes(k))
      );
      if (candidates.length === 1) summary = candidates[0][1];
    }
    if (summary) usedKeys.add(normHoodKey(summary.neighborhood));
    return {
      neighborhood: shape.neighborhood,
      path: shape.path,
      cx: shape.cx,
      cy: shape.cy,
      summary,
      bin: summary ? binOf(summary.sqm, edges) : null,
    };
  });

  const matched = neighborhoods.filter((n) => n.summary).length;
  const unmatchedPriced = summaries
    .filter((s) => !usedKeys.has(normHoodKey(s.neighborhood)))
    .map((s) => s.neighborhood);

  if (matched < mapMinNeighborhoods()) return null;
  if (summaries.length > 0 && matched / summaries.length < mapMinMatchRatio()) return null;

  return { neighborhoods, lines: geometry.lines, binEdges: edges, matched, unmatchedPriced };
}
