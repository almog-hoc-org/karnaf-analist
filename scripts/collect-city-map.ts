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
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
];

/** Overpass slots are shared and genuinely intermittent: a busy server answers
 *  429 or 504 in a second or two, which is not a reason to give up on the run.
 *  Three passes over the endpoint list, backing off between them. */
const ROUNDS = 3;
const BACKOFF_MS = [0, 15_000, 45_000];

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
function buildQuery(box: BBox): string {
  const roads = Object.keys(ROAD_RANKS).join("|");
  // Overpass bbox order is (south,west,north,east).
  const bb = `${box.minLat},${box.minLon},${box.maxLat},${box.maxLon}`;
  return `[out:json][timeout:180];
(
  way(${bb})["place"~"^(neighbourhood|suburb|quarter)$"]["name"];
  relation(${bb})["place"~"^(neighbourhood|suburb|quarter)$"]["name"];
  way(${bb})["highway"~"^(${roads})$"];
  way(${bb})["natural"="water"];
  relation(${bb})["natural"="water"];
  way(${bb})["natural"="coastline"];
);
out geom;`;
}

async function fetchOverpass(query: string): Promise<OsmElement[]> {
  // EVERY failure is printed, not just the last one. The first attempt at this
  // reported only the final endpoint's error — "502" — which said nothing about
  // whether the others had refused, timed out, or answered with something
  // unparseable, and left the actual cause a guess.
  const failures: string[] = [];
  for (const url of ENDPOINTS) {
    const host = new URL(url).host;
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Overpass asks callers to identify themselves; an anonymous
          // client is the first thing a busy server sheds.
          "User-Agent": "karnaf-analist/1.0 (neighbourhood map collector)",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(200_000),
      });
      const ms = Date.now() - started;
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 200).replace(/\s+/g, " ");
        failures.push(`${host} → ${res.status} אחרי ${ms}ms${body ? ` · ${body}` : ""}`);
        continue;
      }
      const json = await res.json();
      if (Array.isArray(json?.elements)) {
        console.log(`  ${host} ענה אחרי ${ms}ms`);
        return json.elements as OsmElement[];
      }
      failures.push(`${host} → 200 ללא elements אחרי ${ms}ms`);
    } catch (e) {
      failures.push(`${host} → ${e instanceof Error ? e.message : String(e)} אחרי ${Date.now() - started}ms`);
    }
  }
  throw new Error(`כל נקודות הקצה נכשלו:\n    ${failures.join("\n    ")}`);
}

/** Wait between rounds. Overpass slots are shared; hammering is how a caller
 *  earns a longer ban, not a faster answer. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Find the city's administrative boundary and return its Overpass AREA id.
 *
 * WHY A LOOKUP AND NOT A NAME IN THE QUERY
 * The first version guessed: it tried `area["name"="תל אביב-יפו"]` and five
 * other spellings. Overpass answered every one of them, promptly, with zero
 * elements — so the run reported a network problem for what was really a name
 * that does not exist in OSM under any form we invented. Guessing cannot be
 * made reliable, because the answer is whatever a mapper typed.
 *
 * So: ask OSM what it calls the place, pick the best match, and use its id.
 * The candidates are printed either way, which turns "no map for this city"
 * from a dead end into a line you can act on.
 *
 * 3600000000 is the standard offset from an OSM relation id to its area id.
 */
const AREA_OFFSET = 3_600_000_000;

/**
 * The city's centre point.
 *
 * WHY NOT ITS BOUNDARY — MEASURED, NOT ASSUMED
 * The obvious scope for "everything in this city" is its administrative area.
 * Four probes across three rounds established that OpenStreetMap does not have
 * one for Tel Aviv: searching boundaries named "תל אביב" returns מחוז תל אביב
 * (admin_level 4) and נפת תל אביב (admin_level 5) — the district and the
 * sub-district — and no municipality. Israeli municipal boundaries are largely
 * absent from OSM, so no amount of retrying or re-spelling was going to find
 * one, for this city or for the next.
 *
 * A place node, on the other hand, is reliably mapped. So the query is scoped
 * by a generous box around the centre, and the CITY'S OWN PRICE LIST decides
 * which of the neighbourhoods in that box belong to it — see keepOurs(). That
 * authority is better than a boundary anyway: it is the Tax Authority's own
 * attribution of a deal to a city, which is the same attribution every other
 * number on the page already rests on.
 */
