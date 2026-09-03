#!/usr/bin/env tsx
/**
 * THE SERVER HALF, STEP TWO: write the Mac's answers into address_geocodes.
 *
 * ITM → WGS84 through lib/itm.ts; precedence through chooseGeocode — a
 * house-level answer from the national file is never replaced by govmap's,
 * and a street-level govmap answer never overwrites a house-level one.
 * Addresses govmap could not place are recorded as level 'none' with the
 * method version as the label, so the next export skips them until the
 * method changes. Per-city status in govmap_geocode_status, the campaign's
 * checkpoint table (mirror of govmap_address_backfill_status).
 *
 *   npx tsx scripts/apply-geocodes.ts data/geocode_done/<city>.json [...]
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { ensureGeocodeTablesSync } from "../lib/geocodeDb";
import { chooseGeocode, type Geocode } from "../lib/geocode";
import { itmToWgs84 } from "../lib/itm";
import type { GeocodeAnswer } from "./geocode-govmap-residue";

const DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db");
const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));

function main(): number {
  if (!files.length) { console.error("שימוש: apply-geocodes.ts <done.json> [...]"); return 1; }
  const db = new Database(DB);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 60000");
  ensureGeocodeTablesSync(db);

  const existing = db.prepare("SELECT lon, lat, itm_x, itm_y, level, source FROM address_geocodes WHERE city_name=? AND street_norm=? AND house_norm=?");
  const upsert = db.prepare(`INSERT INTO address_geocodes (city_name, street_norm, house_norm, lon, lat, itm_x, itm_y, level, source, raw_label, geocoded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'))
    ON CONFLICT(city_name, street_norm, house_norm) DO UPDATE SET
      lon=excluded.lon, lat=excluded.lat, itm_x=excluded.itm_x, itm_y=excluded.itm_y,
      level=excluded.level, source=excluded.source, raw_label=excluded.raw_label, geocoded_at=excluded.geocoded_at`);
  const status = db.prepare(`INSERT INTO govmap_geocode_status (city_name, method_version, status, attempts, requested, house_level, street_level, failed, last_run)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(city_name) DO UPDATE SET method_version=excluded.method_version, status=excluded.status,
      attempts=govmap_geocode_status.attempts+1, requested=excluded.requested, house_level=excluded.house_level,
      street_level=excluded.street_level, failed=excluded.failed, last_run=excluded.last_run`);

  for (const file of files) {
    const { city, method, answers } = JSON.parse(fs.readFileSync(file, "utf8")) as { city: string; method: string; answers: GeocodeAnswer[] };
    let house = 0, street = 0, none = 0, kept = 0;
    db.transaction(() => {
      for (const a of answers) {
        const cur = existing.get(city, a.streetNorm, a.houseNorm) as
          { lon: number; lat: number; itm_x: number; itm_y: number; level: Geocode["level"]; source: Geocode["source"] } | undefined;
        const curG: Geocode | null = cur ? { lon: cur.lon, lat: cur.lat, itmX: cur.itm_x, itmY: cur.itm_y, level: cur.level, source: cur.source } : null;
        let incoming: Geocode;
        if (a.x != null && a.y != null && a.level !== "none") {
          const [lon, lat] = itmToWgs84(a.x, a.y);
          incoming = { lon, lat, itmX: a.x, itmY: a.y, level: a.level, source: "govmap", rawLabel: a.label };
        } else {
          incoming = { lon: null, lat: null, itmX: null, itmY: null, level: "none", source: "govmap", rawLabel: method };
        }
        const chosen = chooseGeocode(curG, incoming);
        if (chosen !== incoming) { kept++; continue; }
        // a street-level answer is stored on the STREET row ('' house) so every
        // number on that street gets the ring, and on the asked row as 'none'
        // so it is not asked again
        if (incoming.level === "street") {
          upsert.run(city, a.streetNorm, "", incoming.lon, incoming.lat, incoming.itmX, incoming.itmY, "street", "govmap", incoming.rawLabel);
          upsert.run(city, a.streetNorm, a.houseNorm, null, null, null, null, "none", "govmap", method);
          street++;
        } else {
          upsert.run(city, a.streetNorm, a.houseNorm, incoming.lon, incoming.lat, incoming.itmX, incoming.itmY, incoming.level, "govmap", incoming.rawLabel);
          if (incoming.level === "house") house++; else none++;
        }
      }
      status.run(city, method, "ok", answers.length, house, street, none);
    })();
    console.log(`✓ ${city}: ${answers.length} תשובות · בית ${house} · רחוב ${street} · ללא ${none} · ${kept} נשארו ממקור עדיף`);
  }
  return 0;
}

process.exit(main());
