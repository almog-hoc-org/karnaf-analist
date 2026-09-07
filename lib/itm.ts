/**
 * Israeli Transverse Mercator (EPSG:2039, "Israel 1993 / Israeli TM Grid")
 * to and from WGS84 — pure arithmetic, no dependency.
 *
 * WHY THIS FILE EXISTS. Every Israeli government coordinate the project meets
 * is on this grid: govmap's autocomplete `POINT(x y)`, the deal-sweep centres
 * in lib/govmapDeals.ts (where metre offsets are simply added to x and y —
 * the grid was assumed without ever being named), and the national address
 * file. Our map, on the other hand, is projected from WGS84 lon/lat
 * (lib/geo.ts, city_map_meta). A deal can only land on the map if the two
 * meet, and this is where they meet.
 *
 * TWO STEPS, THE SECOND SWITCHABLE. Transverse Mercator inverse gives
 * geodetic coordinates on the Israel 1993 datum (GRS80 ellipsoid). That datum
 * is offset from WGS84 by a geocentric translation of a few tens of metres
 * (EPSG transformation 1073, ±1 m). At the map's scale — one view unit is
 * ~15 m in Tel Aviv — skipping it would put a pin across the street from the
 * building, so it is applied by default; the switch exists so the size of
 * the shift can be verified against a known address (docs/NEIGHBORHOOD-MAPS.md).
 *
 * Formulas: Snyder, "Map Projections — A Working Manual", USGS PP 1395,
 * eqs 8-9..8-17 (forward) and 8-18..8-25 (inverse). Accurate to well under a
 * millimetre across Israel's ~1.5° from the central meridian.
 */
import type { LonLat } from "./geo";

/** EPSG:2039 projection parameters. */
export const ITM = {
  /** GRS80 semi-major axis, metres */
  a: 6378137,
  /** GRS80 flattening */
  f: 1 / 298.257222101,
  /** latitude of origin 31°44′03.817″N */
  lat0: 31.73439361111111,
  /** central meridian 35°12′16.261″E */
  lon0: 35.20451694444445,
  k0: 1.0000067,
  falseEasting: 219529.584,
  falseNorthing: 626907.39,
} as const;

/** Israel 1993 → WGS84 geocentric translation, metres (EPSG:1073). */
export const ISRAEL_1993_TO_WGS84 = { dx: -48, dy: 55, dz: 52 } as const;

export interface ItmXY { x: number; y: number }

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const e2 = 2 * ITM.f - ITM.f * ITM.f; // first eccentricity squared
const ep2 = e2 / (1 - e2); // second eccentricity squared

/** Meridional arc from the equator to latitude φ (radians), Snyder 3-21. */
function meridianArc(phi: number): number {
  const { a } = ITM;
  const e4 = e2 * e2, e6 = e4 * e2;
  return a * (
    (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
    - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
    - (35 * e6 / 3072) * Math.sin(6 * phi)
  );
}

const M0 = meridianArc(ITM.lat0 * D2R);

/** Forward TM on the Israel 1993 datum: geodetic (degrees) → grid metres. */
function tmForward(lonDeg: number, latDeg: number): ItmXY {
  const { a, k0 } = ITM;
  const phi = latDeg * D2R;
  const dLam = (lonDeg - ITM.lon0) * D2R;
  const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sin * sin);
  const T = tan * tan;
  const C = ep2 * cos * cos;
  const A = cos * dLam;
  const M = meridianArc(phi);
  const A2 = A * A, A3 = A2 * A, A4 = A3 * A, A5 = A4 * A, A6 = A5 * A;
  const x = k0 * N * (A + (1 - T + C) * A3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A5 / 120);
  const y = k0 * (M - M0 + N * tan * (A2 / 2 + (5 - T + 9 * C + 4 * C * C) * A4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A6 / 720));
  return { x: x + ITM.falseEasting, y: y + ITM.falseNorthing };
}

/** Inverse TM on the Israel 1993 datum: grid metres → geodetic (degrees). */
function tmInverse(x: number, y: number): LonLat {
  const { a, k0 } = ITM;
  const dx = x - ITM.falseEasting;
  const M = M0 + (y - ITM.falseNorthing) / k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const e1_2 = e1 * e1, e1_3 = e1_2 * e1, e1_4 = e1_3 * e1;
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1_3 / 32) * Math.sin(2 * mu)
    + (21 * e1_2 / 16 - 55 * e1_4 / 32) * Math.sin(4 * mu)
    + (151 * e1_3 / 96) * Math.sin(6 * mu)
    + (1097 * e1_4 / 512) * Math.sin(8 * mu);
  const sin1 = Math.sin(phi1), cos1 = Math.cos(phi1), tan1 = Math.tan(phi1);
  const C1 = ep2 * cos1 * cos1;
  const T1 = tan1 * tan1;
  const N1 = a / Math.sqrt(1 - e2 * sin1 * sin1);
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sin1 * sin1, 1.5);
  const D = dx / (N1 * k0);
  const D2 = D * D, D3 = D2 * D, D4 = D3 * D, D5 = D4 * D, D6 = D5 * D;
  const phi = phi1 - (N1 * tan1 / R1) * (
    D2 / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D6 / 720);
  const lam = ITM.lon0 * D2R + (
    D - (1 + 2 * T1 + C1) * D3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D5 / 120) / cos1;
  return [lam * R2D, phi * R2D];
}