async function resolveCentre(cityName: string): Promise<{ lon: number; lat: number; name: string } | null> {
  const core = cityName.split(/[-–—]/)[0].trim();
  const query = `[out:json][timeout:90];
(
  node["place"~"^(city|town|village)$"]["name"~"${core}"];
  node["place"~"^(city|town|village)$"]["name:he"~"${core}"];
);
out;`;
  const found = await fetchOverpass(query);
  if (found.length === 0) return null;

  const wanted = normHoodKey(cityName);
  const wantedCore = normHoodKey(core);
  const RANK: Record<string, number> = { city: 0, town: 1, village: 2 };

  const scored = found
    .map((el) => {
      const tags = el.tags ?? {};
      const names = [tags.name, tags["name:he"]].filter(Boolean) as string[];
      const best = names
        .map((n) => {
          const key = normHoodKey(n);
          if (key === wanted) return { n, rank: 0 };
          if (key === wantedCore) return { n, rank: 1 };
          if (key.includes(wanted) || wanted.includes(key)) return { n, rank: 2 };
          return { n, rank: 9 };
        })
        .sort((a, b) => a.rank - b.rank)[0];
      return {
        name: best?.n ?? "", rank: best?.rank ?? 9,
        place: RANK[tags.place ?? ""] ?? 3,
        lon: (el as unknown as { lon?: number }).lon,
        lat: (el as unknown as { lat?: number }).lat,
      };
    })
    .filter((c) => c.name && c.rank < 9 && typeof c.lon === "number" && typeof c.lat === "number")
    .sort((a, b) => a.rank - b.rank || a.place - b.place);

  console.log(`  נקודות מקום: ${found.length} נמצאו, ${scored.length} מתאימות`);
  for (const c of scored.slice(0, 4)) console.log(`      ${c.name} (${c.lat!.toFixed(4)}, ${c.lon!.toFixed(4)})`);
  if (scored.length === 0) {
    for (const el of found.slice(0, 6)) console.log(`      · ${(el.tags ?? {}).name ?? "(ללא name)"}`);
    return null;
  }
  const best = scored[0];
  return { lon: best.lon!, lat: best.lat!, name: best.name };
}

/** Half-size of the search box, in degrees. ~12km north-south and ~11km
 *  east-west at Israel's latitude — larger than any Israeli municipality,
 *  because the box only has to CONTAIN the city; keepOurs() does the cutting. */
const BOX_LAT = 0.11;
const BOX_LON = 0.12;

/**
 * Which of the neighbourhoods in the box actually belong to this city.
 *
 * The price list is the authority. A shape whose name joins to a
 * neighbourhood the Tax Authority attributed to this city is ours; the rest of
 * the box — Ramat Gan, Givatayim, Bat Yam — is not. Then, so that a
 * neighbourhood with too few deals still gets drawn instead of leaving a hole,
 * anything whose centre falls inside the footprint of the joined ones is kept
 * as well.
 */
function keepOurs<T extends { name: string; lonLatCentre: [number, number] }>(
  shapes: T[],
  ourNames: Set<string>
): { kept: T[]; joined: number } {
  const joined = shapes.filter((s) => ourNames.has(normHoodKey(s.name)));
  if (joined.length === 0) return { kept: [], joined: 0 };

  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const s of joined) {
    const [lon, lat] = s.lonLatCentre;
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  // A small margin, so a neighbourhood on the edge of the city is not cut for
  // sitting a few hundred metres beyond the outermost priced one.
  const padLon = (maxLon - minLon) * 0.15 + 0.005;
  const padLat = (maxLat - minLat) * 0.15 + 0.005;

  const inFootprint = shapes.filter((s) => {
    const [lon, lat] = s.lonLatCentre;
    return lon >= minLon - padLon && lon <= maxLon + padLon && lat >= minLat - padLat && lat <= maxLat + padLat;
  });
  return { kept: inFootprint, joined: joined.length };
}

