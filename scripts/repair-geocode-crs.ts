#!/usr/bin/env tsx
/**
 * One-off repair (server, database only): geocodes whose lon/lat are not in
 * Israel, recomputed from the raw x/y the source gave.
 *
 * WHY. apply-geocodes.ts converted every govmap answer as ITM. govmap's
 * autocomplete answers in Web Mercator (measured 7.9.2026, Bat Yam), so
 * 1,727 buildings were written at lon 93°, lat 46°. The raw x/y were kept
 * in itm_x/itm_y, so the fix is arithmetic, not a re-fetch: lib/itm
 * anyToWgs84 detects the CRS from the magnitude. A row whose raw pair is
 * in no known system becomes level 'none' with no coordinate — better an
 * honest gap than a pin in Mongolia.
 *
 *   npx tsx scripts/repair-geocode-crs.ts [--dry-run]
 *
 * After it, any city map collected while the bad rows existed must be
 * re-collected: the script names them.
 */
import Database from "better-sqlite3";
import path from "path";
import { anyToWgs84, looksLikeWgs84 } from "../lib/itm";

const DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db");
const dry = process.argv.includes("--dry-run");

const db = new Database(DB);
db.pragma("busy_timeout = 30000");
const rows = db.prepare(
  `SELECT rowid AS rid, city_name, street_norm, house_norm, lon, lat, itm_x, itm_y, level, source
     FROM address_geocodes WHERE lon IS NOT NULL AND lat IS NOT NULL`
).all() as Array<{ rid: number; city_name: string; street_norm: string; house_norm: string; lon: number; lat: number; itm_x: number | null; itm_y: number | null; level: string; source: string }>;

const bad = rows.filter((r) => !looksLikeWgs84(Number(r.lon), Number(r.lat)));
console.log(`גיאוקודים עם קואורדינטה: ${rows.length.toLocaleString("en")} · מחוץ לישראל: ${bad.length.toLocaleString("en")}`);
const perCity = new Map<string, { fixed: number; dropped: number }>();
const fix = db.prepare("UPDATE address_geocodes SET lon = ?, lat = ? WHERE rowid = ?");
const drop = db.prepare("UPDATE address_geocodes SET lon = NULL, lat = NULL, level = 'none' WHERE rowid = ?");
db.transaction(() => {
  for (const r of bad) {
    const c = perCity.get(r.city_name) ?? { fixed: 0, dropped: 0 };
    const wgs = r.itm_x != null && r.itm_y != null ? anyToWgs84(Number(r.itm_x), Number(r.itm_y)) : null;
    if (wgs) { if (!dry) fix.run(wgs[0], wgs[1], r.rid); c.fixed++; }
    else { if (!dry) drop.run(r.rid); c.dropped++; }
    perCity.set(r.city_name, c);
  }
})();
for (const [city, c] of [...perCity].sort((a, b) => b[1].fixed + b[1].dropped - a[1].fixed - a[1].dropped)) {
  console.log(`  ${city.padEnd(18)} תוקנו ${String(c.fixed).padStart(6)} · הוסרו ${String(c.dropped).padStart(5)}`);
}
if (dry) console.log("(--dry-run — לא נכתב כלום)");
else if (perCity.size) {
  console.log(`\nמפות שנאספו בזמן שהשורות השגויות היו קיימות — לאסוף מחדש:`);
  for (const city of perCity.keys()) console.log(`  npx tsx scripts/collect-city-map.ts --city "${city}" --force`);
}