/* ── datum shift: geodetic ↔ geocentric on an ellipsoid, then translate ── */

function geodeticToGeocentric(lonDeg: number, latDeg: number, a: number, e2_: number): [number, number, number] {
  const phi = latDeg * D2R, lam = lonDeg * D2R;
  const sin = Math.sin(phi), cos = Math.cos(phi);
  const N = a / Math.sqrt(1 - e2_ * sin * sin);
  return [N * cos * Math.cos(lam), N * cos * Math.sin(lam), N * (1 - e2_) * sin];
}

function geocentricToGeodetic(X: number, Y: number, Z: number, a: number, e2_: number): LonLat {
  const lam = Math.atan2(Y, X);
  const p = Math.hypot(X, Y);
  // Iterative latitude — converges in a handful of steps at the surface.
  let phi = Math.atan2(Z, p * (1 - e2_));
  for (let i = 0; i < 8; i++) {
    const sin = Math.sin(phi);
    const N = a / Math.sqrt(1 - e2_ * sin * sin);
    const next = Math.atan2(Z + e2_ * N * sin, p);
    if (Math.abs(next - phi) < 1e-13) { phi = next; break; }
    phi = next;
  }
  return [lam * R2D, phi * R2D];
}

// WGS84 ellipsoid — differs from GRS80 in the 7th decimal of flattening;
// kept exact anyway so the translation is applied on the right surface.
const WGS84 = { a: 6378137, e2: 2 * (1 / 298.257223563) - (1 / 298.257223563) ** 2 };

function israel1993ToWgs84(p: LonLat): LonLat {
  const [X, Y, Z] = geodeticToGeocentric(p[0], p[1], ITM.a, e2);
  const t = ISRAEL_1993_TO_WGS84;
  return geocentricToGeodetic(X + t.dx, Y + t.dy, Z + t.dz, WGS84.a, WGS84.e2);
}

function wgs84ToIsrael1993(p: LonLat): LonLat {
  const [X, Y, Z] = geodeticToGeocentric(p[0], p[1], WGS84.a, WGS84.e2);
  const t = ISRAEL_1993_TO_WGS84;
  return geocentricToGeodetic(X - t.dx, Y - t.dy, Z - t.dz, ITM.a, e2);
}

/* ── the public pair ── */

export interface DatumOpts {
  /** apply the Israel 1993 → WGS84 translation (default true) */
  applyDatumShift?: boolean;
}

/** ITM grid metres → WGS84 [lon, lat] degrees. */
export function itmToWgs84(x: number, y: number, opts: DatumOpts = {}): LonLat {
  const local = tmInverse(x, y);
  return opts.applyDatumShift === false ? local : israel1993ToWgs84(local);
}

/** WGS84 [lon, lat] degrees → ITM grid metres. */
export function wgs84ToItm(lon: number, lat: number, opts: DatumOpts = {}): ItmXY {
  const local = opts.applyDatumShift === false ? ([lon, lat] as LonLat) : wgs84ToIsrael1993([lon, lat]);
  return tmForward(local[0], local[1]);
}

/**
 * Is this pair plausibly an ITM coordinate? The grid covers roughly
 * 120,000–300,000 east and 370,000–800,000 north over Israel. Used to decide,
 * per file, which CRS an address list is in — never per row.
 */
export function looksLikeItm(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y)
    && x >= 100_000 && x <= 320_000 && y >= 350_000 && y <= 820_000;
}

/** Is this pair plausibly a WGS84 lon/lat inside Israel? */
export function looksLikeWgs84(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat)
    && lon >= 34 && lon <= 36.2 && lat >= 29.3 && lat <= 33.5;
}

/* ───────────── Web Mercator (EPSG:3857) — what govmap's autocomplete returns ───────────── */

const WEB_MERCATOR_R = 6378137;

/**
 * MEASURED 7.9.2026 (Bat Yam, 1,730 answers): govmap's search autocomplete
 * gives `shape: POINT(3868879 3765962)` — that is Web Mercator metres
 * (EPSG:3857), not ITM. Fed to the ITM inverse it became lon 93°, lat 46°:
 * Mongolia. So the CRS of a point is DETECTED from its magnitude, never
 * assumed per source — see anyToWgs84.
 */
export function webMercatorToWgs84(x: number, y: number): LonLat {
  const lon = (x / WEB_MERCATOR_R) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / WEB_MERCATOR_R)) - Math.PI / 2) * (180 / Math.PI);
  return [lon, lat];
}

/** Is this pair plausibly Web Mercator metres inside Israel? */
export function looksLikeWebMercator(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y)
    && x >= 3_780_000 && x <= 4_030_000 && y >= 3_400_000 && y <= 3_960_000;
}

/**
 * A point in whichever of the three systems Israeli sources use, as WGS84 —
 * or null when it is none of them (a source answered with something that is
 * not a location in Israel). The three magnitude ranges do not overlap.
 */
export function anyToWgs84(x: number, y: number): LonLat | null {
  if (looksLikeWgs84(x, y)) return [x, y];
  if (looksLikeItm(x, y)) {
    const p = itmToWgs84(x, y);
    return looksLikeWgs84(p[0], p[1]) ? p : null;
  }
  if (looksLikeWebMercator(x, y)) {
    const p = webMercatorToWgs84(x, y);
    return looksLikeWgs84(p[0], p[1]) ? p : null;
  }
  return null;
}
