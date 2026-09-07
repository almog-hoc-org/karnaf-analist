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
import { addressKey, addressKeyString } from "../lib/addressKey";
import { buildHoodShapes, type HoodShape, type LabelledPoint } from "../lib/hoodRegions";

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

/** Road fragments shorter than this (view-box units; the box is 1000 across,
 *  so ~4 is roughly 50m in a city the size of Tel Aviv) are dropped. They are
 *  slip roads, roundabout arms and junction stubs: invisible at 800px, and
 *  numerous enough to be most of the road layer's weight. */
const MIN_ROAD_LENGTH = 4;

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
 * ONLY THE ONES ITS PRICE LIST NAMES. The first version also kept anything
 * whose centre fell inside the footprint of those, so that a neighbourhood with
 * too few deals would still be drawn instead of leaving a hole. Measured on Tel
 * Aviv, that kept 96 of the box's 110 — and the 81 without prices were רמת
 * אפעל, כפר אז"ר, קרית קריניצי, רמת עמידר: Ramat Gan and Givatayim. They are
 * inside Tel Aviv's bounding box because they are wrapped by it, and no
 * rectangle can separate them.
 *
 * Drawing a neighbouring city on this city's map is a worse error than an
 * occasional gap, and it also cost the payload: the frame stretched to cover
 * three municipalities, and with it 5,219 roads and 231KB.
 */
function keepOurs<T extends { name: string }>(
  shapes: T[],
  ourNames: Set<string>
): { kept: T[]; joined: number } {
  const kept = shapes.filter((s) => ourNames.has(normHoodKey(s.name)));
  return { kept, joined: kept.length };
}

/** The centre the OSM address import already resolved for this city (city_centres),
 *  so the fallback box does not depend on Overpass spelling the city as we do
 *  ("קריית אתא" vs OSM's "קרית אתא" failed the name lookup, 7.9.2026). */
function centreFromDb(db: Database.Database, city: string): { lon: number; lat: number; name: string } | null {
  try {
    const row = db.prepare("SELECT lat, lon FROM city_centres WHERE city_name = ?").get(city) as { lat: number; lon: number } | undefined;
    if (!row) return null;
    const meta = db.prepare("SELECT min_lon, min_lat, max_lon, max_lat FROM city_map_meta WHERE city_name = ?").get(city) as
      { min_lon: number; min_lat: number; max_lon: number; max_lat: number } | undefined;
    if (meta) return { lon: (meta.min_lon + meta.max_lon) / 2, lat: (meta.min_lat + meta.max_lat) / 2, name: city };
    return { lon: Number(row.lon), lat: Number(row.lat), name: city };
  } catch { return null; }
}

/**
 * THE DEALS AS A MAP SOURCE. Every placed building of this city, labelled with
 * the neighbourhood its deals were reported under — one point per building,
 * the majority neighbourhood when the reports disagree, and only the
 * neighbourhoods the price data knows (the ones the map has to join to).
 */
function loadHoodBuildings(db: Database.Database, city: string, ourNames: Set<string>): Array<{ lon: number; lat: number; hood: string }> {
  try {
    const rows = db.prepare(
      `SELECT street, house_num, neighborhood, COUNT(*) n FROM nadlan_transactions
        WHERE city_name = ? AND neighborhood IS NOT NULL AND neighborhood != ''
          AND street IS NOT NULL AND street != '' AND house_num IS NOT NULL AND house_num != ''
          AND COALESCE(excluded,0) = 0
        GROUP BY street, house_num, neighborhood`
    ).all(city) as Array<{ street: string; house_num: string; neighborhood: string; n: number }>;
    const geos = db.prepare(
      `SELECT street_norm, house_norm, lon, lat FROM address_geocodes
        WHERE city_name = ? AND level = 'house' AND lon IS NOT NULL AND lat IS NOT NULL`
    ).all(city) as Array<{ street_norm: string; house_norm: string; lon: number; lat: number }>;
    const at = new Map(geos.map((g) => [addressKeyString({ streetNorm: g.street_norm, houseNorm: g.house_norm }), g]));
    // the most common spelling of each neighbourhood key, so the shape's name is the deals' own
    const spelling = new Map<string, { name: string; n: number }>();
    const best = new Map<string, { hood: string; n: number; lon: number; lat: number }>();
    for (const r of rows) {
      const key = addressKey(city, r.street, r.house_num);
      if (!key || !key.houseNorm) continue;
      const g = at.get(addressKeyString(key));
      if (!g) continue;
      const hk = normHoodKey(r.neighborhood);
      if (!ourNames.has(hk)) continue;
      const sp = spelling.get(hk);
      if (!sp || Number(r.n) > sp.n) spelling.set(hk, { name: r.neighborhood, n: Number(r.n) });
      const k = addressKeyString(key);
      const cur = best.get(k);
      if (!cur || Number(r.n) > cur.n) best.set(k, { hood: hk, n: Number(r.n), lon: Number(g.lon), lat: Number(g.lat) });
    }
    return [...best.values()].map((b) => ({ lon: b.lon, lat: b.lat, hood: spelling.get(b.hood)!.name }));
  } catch { return []; }
}

