#!/usr/bin/env tsx
/**
 * A synthetic city map, for developing and testing the RENDERING without the
 * network.
 *
 * WHY THIS EXISTS
 * The real geometry comes from Overpass, which is unreachable from the
 * development sandbox (gateway policy — measured: 403 on CONNECT). Without a
 * fixture the map component could only ever be looked at in production, which
 * is the wrong place to discover that a polygon is inside out.
 *
 * WHAT IT IS NOT: it is not data. The shapes are rectangles over a made-up
 * city, and it only ever writes to a city name that cannot collide with a real
 * one. Never run it against a city that has real collected geometry — and it
 * refuses to, rather than trusting the operator to remember.
 *
 *   npx tsx scripts/seed-city-map-fixture.ts [--city "עיר לדוגמה"]
 */
import Database from "better-sqlite3";
import path from "path";
import { normHoodKey } from "../lib/hoodKey";

const DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db");
const DEFAULT_CITY = "תל אביב-יפו";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** A 3×2 grid of neighbourhoods over a 1000×1000 box, with a margin. */
function grid(city: string) {
  const names = ["צפון", "מרכז", "דרום", "מזרח", "מערב", "עתיק"];
  const cols = 3, rows = 2, pad = 60;
  const w = (1000 - pad * 2) / cols;
  const h = (1000 - pad * 2) / rows;
  return names.map((name, i) => {
    const cx0 = pad + (i % cols) * w;
    const cy0 = pad + Math.floor(i / cols) * h;
    const x1 = +(cx0 + w - 8).toFixed(2), y1 = +(cy0 + h - 8).toFixed(2);
    const x0 = +cx0.toFixed(2), y0 = +cy0.toFixed(2);
    return {
      city, name,
      path: `M${x0},${y0}L${x1},${y0}L${x1},${y1}L${x0},${y1}Z`,
      cx: +((x0 + x1) / 2).toFixed(2),
      cy: +((y0 + y1) / 2).toFixed(2),
    };
  });
}

function main(): number {
  const city = arg("city") ?? DEFAULT_CITY;
  const db = new Database(DB);
  db.pragma("busy_timeout = 30000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS neighborhood_shapes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, city_name TEXT NOT NULL, neighborhood TEXT NOT NULL,
      norm_name TEXT NOT NULL, path_d TEXT NOT NULL, cx REAL, cy REAL, osm_id INTEGER,
      source TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS idx_shapes_city ON neighborhood_shapes(city_name);
    CREATE TABLE IF NOT EXISTS city_map_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT, city_name TEXT NOT NULL, kind TEXT NOT NULL,
      rank INTEGER NOT NULL, name TEXT, path_d TEXT NOT NULL, length REAL);
    CREATE INDEX IF NOT EXISTS idx_maplines_city ON city_map_lines(city_name, rank);
    CREATE TABLE IF NOT EXISTS city_map_meta (
      city_name TEXT PRIMARY KEY, min_lon REAL, min_lat REAL, max_lon REAL, max_lat REAL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  `);

  // Refuse to overwrite anything the real collector produced.
  const real = db.prepare(
    "SELECT COUNT(*) c FROM neighborhood_shapes WHERE city_name=? AND source='osm'"
  ).get(city) as { c: number };
  if (real.c > 0) {
    console.error(`✗ ל${city} יש ${real.c} צורות אמיתיות מ-OSM. הפיקסצ׳ר לא ידרוס אותן.`);
    return 1;
  }

  // The section needs PRICES as well as shapes — without them
  // neighborhoodSummary returns nothing and the whole block renders null, so
  // there would be no map to look at. Only seeded when the city has no
  // neighbourhood cells at all, which is true of a development database and
  // never of the live one.
  db.exec(`CREATE TABLE IF NOT EXISTS neighborhood_year_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT, city_name TEXT NOT NULL, neighborhood TEXT NOT NULL,
    year INTEGER NOT NULL, room_bucket TEXT NOT NULL, scope TEXT NOT NULL,
    avg_sqm REAL, median_sqm REAL, median_price REAL, n INTEGER DEFAULT 0)`);
  const priced = db.prepare("SELECT COUNT(*) c FROM neighborhood_year_stats WHERE city_name=?").get(city) as { c: number };

  const cells = grid(city);
  const write = db.transaction(() => {
    db.prepare("DELETE FROM neighborhood_shapes WHERE city_name=?").run(city);
    db.prepare("DELETE FROM city_map_lines WHERE city_name=?").run(city);
    const ins = db.prepare(
      `INSERT INTO neighborhood_shapes (city_name, neighborhood, norm_name, path_d, cx, cy, source)
       VALUES (?,?,?,?,?,?,'fixture')`
    );
    for (const c of cells) ins.run(c.city, c.name, normHoodKey(c.name), c.path, c.cx, c.cy);

    const insLine = db.prepare(
      "INSERT INTO city_map_lines (city_name, kind, rank, name, path_d, length) VALUES (?,?,?,?,?,?)"
    );
    // two arteries and a river, so the layer order is visible
    insLine.run(city, "road", 1, "כביש ראשי", "M0,500L1000,520", 1000);
    insLine.run(city, "road", 3, "שדרה", "M500,0L520,1000", 1000);
    insLine.run(city, "water", 9, null, "M0,0L120,0L140,1000L0,1000Z", 0);
    db.prepare(
      `INSERT INTO city_map_meta (city_name, min_lon, min_lat, max_lon, max_lat)
       VALUES (?,?,?,?,?) ON CONFLICT(city_name) DO NOTHING`
    ).run(city, 34.7, 32.0, 34.85, 32.15);

    if (priced.c === 0) {
      const insCell = db.prepare(
        `INSERT INTO neighborhood_year_stats (city_name, neighborhood, year, room_bucket, scope, avg_sqm, median_sqm, median_price, n)
         VALUES (?,?,?, 'all', 'secondhand', ?,?,?,?)`
      );
      // Five of six get prices; the sixth stays blank on purpose, so the
      // "no data" shade has something to render in development.
      cells.forEach((c, i) => {
        if (i === cells.length - 1) return;
        const base = 30_000 + i * 9_000;
        for (const [year, factor] of [[2022, 0.82], [2025, 1]] as const) {
          insCell.run(c.city, c.name, year, base * factor, base * factor, base * factor * 95, 40 + i * 7);
        }
      });
    }
  });
  write();

  console.log(`✓ פיקסצ׳ר ל${city}: ${cells.length} שכונות, 2 כבישים, מים${priced.c === 0 ? ", ומחירים סינתטיים" : ""}`);
  console.log("  (שרטוט סינתטי לפיתוח בלבד — לא נתונים)");
  return 0;
}

process.exit(main());

export {};
