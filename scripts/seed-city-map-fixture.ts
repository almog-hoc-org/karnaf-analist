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

/**
 * Names at REAL Tel Aviv lengths, and at the real count.
 *
 * The list matters as much as the rectangles: the table beside the map has to
 * fit every row inside the map's height without a scrollbar, and that is
 * arithmetic over the row count and the longest name. Six three-letter names
 * would fit any layout and prove nothing. "הצפון החדש סביבת כיכר המדינה" is 28
 * characters — allowed to wrap it doubles its row.
 */
const FIXTURE_NAMES = [
  "הצפון החדש סביבת כיכר המדינה", "הצפון הישן צפון", "הצפון הישן דרום",
  "לב תל אביב", "כרם התימנים", "נווה צדק", "פלורנטין", "שפירא",
  "רמת אביב", "רמת אביב ג", "אפקה", "נאות אפקה", "יד אליהו",
  "רמת החייל", "בבלי", "צהלה", "עג׳מי", "נווה עופר",
];

/** A grid of neighbourhoods over a 1000×1000 box, with a margin. */
function grid(city: string) {
  const names = FIXTURE_NAMES;
  const cols = 5, rows = Math.ceil(names.length / 5), pad = 40;
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

  // Columns production has that an old dev DB may not — the schema drift the
  // Prisma model documents ("added by hand, never here"). Idempotent ALTERs so
  // the aggregation can run against a fixture DB at all.
  for (const ddl of [
    "ALTER TABLE nadlan_transactions ADD COLUMN class_source TEXT",
    "ALTER TABLE nadlan_transactions ADD COLUMN hok_hamecher INTEGER",
    "ALTER TABLE nadlan_transactions ADD COLUMN prev_deals INTEGER",
    "ALTER TABLE nadlan_transactions ADD COLUMN rooms_effective REAL",
    "ALTER TABLE nadlan_transactions ADD COLUMN room_reclassified INTEGER DEFAULT 0",
  ]) {
    try { db.exec(ddl); } catch { /* already present */ }
  }

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
  // THE AGGREGATION'S OWN SHAPE, verbatim. This fixture used to declare the
  // same table with a different one (id PK, no avg_price) — and since both
  // sides say CREATE TABLE IF NOT EXISTS, whichever ran first silently won,
  // and the aggregation's insert then failed on a dev DB the fixture had
  // touched. One name, one shape.
  db.exec(`CREATE TABLE IF NOT EXISTS neighborhood_year_stats (
    city_name TEXT NOT NULL, neighborhood TEXT NOT NULL, year INTEGER NOT NULL,
    room_bucket TEXT NOT NULL, scope TEXT NOT NULL,
    avg_price REAL, median_price REAL, avg_sqm REAL, median_sqm REAL, n INTEGER NOT NULL,
    PRIMARY KEY (city_name, neighborhood, year, room_bucket, scope))`);
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
        `INSERT INTO neighborhood_year_stats (city_name, neighborhood, year, room_bucket, scope, avg_sqm, median_sqm, median_price, avg_price, n)
         VALUES (?,?,?, 'all', 'secondhand', ?,?,?,?,?)`
      );
      const insCellBucket = db.prepare(
        `INSERT INTO neighborhood_year_stats (city_name, neighborhood, year, room_bucket, scope, avg_sqm, median_sqm, median_price, avg_price, n)
         VALUES (?,?,?,?, 'secondhand', ?,?,?,?,?)`
      );
      // All but the last two get prices; those stay blank on purpose, so the
      // "no data" hatch has something to render in development.
      cells.forEach((c, i) => {
        if (i >= cells.length - 2) return;
        const base = 30_000 + i * 1_900;
        for (const [year, factor] of [[2022, 0.82], [2025, 1]] as const) {
          insCell.run(c.city, c.name, year, base * factor, base * factor, base * factor * 95, base * factor * 98, 40 + i * 7);
          // Room buckets 3 and 4, and deliberately NOT 5 — the rooms filter
          // needs both a bucket with data and one without, so the empty-state
          // message can be seen in development.
          insCellBucket.run(c.city, c.name, year, "3", base * factor * 1.06, base * factor * 1.06, base * factor * 80, base * factor * 82, 15 + i * 2);
          insCellBucket.run(c.city, c.name, year, "4", base * factor * 0.97, base * factor * 0.97, base * factor * 105, base * factor * 108, 18 + i * 3);
        }
      });

      /* Deals too. The panel that opens on a click reads nadlan_transactions
         directly, so without rows here a click renders "אין עסקאות" and the
         whole interaction is unmeasurable outside production. Idempotent:
         re-seeding starts by clearing the previous fixture deals, or every
         run would stack another 640 rows onto the last one's. */
      db.prepare("DELETE FROM nadlan_transactions WHERE city_name=? AND source='fixture'").run(city);
      const insTx = db.prepare(
        `INSERT INTO nadlan_transactions
           (city_name, neighborhood, deal_date, deal_year, rooms, room_bucket, area, price,
            price_sqm, year_built, is_secondhand, source, street, house_num, floor, excluded)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, 'fixture', ?,?,?,0)`
      );
      cells.forEach((c, i) => {
        if (i >= cells.length - 2) return;
        const sqm = 30_000 + i * 1_900;
        for (let d = 0; d < 40; d++) {
          const area = 70 + (d % 5) * 12;
          const rooms = 3 + (d % 3);
          const price = Math.round(sqm * area * (0.9 + (d % 7) / 35));
          insTx.run(
            city, c.name, `2025-${String(1 + (d % 12)).padStart(2, "0")}-${String(1 + (d % 27)).padStart(2, "0")}`,
            2025, rooms, String(Math.min(5, Math.max(3, rooms))), area, price,
            Math.round(price / area), 1998 + (d % 20), d % 4 === 0 ? 0 : 1,
            // A distinct, digit-free street per hood. The old "רחוב הדוגמה N"
            // all collapsed into ONE street once the search indexer stripped
            // the trailing number — correctly rejected as hood-split, and
            // therefore untestable. Real streets do not end in digits.
            `שדרות ${c.name}`, String(10 + d), String(1 + (d % 9))
          );
        }
      });
    }
  });
  write();

  console.log(`✓ פיקסצ׳ר ל${city}: ${cells.length} שכונות, 2 כבישים, מים${priced.c === 0 ? ", מחירים ועסקאות סינתטיים" : ""}`);
  console.log("  (שרטוט סינתטי לפיתוח בלבד — לא נתונים)");
  return 0;
}

process.exit(main());

export {};
