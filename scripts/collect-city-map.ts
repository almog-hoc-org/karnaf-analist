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
function buildQuery(areaId: number): string {
  const roads = Object.keys(ROAD_RANKS).join("|");
  return `[out:json][timeout:180];
area(${areaId})->.city;
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

async function resolveArea(cityName: string): Promise<{ id: number; name: string } | null> {
  // The search key is the part before a hyphen: OSM writes "תל אביב-יפו",
  // "תל אביב יפו" and occasionally just "תל אביב", and a regex on the stable
  // head matches all three without enumerating them.
  const core = cityName.split(/[-–—]/)[0].trim();

  /* FOUR TAGGINGS, WIDENING, IN ONE RUN.
   *
   * The first version asked only for boundary=administrative with a matching
   * `name`, and for Tel Aviv that found the DISTRICT and the SUB-district and
   * no city — because a municipality in OSM Israel is not reliably tagged the
   * way a European one is: the Hebrew name may live on `name:he` with an
   * English `name`, and the municipal edge is sometimes `boundary=local_
   * authority` rather than `administrative`.
   *
   * Discovering that cost a deploy cycle each time. So the lookup now widens
   * through the plausible taggings within a single run and prints what each
   * one found — one run, whole picture, instead of one guess per round trip. */
  const probes: Array<{ what: string; q: string }> = [
    { what: 'boundary=administrative · name', q: `relation["boundary"="administrative"]["name"~"${core}"];` },
    { what: "any boundary · name", q: `relation["boundary"]["name"~"${core}"];` },
    { what: "any boundary · name:he", q: `relation["boundary"]["name:he"~"${core}"];` },
    { what: "place=city|town|municipality", q: `relation["place"~"^(city|town|municipality)$"]["name"~"${core}"];` },
  ];

  const wanted = normHoodKey(cityName);
  const wantedCore = normHoodKey(core);

  for (const probe of probes) {
    const found = await fetchOverpass(`[out:json][timeout:90];\n${probe.q}\nout tags;`);
    if (found.length === 0) {
      console.log(`  ${probe.what} → 0`);
      continue;
    }

    const scored = found
      .map((el) => {
        const tags = el.tags ?? {};
        // Either name tag can carry the Hebrew; the other is often English.
        const names = [tags.name, tags["name:he"]].filter(Boolean) as string[];
        const level = Number(tags.admin_level ?? 99);
        const best = names
          .map((n) => {
            const key = normHoodKey(n);
            if (key === wanted) return { n, rank: 0 };
            if (key === wantedCore) return { n, rank: 1 };
            if (key.includes(wanted) || wanted.includes(key)) return { n, rank: 2 };
            if (key.includes(wantedCore)) return { n, rank: 3 };
            return { n, rank: 9 };
          })
          .sort((a, b) => a.rank - b.rank)[0];
        return { id: el.id, name: best?.n ?? "", rank: best?.rank ?? 9, level, tags };
      })
      // A DISTRICT is not the city. admin_level 8 is the municipality in
      // Israel; 4 and 5 are the district and sub-district, and drawing "מחוז
      // תל אביב" would put half the metropolitan area on a city page.
      .filter((c) => c.name && c.rank < 9 && c.level >= 8)
      .sort((a, b) => a.rank - b.rank || b.level - a.level);

    console.log(`  ${probe.what} → ${found.length} נמצאו, ${scored.length} מתאימים`);
    for (const c of scored.slice(0, 5)) {
      console.log(`      ${c.name}  (relation ${c.id}, admin_level ${c.level === 99 ? "?" : c.level})`);
    }
    if (scored.length === 0) {
      for (const el of found.slice(0, 6)) {
        const t = el.tags ?? {};
        console.log(`      · ${t.name ?? "(ללא name)"} / ${t["name:he"] ?? "—"} · ${t.boundary ?? t.place ?? "?"} · level ${t.admin_level ?? "?"}`);
      }
      continue;
    }
    const best = scored[0];
    return { id: AREA_OFFSET + best.id, name: best.name };
  }
  return null;
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

  console.log(`מחפש את הגבול המנהלי של ${city} ב-OpenStreetMap…`);
  let elements: OsmElement[] = [];
  let area: { id: number; name: string } | null = null;
  let lastTransportError = "";

  // Rounds cover a busy Overpass, not a wrong name: a lookup that ANSWERS with
  // no matching boundary is final, and retrying it three times would only be
  // three times as rude to a free service.
  for (let round = 0; round < ROUNDS; round++) {
    if (round > 0) {
      console.log(`  אף נקודת קצה לא ענתה. ממתין ${BACKOFF_MS[round] / 1000}s וסבב ${round + 1}/${ROUNDS}…`);
      await sleep(BACKOFF_MS[round]);
    }
    try {
      area = await resolveArea(city);
      lastTransportError = "";
      break; // it answered — whatever it said is the answer
    } catch (e) {
      lastTransportError = e instanceof Error ? e.message : String(e);
    }
  }

  if (lastTransportError) {
    console.error(`✗ Overpass לא זמין כרגע. ${lastTransportError}`);
    console.error("  לא נכתב כלום — הרצה הבאה תנסה שוב.");
    return 1;
  }
  if (!area) {
    console.error(`✗ ל-OpenStreetMap אין גבול מנהלי בשם שתואם ל״${city}״.`);
    console.error("  הרשימה למעלה היא מה שכן נמצא — בחרו ממנה והוסיפו כינוי, או בדקו ב-openstreetmap.org");
    return 1;
  }

  console.log(`מושך את ${area.name} (area ${area.id})…`);
  try {
    elements = await fetchOverpass(buildQuery(area.id));
  } catch (e) {
    console.error(`✗ משיכת השכבות נכשלה. ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  console.log(`התקבלו ${elements.length} אלמנטים`);
  if (elements.length === 0) {
    console.error(`✗ הגבול נמצא אבל אין בתוכו שכונות/כבישים מתויגים`);
    return 1;
  }

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
