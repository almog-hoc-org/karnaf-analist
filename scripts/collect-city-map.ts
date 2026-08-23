#!/usr/bin/env tsx
/**
 * Collect one city's map — neighbourhood outlines, main streets and water —
 * from OpenStreetMap, and store it projected and simplified, ready to draw.
 *
 * WHY THIS EXISTS
 * The site can already say that נווה שאנן is 12% above the city average. It
 * cannot say WHERE נווה שאנן is. There is no geographic data anywhere in this
 * project: no coordinates on a transaction, no GeoJSON, no map library. This
 * is the missing half.
 *
 * WHY OPENSTREETMAP AND NOT GOVMAP
 * govmap is where the neighbourhood NAMES on our transactions come from, so it
 * would join perfectly — but it is geo-restricted (see lib/ilFetch.ts), needs
 * KARNAF_IL_PROXY, and publishes no documented boundary endpoint. OSM is
 * reachable without a proxy, is documented, and is keyed by NAME, which is
 * exactly the key our prices carry. If OSM coverage turns out thin for a city,
 * the fallback is govmap through the existing proxy: same tables, same UI, only
 * this script changes.
 *
 * WHY THE HEAVY WORK HAPPENS HERE AND NOT IN THE BROWSER
 * A city outline does not change between page views. Projecting and simplifying
 * on every request would be identical arithmetic repeated for every visitor,
 * and unsimplified OSM geometry is megabytes for a picture 800px wide. Both
 * happen once, here, and what is stored goes straight into an SVG path.
 *
 *   npx tsx scripts/collect-city-map.ts --city "תל אביב-יפו" [--dry-run] [--force]
 *
 * See docs/NEIGHBORHOOD-MAPS.md for the full runbook.
 */
import Database from "better-sqlite3";
import path from "path";
import {
  makeProjector, simplify, simplifyRing, ringsToPath, lineToPath, lineLength,
  ringCentroid, emptyBBox, extendBBox, bboxIsEmpty,
  type BBox, type LonLat, type Point, type Ring,
} from "../lib/geo";
import { normHoodKey } from "../lib/hoodKey";

const DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db");

/** Public Overpass instances, tried in order — one being down is routine. */
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/** Simplification tolerance, in view-box units (the box is 1000 wide).
 *  0.35 keeps a shape visually identical at 800px and removes most points. */
const TOLERANCE_SHAPE = 0.35;
const TOLERANCE_LINE = 0.4;

/** Road classes worth drawing. Anything below tertiary is street furniture at
 *  city scale: it doubles the payload and reads as grey noise. */
const ROAD_RANKS: Record<string, number> = {
  motorway: 1, trunk: 2, primary: 3, secondary: 4, tertiary: 5,
};

interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  members?: Array<{ type: string; role: string; geometry?: Array<{ lat: number; lon: number }> }>;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * One query for all three layers.
 *
 * `area[name]` rather than a bounding box: a bbox around Tel Aviv pulls in
 * Ramat Gan and Givatayim, and their neighbourhoods would be drawn as if they
 * were ours. `out geom` returns coordinates inline, which avoids a second
 * round trip to resolve node ids.
 */
function buildQuery(cityName: string, nameTag = "name"): string {
  const roads = Object.keys(ROAD_RANKS).join("|");
  return `[out:json][timeout:180];
area["${nameTag}"="${cityName}"]["boundary"="administrative"]->.city;
(
  way(area.city)["place"~"^(neighbourhood|suburb|quarter)$"]["name"];
  relation(area.city)["place"~"^(neighbourhood|suburb|quarter)$"]["name"];
  way(area.city)["highway"~"^(${roads})$"];
  way(area.city)["natural"="water"];
  relation(area.city)["natural"="water"];
  way(area.city)["natural"="coastline"];
);
out geom;`;
}

