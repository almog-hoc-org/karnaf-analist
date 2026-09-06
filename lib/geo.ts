/**
 * The geometry the neighbourhood map runs on — projection, simplification and
 * the bounding box that ties the layers together.
 *
 * EVERYTHING HERE IS PURE AND RUNS AT COLLECT TIME, NOT AT RENDER TIME.
 * A city's outline does not change between page views, so projecting and
 * simplifying it on every request would be the same arithmetic, repeated, for
 * every visitor. The collector runs these once and stores the result as numbers
 * that go straight into an SVG `path`.
 *
 * The other half of the reason is size: an OpenStreetMap ring can carry
 * thousands of points, and a city has hundreds of streets. Unsimplified, one
 * city's map is megabytes of coordinates for a picture 800 pixels wide, where
 * a point every few metres is invisible. Simplification is the single biggest
 * lever on what this feature costs a reader.
 */

/** [lon, lat] — the order GeoJSON and Overpass use. */
export type LonLat = [number, number];
/** [x, y] in the projected, normalised space. */
export type Point = [number, number];
export type Ring = Point[];

export interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** The side of the square every city is normalised into. */
export const VIEW_SIZE = 1000;

/**
 * Web Mercator, without the earth-radius scaling — only the SHAPE matters
 * here, because the result is immediately normalised into a fixed box.
 *
 * Latitude has to go through the Mercator transform rather than being used
 * raw: at Israel's latitude a degree of longitude is about 0.83 of a degree of
 * latitude on the ground, and plotting raw degrees on both axes stretches
 * every city ~20% north-south. Tel Aviv drawn that way is recognisably the
 * wrong shape.
 */
export function project([lon, lat]: LonLat): Point {
  const x = (lon * Math.PI) / 180;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const y = Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
  return [x, y];
}