/** The frame of a point cloud without its outliers: a building geocoded into
 *  the next town must not stretch the whole map. 2nd–98th percentile per axis. */
function robustBBox(pts: Array<{ lon: number; lat: number }>, trim = 0.02): BBox {
  const lons = pts.map((p) => p.lon).sort((a, b) => a - b);
  const lats = pts.map((p) => p.lat).sort((a, b) => a - b);
  const lo = Math.floor(trim * (pts.length - 1)), hi = Math.ceil((1 - trim) * (pts.length - 1));
  return { minLon: lons[lo], maxLon: lons[hi], minLat: lats[lo], maxLat: lats[hi] };
}

function padBBox(b: BBox, frac: number): BBox {
  const padLon = (b.maxLon - b.minLon) * frac, padLat = (b.maxLat - b.minLat) * frac;
  return { minLon: b.minLon - padLon, maxLon: b.maxLon + padLon, minLat: b.minLat - padLat, maxLat: b.maxLat + padLat };
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

/** Seconds between cities in --all: one free Overpass, many cities. */
const PAUSE_BETWEEN_CITIES_MS = 8_000;
const MINUTE = 60_000;

async function main(): Promise<number> {
  const city = arg("city");
  const all = process.argv.includes("--all");
  const dry = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  // --all only: stop starting new cities after this many minutes (the nightly
  // fan-out's share); the cities left over are picked up the next night.
  const budgetMin = Number(arg("budget-min") ?? 0);
  const deadline = budgetMin > 0 ? Date.now() + budgetMin * MINUTE : Infinity;
  if (!city && !all) {
    console.error('חסר --city. דוגמה: npx tsx scripts/collect-city-map.ts --city "תל אביב-יפו"  (או --all לכל הערים עם נתוני שכונות)');
    return 1;
  }

  const db = new Database(DB);
  db.pragma("busy_timeout = 30000");
  ensureTables(db);

  if (!all) return collectCity(db, city!, { dry, force });

  // EVERY CITY THAT HAS SOMETHING TO DRAW. The deploy collected the pilot
  // city only; a city page without shapes shows no map, whatever its deals
  // and geocodes say (measured 6.9.2026: one mapped city out of 165). The
  // list is derived — cities with priced neighbourhoods, biggest first —
  // and a city that already has a map is skipped unless --force, so a
  // stopped run resumes where it left off and a rerun costs Overpass nothing.
  const cities = (db.prepare(
    `SELECT s.city_name, COUNT(*) c FROM neighborhood_year_stats s GROUP BY s.city_name ORDER BY c DESC`
  ).all() as Array<{ city_name: string; c: number }>).map((r) => r.city_name);
  // "Mapped" means mapped ENOUGH: shapes for at least half of the priced
  // neighbourhoods (and at least 3). A city whose OSM polygons covered 8 of
  // 39 neighbourhoods is re-collected, so that the deals-based regions get
  // their chance; a city that neither source can draw better keeps being
  // retried under the nightly budget, which is bounded and rare.
  const shapeCounts = new Map((db.prepare(
    "SELECT city_name, COUNT(*) c FROM neighborhood_shapes GROUP BY city_name").all() as Array<{ city_name: string; c: number }>)
    .map((r) => [r.city_name, Number(r.c)]));
  const hoodCounts = new Map((db.prepare(
    "SELECT city_name, COUNT(DISTINCT neighborhood) c FROM neighborhood_year_stats GROUP BY city_name").all() as Array<{ city_name: string; c: number }>)
    .map((r) => [r.city_name, Number(r.c)]));
  const mappedEnough = (c: string) => {
    const shapes = shapeCounts.get(c) ?? 0;
    return shapes >= 3 && shapes >= 0.5 * (hoodCounts.get(c) ?? 0);
  };
  const mapped = cities.filter(mappedEnough);
  const todo = force ? cities : cities.filter((c) => !mappedEnough(c));
  console.log(`── מפות לכל הערים: ${todo.length} לאיסוף (${mapped.length} כבר ממופות מספיק, ${cities.length} עם נתוני שכונות) ──`);
  let okN = 0, failN = 0;
  const failed: string[] = [];
  for (let i = 0; i < todo.length; i++) {
    const c = todo[i];
    if (Date.now() > deadline) { console.log(`\n⏸  תקציב הזמן (${budgetMin} דק׳) נגמר — ${todo.length - i} ערים יאספו בריצה הבאה`); break; }
    console.log(`\n[${i + 1}/${todo.length}] ${c}`);
    let code = 1;
    // a city in the list is there because its map is missing or thin — recollect it
    try { code = await collectCity(db, c, { dry, force: true }); }
    catch (e) { console.error(`✗ ${c}: ${e instanceof Error ? e.message : String(e)}`); }
    if (code === 0) okN++; else { failN++; failed.push(c); }
    if (i < todo.length - 1) await sleep(PAUSE_BETWEEN_CITIES_MS);
  }
  console.log(`\n── סיכום: ${okN} ערים נשמרו · ${failN} נכשלו${failed.length ? ` (${failed.slice(0, 20).join(" · ")}${failed.length > 20 ? " …" : ""})` : ""} ──`);
  console.log("   עיר שנכשלה: בדרך כלל אין ל-OSM שכונות מתויגות בשמות שלנו, או שה-Overpass היה עמוס — ריצה חוזרת מנסה רק את מה שחסר.");
  return failN && !okN ? 1 : 0;
}

async function collectCity(db: Database.Database, city: string, { dry, force }: { dry: boolean; force: boolean }): Promise<number> {
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

  // ── the deals-based candidate (database only, no network) ──
  // MEASURED 7.9.2026: OSM had usable neighbourhood polygons for 7 of 73
  // cities. The deals themselves carry the neighbourhood in the site's own
  // spelling, and the geocodes put a coordinate under them — lib/hoodRegions
  // turns that into regions. Computed first, because when it works the frame
  // is the city's own and the Overpass box shrinks from 22 km to the city.
  const buildings = loadHoodBuildings(db, city, ourNames);
  let dealFrame: BBox | null = null;
  let dealShapes: HoodShape[] = [];
  if (buildings.length >= 30) {
    dealFrame = padBBox(robustBBox(buildings), 0.06);
    const proj = makeProjector(dealFrame);
    const hoods = [...new Set(buildings.map((b) => b.hood))];
    const hoodIdx = new Map(hoods.map((h, i) => [h, i]));
    const pts: LabelledPoint[] = buildings
      .map((b) => { const [x, y] = proj([b.lon, b.lat]); return { x, y, hood: hoodIdx.get(b.hood)! }; })
      .filter((p) => p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 1000);
    dealShapes = buildHoodShapes(pts, hoods);
    console.log(`  מהעסקאות: ${buildings.length} בניינים ממוקמים ב-${hoods.length} שכונות → ${dealShapes.length} אזורים`);
  } else {
    console.log(`  מהעסקאות: רק ${buildings.length} בניינים ממוקמים — לא מספיק לאזורים`);
  }
  const dealsUsable = dealShapes.length >= 3;

  let elements: OsmElement[] = [];
  let centre: { lon: number; lat: number; name: string } | null = dealsUsable ? null : centreFromDb(db, city);
  let lastTransportError = "";
  if (centre) console.log(`  מרכז העיר מהמאגר (${centre.lat.toFixed(4)}, ${centre.lon.toFixed(4)})`);
  else if (!dealsUsable) console.log(`מחפש את ${city} ב-OpenStreetMap…`);

  // Rounds cover a busy Overpass, not a wrong name: a lookup that ANSWERS with
  // no match is final, and retrying it would only be ruder to a free service.
  for (let round = 0; round < ROUNDS && !centre && !dealsUsable; round++) {
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
  if (!centre && !dealsUsable) {
    console.error(`✗ ל-OpenStreetMap אין נקודת מקום בשם שתואם ל״${city}״.`);
    console.error("  הרשימה למעלה היא מה שכן נמצא — בדקו ב-openstreetmap.org");
    return 1;
  }

  // The box: the city's own frame when the deals gave one (roads and any OSM
  // polygons inside it), else the wide box around the centre as before.
  const searchBox: BBox = dealsUsable
    ? padBBox(dealFrame!, 0.05)
    : { minLon: centre!.lon - BOX_LON, maxLon: centre!.lon + BOX_LON, minLat: centre!.lat - BOX_LAT, maxLat: centre!.lat + BOX_LAT };
  console.log(dealsUsable ? `מושך כבישים ומים במסגרת העיר…` : `מושך תיבה סביב ${centre!.name} (${centre!.lat.toFixed(4)}, ${centre!.lon.toFixed(4)})…`);
  try {
    elements = await fetchOverpass(buildQuery(searchBox));
  } catch (e) {
    console.error(`✗ משיכת השכבות נכשלה. ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  console.log(`התקבלו ${elements.length} אלמנטים`);
  if (elements.length === 0 && !dealsUsable) {
    console.error("✗ אין בתיבה שכונות/כבישים מתויגים");
    return 1;
  }

  // ── which of the box's neighbourhoods are this city's ──
  const boxShapes = elements
    .filter((el) => el.tags?.place && el.tags?.name)
    .map((el) => (ringsOf(el).length ? { el, name: el.tags!.name! } : null))
    .filter((x): x is { el: OsmElement; name: string } => x !== null);

  const { kept, joined } = keepOurs(boxShapes, ourNames);
  console.log(`  שכונות בתיבה: ${boxShapes.length} · הותאמו לרשימה שלנו: ${joined} · נשמרות: ${kept.length}`);
  // WHICH SOURCE DRAWS THE NEIGHBOURHOODS. OSM polygons when they cover at
  // least as many of the city's neighbourhoods as the deals do (they are
  // surveyed outlines, not inferred ones); otherwise the deals' regions.
  const useOsm = joined >= 3 && joined >= dealShapes.length;
  if (!useOsm && !dealsUsable) {
    console.error(`✗ רק ${joined} שכונות בתיבה מתאימות לשמות של ${city} — לא מספיק כדי לקבוע מה שייך לעיר`);
    console.error(`  שמות שנמצאו בתיבה: ${boxShapes.slice(0, 12).map((s) => s.name).join(" · ")}`);
    return 1;
  }
  const source: "osm" | "deals" = useOsm ? "osm" : "deals";
  console.log(`  מקור השכונות: ${useOsm ? "OSM (מצולעים מסוקרים)" : "העסקאות (אזורים מחושבים מהבניינים הממוקמים)"} · OSM ${joined} · עסקאות ${dealShapes.length}`);
  const keptEls = new Set(useOsm ? kept.map((k) => k.el) : []);
  // Everything that is not a neighbourhood (roads, water) stays; the
  // neighbourhoods are cut down to the city's own — or dropped entirely when
  // the deals draw them.
  elements = elements.filter((el) => !(el.tags?.place && el.tags?.name) || keptEls.has(el));

  // ── pass 1: the frame ──
  // The extent of the CITY'S OWN neighbourhoods, not of everything fetched. The
  // search box is ~22km across so that it certainly contains the city; framing
  // the map on it would draw the city as a small blob in the middle of three
  // other municipalities' road networks.
  let bbox: BBox = emptyBBox();
  if (useOsm) {
    for (const k of kept) for (const r of ringsOf(k.el)) for (const p of r) bbox = extendBBox(bbox, p);
    if (bboxIsEmpty(bbox)) { console.error("✗ לא נמצאה גיאומטריה"); return 1; }
    // A little air, so a neighbourhood does not touch the edge of the picture.
    bbox = padBBox(bbox, 0.06);
  } else {
    // the frame the regions were computed in — the same projector, exactly
    bbox = dealFrame!;
  }
  const projectPoint = makeProjector(bbox);

  /* Anything entirely outside the frame is dropped rather than projected off
     the canvas: the SVG would clip it anyway, and shipping coordinates for a
     road in the next city is pure payload. */
  const insideFrame = (pts: LonLat[]) =>
    pts.some((p) => p[0] >= bbox.minLon && p[0] <= bbox.maxLon && p[1] >= bbox.minLat && p[1] <= bbox.maxLat);

  // ── pass 2: build the three layers ──
  const shapes: Array<{ name: string; path: string; cx: number; cy: number; osmId: number | null; points: number }> = [];
  const lines: Array<{ kind: string; rank: number; name: string | null; path: string; length: number }> = [];
  let rawPoints = 0, keptPoints = 0;
  if (!useOsm) {
    for (const d of dealShapes) {
      shapes.push({ name: d.hood, path: ringsToPath(d.rings), cx: d.cx, cy: d.cy, osmId: null, points: d.points });
      keptPoints += d.rings.reduce((n, r) => n + r.length, 0);
    }
  }

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
    const length = lineLength(simplified);
    // A named road is kept whatever its length — it may be a label anchor.
    if (!isCoast && !tags.name && length < MIN_ROAD_LENGTH) continue;
    lines.push({
      kind: isCoast ? "coast" : "road",
      rank: isCoast ? 8 : roadRank!,
      name: tags.name ?? null,
      path: lineToPath(simplified),
      length,
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
       VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`
    );
    for (const s of shapes) insShape.run(city, s.name, normHoodKey(s.name), s.path, s.cx, s.cy, s.osmId, source);
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

  console.log(`✓ נשמר ל${city} (${shapes.length} שכונות, מקור: ${source})`);
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