async function fetchOverpass(query: string): Promise<OsmElement[]> {
  let lastError = "";
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(200_000),
      });
      if (!res.ok) { lastError = `${url} → ${res.status}`; continue; }
      const json = await res.json();
      if (Array.isArray(json?.elements)) return json.elements as OsmElement[];
      lastError = `${url} → תשובה ללא elements`;
    } catch (e) {
      lastError = `${url} → ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  throw new Error(`כל נקודות הקצה של Overpass נכשלו. אחרונה: ${lastError}`);
}

/** Every ring an element carries: a way has one, a relation has one per outer member. */
function ringsOf(el: OsmElement): LonLat[][] {
  const out: LonLat[][] = [];
  const asRing = (g: Array<{ lat: number; lon: number }>): LonLat[] | null => {
    if (!g || g.length < 4) return null;
    const pts = g.map((p) => [p.lon, p.lat] as LonLat);
    const [fx, fy] = pts[0];
    const [lx, ly] = pts[pts.length - 1];
    if (fx !== lx || fy !== ly) pts.push([fx, fy]); // OSM leaves some ways open
    return pts;
  };
  if (el.geometry) { const r = asRing(el.geometry); if (r) out.push(r); }
  for (const m of el.members ?? []) {
    if (m.role === "outer" && m.geometry) { const r = asRing(m.geometry); if (r) out.push(r); }
  }
  return out;
}

function lineOf(el: OsmElement): LonLat[] | null {
  if (!el.geometry || el.geometry.length < 2) return null;
  return el.geometry.map((p) => [p.lon, p.lat] as LonLat);
}

async function main(): Promise<number> {
  const city = arg("city");
  const dry = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  if (!city) {
    console.error('חסר --city. דוגמה: npx tsx scripts/collect-city-map.ts --city "תל אביב-יפו"');
    return 1;
  }

  const db = new Database(DB);
  db.pragma("busy_timeout = 30000");
  ensureTables(db);

  if (!force && !dry) {
    const existing = db.prepare("SELECT COUNT(*) c FROM neighborhood_shapes WHERE city_name=?").get(city) as { c: number };
    if (existing.c > 0) {
      console.log(`↷ ל${city} כבר יש ${existing.c} שכונות. --force כדי לאסוף מחדש.`);
      return 0;
    }
  }

  // A ladder of name spellings, not one exact match. OSM's `name` on an
  // administrative boundary is whatever a mapper typed: "תל אביב-יפו" with a
  // hyphen, without one, or only under `name:he`. Guessing wrong returns zero
  // elements — indistinguishable from "this city has no neighbourhoods" — and
  // costs a whole deploy cycle to discover. Cheaper to try the obvious variants
  // and say which one answered.
  const attempts: Array<{ tag: string; name: string }> = [];
  const seenNames = new Set<string>();
  for (const name of [city, city.replace(/-/g, " "), city.replace(/\s+/g, "-")]) {
    if (seenNames.has(name)) continue;
    seenNames.add(name);
    attempts.push({ tag: "name", name }, { tag: "name:he", name });
  }

  console.log(`מושך את ${city} מ-OpenStreetMap…`);
  let elements: OsmElement[] = [];
  let matched: { tag: string; name: string } | null = null;
  for (const a of attempts) {
    const got = await fetchOverpass(buildQuery(a.name, a.tag));
    if (got.length > 0) { elements = got; matched = a; break; }
    console.log(`  ${a.tag}="${a.name}" → 0`);
  }
  if (!matched) {
    console.error(`✗ Overpass לא החזיר כלום לאף וריאציה של ״${city}״ — בדקו את שם הגבול המנהלי ב-openstreetmap.org`);
    return 1;
  }
  console.log(`התקבלו ${elements.length} אלמנטים (${matched.tag}="${matched.name}")`);

  // ── pass 1: the bounding box, from EVERY layer ──
  // It has to cover all of them: a projector fitted to the neighbourhoods alone
  // would clip the roads that run past them, and two layers each fitted to their
  // own extent would slide against each other.
  let bbox: BBox = emptyBBox();
  const touch = (pts: LonLat[]) => { for (const p of pts) bbox = extendBBox(bbox, p); };
  for (const el of elements) {
    for (const r of ringsOf(el)) touch(r);
    const l = lineOf(el);
    if (l) touch(l);
  }
  if (bboxIsEmpty(bbox)) { console.error("✗ לא נמצאה גיאומטריה"); return 1; }
  const projectPoint = makeProjector(bbox);

  // ── pass 2: build the three layers ──
  const shapes: Array<{ name: string; path: string; cx: number; cy: number; osmId: number; points: number }> = [];
  const lines: Array<{ kind: string; rank: number; name: string | null; path: string; length: number }> = [];
  let rawPoints = 0, keptPoints = 0;

  for (const el of elements) {
    const tags = el.tags ?? {};
    const isPlace = !!tags.place && !!tags.name;
    const roadRank = tags.highway ? ROAD_RANKS[tags.highway] : undefined;
    const isWater = tags.natural === "water";
    const isCoast = tags.natural === "coastline";

    if (isPlace) {
      const rings: Ring[] = [];
      for (const raw of ringsOf(el)) {
        rawPoints += raw.length;
        const projected = raw.map(projectPoint);
        const simplified = simplifyRing(projected, TOLERANCE_SHAPE);
        if (simplified) { rings.push(simplified); keptPoints += simplified.length; }
      }
      if (!rings.length) continue;
      const [cx, cy] = ringCentroid(rings[0]);
      shapes.push({
        name: tags.name!, path: ringsToPath(rings), cx, cy, osmId: el.id,
        points: rings.reduce((s, r) => s + r.length, 0),
      });
      continue;
    }

    if (isWater) {
      for (const raw of ringsOf(el)) {
        rawPoints += raw.length;
        const simplified = simplifyRing(raw.map(projectPoint), TOLERANCE_LINE);
        if (!simplified) continue;
        keptPoints += simplified.length;
        lines.push({ kind: "water", rank: 9, name: tags.name ?? null, path: ringsToPath([simplified]), length: 0 });
      }
      continue;
    }

    const raw = lineOf(el);
    if (!raw) continue;
    if (roadRank === undefined && !isCoast) continue;
    rawPoints += raw.length;
    const projected = raw.map(projectPoint);
    const simplified = simplify(projected, TOLERANCE_LINE);
    if (simplified.length < 2) continue;
    keptPoints += simplified.length;
    lines.push({
      kind: isCoast ? "coast" : "road",
      rank: isCoast ? 8 : roadRank!,
      name: tags.name ?? null,
      path: lineToPath(simplified),
      length: lineLength(simplified),
    });
  }

  const bytes = Buffer.byteLength(
    JSON.stringify([shapes.map((s) => s.path), lines.map((l) => l.path)]), "utf8"
  );
  console.log(`שכונות: ${shapes.length} · קווים: ${lines.length} (${lines.filter((l) => l.kind === "road").length} כבישים)`);
  console.log(`נקודות: ${rawPoints.toLocaleString("he-IL")} → ${keptPoints.toLocaleString("he-IL")} אחרי פישוט`);
  console.log(`משקל הגיאומטריה: ${(bytes / 1024).toFixed(0)}KB`);
  if (bytes > 150 * 1024) {
    console.log("⚠ מעל היעד של 150KB — שקול להוריד את tertiary או להגדיל את הסבולת");
  }

  if (dry) { console.log("(--dry-run — לא נכתב כלום)"); return 0; }

  const write = db.transaction(() => {
    db.prepare("DELETE FROM neighborhood_shapes WHERE city_name=?").run(city);
    db.prepare("DELETE FROM city_map_lines WHERE city_name=?").run(city);
    const insShape = db.prepare(
      `INSERT INTO neighborhood_shapes (city_name, neighborhood, norm_name, path_d, cx, cy, osm_id, source, updated_at)
       VALUES (?,?,?,?,?,?,?,'osm',CURRENT_TIMESTAMP)`
    );
    for (const s of shapes) insShape.run(city, s.name, normHoodKey(s.name), s.path, s.cx, s.cy, s.osmId);
    const insLine = db.prepare(
      `INSERT INTO city_map_lines (city_name, kind, rank, name, path_d, length) VALUES (?,?,?,?,?,?)`
    );
    for (const l of lines) insLine.run(city, l.kind, l.rank, l.name, l.path, l.length);
    db.prepare(
      `INSERT INTO city_map_meta (city_name, min_lon, min_lat, max_lon, max_lat, updated_at)
       VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(city_name) DO UPDATE SET
         min_lon=excluded.min_lon, min_lat=excluded.min_lat,
         max_lon=excluded.max_lon, max_lat=excluded.max_lat,
         updated_at=CURRENT_TIMESTAMP`
    ).run(city, bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat);
  });
  write();

  console.log(`✓ נשמר ל${city}`);
  return 0;
}

/** Created here rather than in schema.prisma — the same pattern as
 *  neighborhood_year_stats, whose readers treat a missing table as "no data"
 *  rather than as an error. */
function ensureTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS neighborhood_shapes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      city_name TEXT NOT NULL,
      neighborhood TEXT NOT NULL,
      norm_name TEXT NOT NULL,
      path_d TEXT NOT NULL,
      cx REAL, cy REAL,
      osm_id INTEGER,
      source TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_shapes_city ON neighborhood_shapes(city_name);
    CREATE TABLE IF NOT EXISTS city_map_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      city_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      rank INTEGER NOT NULL,
      name TEXT,
      path_d TEXT NOT NULL,
      length REAL
    );
    CREATE INDEX IF NOT EXISTS idx_maplines_city ON city_map_lines(city_name, rank);
    CREATE TABLE IF NOT EXISTS city_map_meta (
      city_name TEXT PRIMARY KEY,
      min_lon REAL, min_lat REAL, max_lon REAL, max_lat REAL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });

export {};