/** Grow a bbox to include a point. Start from `emptyBBox()`. */
export function emptyBBox(): BBox {
  return { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
}

export function extendBBox(b: BBox, [lon, lat]: LonLat): BBox {
  return {
    minLon: Math.min(b.minLon, lon),
    minLat: Math.min(b.minLat, lat),
    maxLon: Math.max(b.maxLon, lon),
    maxLat: Math.max(b.maxLat, lat),
  };
}

export function bboxIsEmpty(b: BBox): boolean {
  return !Number.isFinite(b.minLon) || !Number.isFinite(b.minLat) || b.maxLon < b.minLon || b.maxLat < b.minLat;
}

/**
 * A function that maps a lon/lat onto the 0..VIEW_SIZE box for ONE city.
 *
 * Built once from the city's bbox and then used for every layer, which is the
 * point: the streets and the neighbourhood outlines only line up if they were
 * placed by the same transform. Two layers projected against their own extents
 * would each fill the box and slide against each other.
 *
 * Aspect ratio is preserved and the shorter axis is centred, so a long thin
 * city is not stretched to a square. Y is flipped because SVG counts downward
 * while latitude counts up.
 */
export function makeProjector(bbox: BBox, pad = 0.02): (p: LonLat) => Point {
  const [x0, y0] = project([bbox.minLon, bbox.minLat]);
  const [x1, y1] = project([bbox.maxLon, bbox.maxLat]);
  const w = x1 - x0;
  const h = y1 - y0;
  // A degenerate extent (one point, or a city with a single node) would divide
  // by zero and emit NaN into every path. Fall back to the centre of the box.
  if (!(w > 0) || !(h > 0)) return () => [VIEW_SIZE / 2, VIEW_SIZE / 2];

  const inner = VIEW_SIZE * (1 - pad * 2);
  const scale = Math.min(inner / w, inner / h);
  const offX = (VIEW_SIZE - w * scale) / 2;
  const offY = (VIEW_SIZE - h * scale) / 2;

  return (p: LonLat) => {
    const [px, py] = project(p);
    return [
      round2(offX + (px - x0) * scale),
      round2(VIEW_SIZE - (offY + (py - y0) * scale)), // SVG y grows downward
    ];
  };
}

/** Two decimals is ~0.1px at this scale — below what a screen can show, and it
 *  roughly halves the JSON compared with full float precision. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The exact inverse of makeProjector(bbox, pad): view units → lon/lat.
 *
 * Nothing on a live page needs this — pins are placed by projecting, not the
 * other way round. It exists so the fixture can invent a deal INSIDE a drawn
 * rectangle and store a real-looking lon/lat for it, and so a test can prove
 * that a point sent through both functions comes back where it started.
 */
export function makeUnprojector(bbox: BBox, pad = 0.02): (p: Point) => LonLat {
  const [x0, y0] = project([bbox.minLon, bbox.minLat]);
  const [x1, y1] = project([bbox.maxLon, bbox.maxLat]);
  const w = x1 - x0;
  const h = y1 - y0;
  if (!(w > 0) || !(h > 0)) return () => [bbox.minLon, bbox.minLat];
  const inner = VIEW_SIZE * (1 - pad * 2);
  const scale = Math.min(inner / w, inner / h);
  const offX = (VIEW_SIZE - w * scale) / 2;
  const offY = (VIEW_SIZE - h * scale) / 2;
  return ([vx, vy]: Point) => {
    const px = x0 + (vx - offX) / scale;
    const py = y0 + (VIEW_SIZE - vy - offY) / scale;
    const lon = (px * 180) / Math.PI;
    const lat = ((2 * Math.atan(Math.exp(py)) - Math.PI / 2) * 180) / Math.PI;
    return [lon, lat];
  };
}

/** Axis-aligned bounds in view units. */
export interface ViewBox { x: number; y: number; w: number; h: number }

/**
 * Bounds of a stored path string ("M1,2L3,4Z…"). Reads the numbers back out
 * of the `d` the collector wrote — the same trick components/CityMap.tsx uses
 * to place a road label — so a shape's extent never has to be stored twice.
 */
export function pathBBox(pathD: string): ViewBox | null {
  const nums = pathD.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 4) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = parseFloat(nums[i]), y = parseFloat(nums[i + 1]);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The viewBox to zoom a map to one shape: square (so pins keep their aspect),
 * padded so the outline is not glued to the frame, never smaller than `min`
 * (a tiny shape zoomed to fill the canvas would show one street at a scale
 * where every pin is a boulder), and clamped to the 0..VIEW_SIZE canvas.
 */
export function zoomViewBox(b: ViewBox, opts: { pad?: number; min?: number } = {}): ViewBox {
  const pad = opts.pad ?? 0.15;
  const min = opts.min ?? 120;
  const side = Math.min(VIEW_SIZE, Math.max(min, Math.max(b.w, b.h) * (1 + pad * 2)));
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const x = Math.max(0, Math.min(VIEW_SIZE - side, cx - side / 2));
  const y = Math.max(0, Math.min(VIEW_SIZE - side, cy - side / 2));
  return { x: round2(x), y: round2(y), w: round2(side), h: round2(side) };
}

/** The whole canvas — what the map shows when nothing is pinned. */
export const FULL_VIEW: ViewBox = { x: 0, y: 0, w: VIEW_SIZE, h: VIEW_SIZE };

export function viewBoxAttr(v: ViewBox): string {
  return `${v.x} ${v.y} ${v.w} ${v.h}`;
}

/**
 * Ramer–Douglas–Peucker: drop the points that do not change the line's shape
 * by more than `tolerance`, in the projected 0..1000 space.
 *
 * Iterative rather than recursive on purpose — an OSM coastline can be tens of
 * thousands of points, and the recursive form blows the stack on exactly the
 * inputs that need simplifying most.
 */
export function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2 || tolerance <= 0) return points;
  // RDP is O(n log n) on a well-behaved line and O(n²) on a pathological one:
  // a line that alternates either side of its own chord keeps every point, so
  // the split degenerates into n segments of length 1. Measured: 60,000 such
  // points took 67 seconds. A coastline is not that adversarial, but it is long
  // enough that "probably fine" is not a bound. Anything over the cap is
  // decimated evenly first — at these lengths the dropped points are far below
  // one pixel on an 800px map, and the cost becomes predictable.
  if (points.length > MAX_SIMPLIFY_POINTS) {
    points = decimate(points, MAX_SIMPLIFY_POINTS);
  }

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxDist = -1;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(points[i], points[first], points[last]);
      if (d > maxDist) { maxDist = d; index = i; }
    }
    if (maxDist > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** Above this, decimate before running RDP — see the note in simplify(). */
export const MAX_SIMPLIFY_POINTS = 8_000;

/** Evenly thin `points` down to at most `max`, always keeping both ends. */
export function decimate(points: Point[], max: number): Point[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: Point[] = [];
  for (let i = 0; i < max - 1; i++) out.push(points[Math.round(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + clamped * dx), p[1] - (a[1] + clamped * dy));
}

/**
 * Simplify a closed ring while keeping it closed and keeping it a polygon.
 *
 * Two guards that a plain simplify() call does not give you: the closing point
 * is restored (RDP treats first and last as fixed, but a ring's last point IS
 * its first, so a naive call can leave a shape that does not close), and a ring
 * reduced below three distinct points is dropped rather than emitted as a
 * degenerate sliver.
 */
export function simplifyRing(ring: Ring, tolerance: number): Ring | null {
  // A closed ring needs 3 distinct points plus the repeat of the first.
  if (ring.length < 4) return null;
  const open = ring.slice(0, -1);
  const simplified = simplify(open, tolerance);
  if (simplified.length < 3) return null;
  return [...simplified, simplified[0]];
}

/** An SVG path for one or more rings (outer ring first, holes after). */
export function ringsToPath(rings: Ring[]): string {
  return rings
    .filter((r) => r.length >= 3)
    .map((r) => `M${r.map((p) => `${p[0]},${p[1]}`).join("L")}Z`)
    .join("");
}

/** An SVG path for an open line (a street). */
export function lineToPath(points: Point[]): string {
  if (points.length < 2) return "";
  return `M${points.map((p) => `${p[0]},${p[1]}`).join("L")}`;
}

/** Rough planar length, for "which streets are the main ones" and for label
 *  placement. Units are view-box units, not metres — comparison only. */
export function lineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

/** Centroid of a ring, by area, for placing a label inside the shape.
 *  Falls back to the average of the points when the ring has no area. */
export function ringCentroid(ring: Ring): Point {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (a === 0) {
    const n = ring.length || 1;
    return [
      round2(ring.reduce((s, p) => s + p[0], 0) / n),
      round2(ring.reduce((s, p) => s + p[1], 0) / n),
    ];
  }
  return [round2(cx / (3 * a)), round2(cy / (3 * a))];
}

/* ───────────────────── distances on the ground ───────────────────── */

const EARTH_RADIUS_M = 6_371_008.8;

/**
 * Great-circle distance in metres (haversine). Accurate to well under a
 * metre at the few hundred metres the radius comparison uses, which is all
 * the address geocodes themselves can promise.
 */
export function distanceM([lon1, lat1]: LonLat, [lon2, lat2]: LonLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * The lon/lat box that contains every point within `radiusM` of the centre —
 * the cheap SQL pre-filter before the exact haversine test. Slightly larger
 * than the circle (a box always is), never smaller.
 */
export function bboxAroundM([lon, lat]: LonLat, radiusM: number): BBox {
  const dLat = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLon = dLat / cosLat;
  return { minLon: lon - dLon, maxLon: lon + dLon, minLat: lat - dLat, maxLat: lat + dLat };
}
