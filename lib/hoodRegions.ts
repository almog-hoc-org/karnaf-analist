/**
 * Neighbourhood regions from the deals themselves — the map source that does
 * not depend on anyone having drawn the neighbourhood.
 *
 * MEASURED 7.9.2026: of 73 cities with priced neighbourhoods, OpenStreetMap
 * holds usable neighbourhood POLYGONS for seven. Elsewhere the neighbourhoods
 * are points, or absent, or named differently from the Tax Authority's list
 * the site runs on — and the collector could not draw a map at all.
 *
 * But every deal already says which neighbourhood it is in, in exactly the
 * spelling the site uses, and the address campaign plus the geocode imports
 * have put a coordinate under a good share of those deals. So the region of
 * a neighbourhood can be READ OFF THE DATA: the ground near buildings that
 * sold as "פלורנטין" is פלורנטין. This module does that, in three steps that
 * are all pure and tested:
 *
 *   1. labelGrid — a raster over the map frame; every cell takes the label of
 *      the majority among its k nearest buildings, or stays empty when the
 *      nearest building is too far (the sea, the fields, the next town).
 *      Majority voting is what makes one mis-geocoded building harmless.
 *   2. traceRegions — the outline of every label's cells, as closed rings
 *      (cell-edge following; holes come out with opposite winding, which the
 *      SVG nonzero rule renders as holes).
 *   3. smoothRing / buildHoodShapes — corner cutting and Douglas-Peucker, so
 *      the staircase of a raster becomes a shape that reads as a map.
 *
 * Coordinates are the map's own 0..1000 projected units throughout, so the
 * result drops straight into neighborhood_shapes beside the OSM polygons.
 */
import { simplifyRing, ringCentroid, VIEW_SIZE, type Point, type Ring } from "./geo";

export interface LabelledPoint { x: number; y: number; hood: number }

export interface GridOptions {
  /** cells per side of the raster (default 240 → ~4 units per cell) */
  size?: number;
  /** neighbours that vote for a cell's label */
  k?: number;
  /** a cell farther than this (projected units) from its nearest building is empty */
  maxDist?: number;
}

export interface LabelGrid { size: number; cell: number; labels: Int16Array }

/** Median distance from a point to its nearest other point — the density the empty threshold is derived from. */
export function medianNearestDistance(points: LabelledPoint[]): number {
  if (points.length < 2) return 0;
  const d: number[] = [];
  const bucket = 25;
  const idx = bucketIndex(points, bucket);
  for (const p of points) {
    let best = Infinity;
    for (const q of neighbours(idx, bucket, p.x, p.y, 1)) {
      if (q === p) continue;
      const dd = Math.hypot(q.x - p.x, q.y - p.y);
      if (dd < best) best = dd;
    }
    if (Number.isFinite(best)) d.push(best);
  }
  if (!d.length) return 0;
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)];
}

/** The empty threshold: a few typical building gaps, never absurdly tight or loose. */
export function defaultMaxDist(points: LabelledPoint[]): number {
  const m = medianNearestDistance(points);
  return Math.min(30, Math.max(8, m * 4));
}

type Index = Map<string, LabelledPoint[]>;
function bucketIndex(points: LabelledPoint[], bucket: number): Index {
  const idx: Index = new Map();
  for (const p of points) {
    const key = `${Math.floor(p.x / bucket)},${Math.floor(p.y / bucket)}`;
    const arr = idx.get(key);
    if (arr) arr.push(p); else idx.set(key, [p]);
  }
  return idx;
}
function* neighbours(idx: Index, bucket: number, x: number, y: number, ring: number): Generator<LabelledPoint> {
  const bx = Math.floor(x / bucket), by = Math.floor(y / bucket);
  for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) {
    const arr = idx.get(`${bx + i},${by + j}`);
    if (arr) yield* arr;
  }
}

export function labelGrid(points: LabelledPoint[], opts: GridOptions = {}): LabelGrid {
  const size = opts.size ?? 240;
  const k = opts.k ?? 5;
  const maxDist = opts.maxDist ?? defaultMaxDist(points);
  const cell = VIEW_SIZE / size;
  const labels = new Int16Array(size * size).fill(-1);
  if (!points.length) return { size, cell, labels };
  // bucket = maxDist, so everything within maxDist of a cell centre lies in
  // the 3×3 buckets around it
  const bucket = maxDist;
  const idx = bucketIndex(points, bucket);
  const cand: Array<{ d: number; hood: number }> = [];
  for (let r = 0; r < size; r++) {
    const cy = (r + 0.5) * cell;
    for (let c = 0; c < size; c++) {
      const cx = (c + 0.5) * cell;
      cand.length = 0;
      for (const p of neighbours(idx, bucket, cx, cy, 1)) {
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (d <= maxDist) cand.push({ d, hood: p.hood });
      }
      if (!cand.length) continue;
      cand.sort((a, b) => a.d - b.d);
      const votes = new Map<number, number>();
      for (const q of cand.slice(0, k)) votes.set(q.hood, (votes.get(q.hood) ?? 0) + 1);
      // majority; a tie goes to the nearest of the tied
      let best = -1, bestVotes = 0;
      for (const q of cand.slice(0, k)) {
        const v = votes.get(q.hood)!;
        if (v > bestVotes) { best = q.hood; bestVotes = v; }
      }
      labels[r * size + c] = best;
    }
  }
  return { size, cell, labels };
}