/** The neighbourhood names this city's own price data knows about. */
function ourNeighbourhoodKeys(db: Database.Database, city: string): Set<string> {
  try {
    const rows = db.prepare(
      "SELECT DISTINCT neighborhood FROM neighborhood_year_stats WHERE city_name = ?"
    ).all(city) as Array<{ neighborhood: string }>;
    return new Set(rows.map((r) => normHoodKey(r.neighborhood)));
  } catch {
    return new Set();
  }
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

  // The city's own price data decides what belongs to it — see keepOurs().
  // Without it there is nothing to cut the search box down to, so stop here
  // rather than storing a box full of three cities' neighbourhoods.
  const ourNames = ourNeighbourhoodKeys(db, city);
  if (ourNames.size === 0) {
    console.error(`✗ אין ל${city} נתוני שכונות (neighborhood_year_stats) — אין לפי מה לקבוע מה שייך לעיר`);
    return 1;
  }
  console.log(`  ${ourNames.size} שמות שכונות ידועים לנו ב${city}`);

  console.log(`מחפש את ${city} ב-OpenStreetMap…`);
  let elements: OsmElement[] = [];
  let centre: { lon: number; lat: number; name: string } | null = null;
  let lastTransportError = "";

  // Rounds cover a busy Overpass, not a wrong name: a lookup that ANSWERS with
  // no match is final, and retrying it would only be ruder to a free service.
  for (let round = 0; round < ROUNDS; round++) {
    if (round > 0) {
      console.log(`  אף נקודת קצה לא ענתה. ממתין ${BACKOFF_MS[round] / 1000}s וסבב ${round + 1}/${ROUNDS}…`);
      await sleep(BACKOFF_MS[round]);
    }
    try {
      centre = await resolveCentre(city);
      lastTransportError = "";
      break;
    } catch (e) {
      lastTransportError = e instanceof Error ? e.message : String(e);
    }
  }

  if (lastTransportError) {
    console.error(`✗ Overpass לא זמין כרגע. ${lastTransportError}`);
    console.error("  לא נכתב כלום — הרצה הבאה תנסה שוב.");
    return 1;
  }
  if (!centre) {
    console.error(`✗ ל-OpenStreetMap אין נקודת מקום בשם שתואם ל״${city}״.`);
    console.error("  הרשימה למעלה היא מה שכן נמצא — בדקו ב-openstreetmap.org");
    return 1;
  }

  const searchBox: BBox = {
    minLon: centre.lon - BOX_LON, maxLon: centre.lon + BOX_LON,
    minLat: centre.lat - BOX_LAT, maxLat: centre.lat + BOX_LAT,
  };
  console.log(`מושך תיבה סביב ${centre.name} (${centre.lat.toFixed(4)}, ${centre.lon.toFixed(4)})…`);
  try {
    elements = await fetchOverpass(buildQuery(searchBox));
  } catch (e) {
    console.error(`✗ משיכת השכבות נכשלה. ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  console.log(`התקבלו ${elements.length} אלמנטים`);
  if (elements.length === 0) {
    console.error("✗ אין בתיבה שכונות/כבישים מתויגים");
    return 1;
  }

  // ── which of the box's neighbourhoods are this city's ──
  const boxShapes = elements
    .filter((el) => el.tags?.place && el.tags?.name)
    .map((el) => {
      const rings = ringsOf(el);
      if (!rings.length) return null;
      const ring = rings[0];
      let lon = 0, lat = 0;
      for (const p of ring) { lon += p[0]; lat += p[1]; }
      return { el, name: el.tags!.name!, lonLatCentre: [lon / ring.length, lat / ring.length] as [number, number] };
    })
    .filter((x): x is { el: OsmElement; name: string; lonLatCentre: [number, number] } => x !== null);

  const { kept, joined } = keepOurs(boxShapes, ourNames);
  console.log(`  שכונות בתיבה: ${boxShapes.length} · הותאמו לרשימה שלנו: ${joined} · נשמרות: ${kept.length}`);
  if (joined < 3) {
    console.error(`✗ רק ${joined} שכונות בתיבה מתאימות לשמות של ${city} — לא מספיק כדי לקבוע מה שייך לעיר`);
    console.error(`  שמות שנמצאו בתיבה: ${boxShapes.slice(0, 12).map((s) => s.name).join(" · ")}`);
    return 1;
  }
  const keptEls = new Set(kept.map((k) => k.el));
  // Everything that is not a neighbourhood (roads, water) stays; the
  // neighbourhoods are cut down to the city's own.
  elements = elements.filter((el) => !(el.tags?.place && el.tags?.name) || keptEls.has(el));

  // ── pass 1: the frame ──
  // The extent of the CITY'S OWN neighbourhoods, not of everything fetched. The
  // search box is ~22km across so that it certainly contains the city; framing
  // the map on it would draw the city as a small blob in the middle of three
  // other municipalities' road networks.
  let bbox: BBox = emptyBBox();
  for (const k of kept) for (const r of ringsOf(k.el)) for (const p of r) bbox = extendBBox(bbox, p);
  if (bboxIsEmpty(bbox)) { console.error("✗ לא נמצאה גיאומטריה"); return 1; }
  // A little air, so a neighbourhood does not touch the edge of the picture.
  const padLon = (bbox.maxLon - bbox.minLon) * 0.06;
  const padLat = (bbox.maxLat - bbox.minLat) * 0.06;
  bbox = {
    minLon: bbox.minLon - padLon, maxLon: bbox.maxLon + padLon,
    minLat: bbox.minLat - padLat, maxLat: bbox.maxLat + padLat,
  };
  const projectPoint = makeProjector(bbox);

  /* Anything entirely outside the frame is dropped rather than projected off
     the canvas: the SVG would clip it anyway, and shipping coordinates for a
     road in the next city is pure payload. */
  const insideFrame = (pts: LonLat[]) =>
    pts.some((p) => p[0] >= bbox.minLon && p[0] <= bbox.maxLon && p[1] >= bbox.minLat && p[1] <= bbox.maxLat);

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
        if (!insideFrame(raw)) continue;
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
    if (!insideFrame(raw)) continue;
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