/** Signed area (shoelace); positive = clockwise in screen coordinates (y down). */
export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

/**
 * The outline of every label's cells, as closed rings in projected units.
 * Each inside cell contributes its exposed edges, oriented clockwise around
 * the region; the edges are then linked end to start into loops. A region's
 * outer boundary comes out clockwise and its holes counterclockwise, which
 * is exactly what the nonzero fill rule needs.
 */
export function traceRegions(grid: LabelGrid, hoodCount: number, minCells = 6): Map<number, Ring[]> {
  const { size, cell, labels } = grid;
  const at = (r: number, c: number) => (r < 0 || c < 0 || r >= size || c >= size ? -1 : labels[r * size + c]);
  const out = new Map<number, Ring[]>();
  for (let h = 0; h < hoodCount; h++) {
    // directed edges keyed by start corner "c,r"
    const edges = new Map<string, Array<[number, number, number, number]>>();
    const add = (c0: number, r0: number, c1: number, r1: number) => {
      const key = `${c0},${r0}`;
      const arr = edges.get(key);
      const e: [number, number, number, number] = [c0, r0, c1, r1];
      if (arr) arr.push(e); else edges.set(key, [e]);
    };
    let cells = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (at(r, c) !== h) continue;
      cells++;
      if (at(r - 1, c) !== h) add(c, r, c + 1, r);         // top, going right
      if (at(r, c + 1) !== h) add(c + 1, r, c + 1, r + 1); // right, going down
      if (at(r + 1, c) !== h) add(c + 1, r + 1, c, r + 1); // bottom, going left
      if (at(r, c - 1) !== h) add(c, r + 1, c, r);         // left, going up
    }
    if (cells < minCells) continue;
    const rings: Ring[] = [];
    for (const [, list] of edges) {
      while (list.length) {
        const first = list.pop()!;
        const ring: Ring = [[first[0], first[1]]];
        let cur = first;
        for (let guard = 0; guard < size * size * 4; guard++) {
          const key = `${cur[2]},${cur[3]}`;
          const next = edges.get(key);
          if (!next || !next.length) break;
          // at a saddle corner prefer the edge that turns right (keeps the loop tight)
          let pick = 0;
          if (next.length > 1) {
            const dx = cur[2] - cur[0], dy = cur[3] - cur[1];
            for (let i = 0; i < next.length; i++) {
              const ex = next[i][2] - next[i][0], ey = next[i][3] - next[i][1];
              if (dx * ey - dy * ex > 0) { pick = i; break; }
            }
          }
          cur = next.splice(pick, 1)[0];
          ring.push([cur[0], cur[1]]);
          if (cur[2] === first[0] && cur[3] === first[1]) break;
        }
        ring.push([first[0], first[1]]);
        if (ring.length >= 4) rings.push(ring.map(([c, r]) => [c * cell, r * cell] as Point));
      }
    }
    if (rings.length) out.set(h, rings);
  }
  return out;
}

/** One round of Chaikin corner cutting on a closed ring — the staircase softens without moving the shape. */
export function smoothRing(ring: Ring): Ring {
  if (ring.length < 4) return ring;
  const open = ring.slice(0, -1);
  const out: Ring = [];
  for (let i = 0; i < open.length; i++) {
    const p = open[i], q = open[(i + 1) % open.length];
    out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]]);
    out.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
  }
  out.push(out[0]);
  return out;
}

export interface HoodShape { hood: string; rings: Ring[]; cx: number; cy: number; points: number; cells: number }

export interface BuildOptions extends GridOptions {
  /** a neighbourhood with fewer placed buildings than this is not drawn */
  minPoints?: number;
  /** rings smaller than this many cells are speckle */
  minCells?: number;
}

/**
 * From labelled buildings to drawable shapes. `hoods[i]` is the name of label i.
 * Rings are sorted largest first, and a shape whose largest ring is tiny is
 * dropped — a neighbourhood that is only speckle has no region to show.
 */
export function buildHoodShapes(points: LabelledPoint[], hoods: string[], opts: BuildOptions = {}): HoodShape[] {
  const minPoints = opts.minPoints ?? 12;
  const counts = new Map<number, number>();
  for (const p of points) counts.set(p.hood, (counts.get(p.hood) ?? 0) + 1);
  const eligible = points.filter((p) => (counts.get(p.hood) ?? 0) >= minPoints);
  if (!eligible.length) return [];
  const grid = labelGrid(eligible, opts);
  const minCells = opts.minCells ?? 6;
  const regions = traceRegions(grid, hoods.length, minCells);
  const cellArea = grid.cell * grid.cell;
  const shapes: HoodShape[] = [];
  for (const [h, raw] of regions) {
    const rings = raw
      .filter((r) => Math.abs(ringArea(r)) >= minCells * cellArea)
      .map((r) => simplifyRing(smoothRing(r), grid.cell * 0.6))
      .filter((r): r is Ring => r !== null)
      .sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
    if (!rings.length) continue;
    const [cx, cy] = ringCentroid(rings[0]);
    let cells = 0;
    for (let i = 0; i < grid.labels.length; i++) if (grid.labels[i] === h) cells++;
    shapes.push({ hood: hoods[h], rings, cx, cy, points: counts.get(h) ?? 0, cells });
  }
  return shapes.sort((a, b) => b.cells - a.cells);
}
