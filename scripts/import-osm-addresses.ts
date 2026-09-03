#!/usr/bin/env tsx
/**
 * OPENSTREETMAP HOUSE NUMBERS → address_geocodes, per city, from the server.
 *
 * WHY. The data.gov.il scan (3.9.2026) found no national address file with
 * coordinates, so the bulk free source is OSM: every building or entrance a
 * mapper tagged with `addr:street` + `addr:housenumber`. Coverage varies by
 * city — good in Tel Aviv and Haifa, thin in small towns — and the run
 * prints per city how many it found, so the number is measured, never
 * assumed. It ranks below the government sources (lib/geocode.ts): a
 * surveyed or govmap answer replaces an OSM one, never the reverse.
 *
 * WHERE THE BOX COMES FROM. A city that has a neighbourhood map gets the
 * exact box the map was drawn in (city_map_meta) — every pin then lands
 * inside the drawn frame. Any other city gets a generous box around its OSM
 * place node, the same reach scripts/collect-city-map.ts uses. An element
 * with `addr:city` naming another of our cities is credited to that city.
 *
 * OVERPASS MANNERS. Same endpoints, rounds and backoff as the map
 * collector; one query per city; a city imported within
 * KARNAF_OSM_FRESH_DAYS (60) is skipped unless --force. Fails soft per city.
 *
 *   npx tsx scripts/import-osm-addresses.ts                 # every city with deals, mapped cities first
 *   npx tsx scripts/import-osm-addresses.ts --city "חיפה" [--force]
 *   npx tsx scripts/import-osm-addresses.ts --budget-min 40  # stop starting cities after 40 minutes
 */
import Database from "better-sqlite3";
import path from "path";
import { normalizeCity, canonicalCityName } from "../lib/cityAliases";
import { normHoodKey } from "../lib/hoodKey";
import { ensureGeocodeTablesSync } from "../lib/geocodeDb";
import { chooseGeocode, type Geocode } from "../lib/geocode";
import { addressKeyString } from "../lib/addressKey";
import { streetCentroid } from "../lib/mapiAddresses";
import { boxAround, osmElementToGeocode, overpassAddressQuery, type OsmElement } from "../lib/osmAddresses";
import type { BBox } from "../lib/geo";

const DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db");
const FRESH_DAYS = Number(process.env.KARNAF_OSM_FRESH_DAYS ?? 60);
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
];
const ROUNDS = 3;
const BACKOFF_MS = [0, 15_000, 45_000];
const PAUSE_BETWEEN_CITIES_MS = 4_000;

const argv = process.argv.slice(2);
const arg = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const ONLY = arg("city");
const FORCE = argv.includes("--force");
const BUDGET_MIN = Number(arg("budget-min") ?? 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchOverpass(query: string): Promise<OsmElement[]> {
  const failures: string[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    if (BACKOFF_MS[round]) await sleep(BACKOFF_MS[round]);
    for (const url of ENDPOINTS) {
      const host = new URL(url).host;
      const started = Date.now();
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "karnaf-analist/1.0 (address importer)" },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(200_000),
        });
        const ms = Date.now() - started;
        if (!res.ok) { failures.push(`${host} → ${res.status} אחרי ${ms}ms`); continue; }
        const json = await res.json();
        if (Array.isArray(json?.elements)) return json.elements as OsmElement[];
        failures.push(`${host} → 200 ללא elements`);
      } catch (e) {
        failures.push(`${host} → ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  throw new Error(`כל נקודות הקצה נכשלו:\n    ${failures.join("\n    ")}`);
}

/** The city's OSM place node, for cities the map collector has not framed. */
async function resolveCentre(cityName: string): Promise<{ lat: number; lon: number } | null> {
  const core = cityName.split(/[-–—]/)[0].trim().replace(/"/g, "");
  const found = await fetchOverpass(`[out:json][timeout:90];
(
  node["place"~"^(city|town|village)$"]["name"~"${core}"];
  node["place"~"^(city|town|village)$"]["name:he"~"${core}"];
);
out;`);
  const wanted = normHoodKey(cityName), wantedCore = normHoodKey(core);
  const RANK: Record<string, number> = { city: 0, town: 1, village: 2 };
  const scored = found.map((el) => {
    const t = el.tags ?? {};
    const keys = [t.name, t["name:he"]].filter(Boolean).map((n) => normHoodKey(n!));
    const rank = keys.some((k) => k === wanted) ? 0 : keys.some((k) => k === wantedCore) ? 1 : keys.some((k) => k.includes(wanted) || wanted.includes(k)) ? 2 : 9;
    return { rank, place: RANK[t.place ?? ""] ?? 3, lat: el.lat, lon: el.lon };
  }).filter((c) => c.rank < 9 && c.lat != null && c.lon != null).sort((a, b) => a.rank - b.rank || a.place - b.place);
  return scored[0] ? { lat: scored[0].lat!, lon: scored[0].lon! } : null;
}

async function main(): Promise<number> {
  console.log("🗺  OpenStreetMap → address_geocodes (מספרי בתים)");
  const db = new Database(DB);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 60000");
  ensureGeocodeTablesSync(db);

  const byNorm = new Map<string, string>();
  for (const c of db.prepare("SELECT city_name FROM cities").all() as Array<{ city_name: string }>) byNorm.set(normalizeCity(c.city_name), c.city_name);
  const cityFold = (raw: string): string | null => byNorm.get(normalizeCity(canonicalCityName(raw))) ?? null;

  // cities to visit: the ones with numbered deals, mapped cities first, biggest first
  const cities = ONLY ? [{ city_name: ONLY, n: 0 }] : (db.prepare(
    `SELECT city_name, COUNT(*) n FROM nadlan_transactions
      WHERE street IS NOT NULL AND street != '' AND house_num IS NOT NULL AND house_num != ''
      GROUP BY city_name ORDER BY n DESC`).all() as Array<{ city_name: string; n: number }>);
  const meta = new Map<string, BBox>();
  try {
    for (const m of db.prepare("SELECT city_name, min_lon, min_lat, max_lon, max_lat FROM city_map_meta").all() as
      Array<{ city_name: string; min_lon: number; min_lat: number; max_lon: number; max_lat: number }>) {
      meta.set(m.city_name, { minLon: m.min_lon, minLat: m.min_lat, maxLon: m.max_lon, maxLat: m.max_lat });
    }
  } catch { /* no maps yet */ }
  cities.sort((a, b) => Number(meta.has(b.city_name)) - Number(meta.has(a.city_name)) || b.n - a.n);

  const status = db.prepare("SELECT imported_at FROM osm_address_status WHERE city_name=?");
  const existing = db.prepare("SELECT lon, lat, itm_x, itm_y, level, source FROM address_geocodes WHERE city_name=? AND street_norm=? AND house_norm=?");
  const upsert = db.prepare(`INSERT INTO address_geocodes (city_name, street_norm, house_norm, lon, lat, itm_x, itm_y, level, source, raw_label, geocoded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'))
    ON CONFLICT(city_name, street_norm, house_norm) DO UPDATE SET
      lon=excluded.lon, lat=excluded.lat, itm_x=excluded.itm_x, itm_y=excluded.itm_y,
      level=excluded.level, source=excluded.source, raw_label=excluded.raw_label, geocoded_at=excluded.geocoded_at`);
  const upStatus = db.prepare(`INSERT INTO osm_address_status (city_name, fetched, kept, streets, imported_at) VALUES (?,?,?,?, datetime('now'))
    ON CONFLICT(city_name) DO UPDATE SET fetched=excluded.fetched, kept=excluded.kept, streets=excluded.streets, imported_at=excluded.imported_at`);

  const t0 = Date.now();
  let done = 0, skipped = 0, failed = 0;
  for (const { city_name } of cities) {
    if (BUDGET_MIN > 0 && (Date.now() - t0) / 60000 >= BUDGET_MIN) { console.log(`⏸  תקציב הזמן נגמר — השאר בריצה הבאה`); break; }
    const last = status.get(city_name) as { imported_at: string | null } | undefined;
    if (last?.imported_at && !FORCE) {
      const age = (Date.now() - new Date(last.imported_at).getTime()) / 86_400_000;
      if (age < FRESH_DAYS) { skipped++; continue; }
    }
    const tag = `── ${city_name} ──`;
    try {
      let box = meta.get(city_name) ?? null;
      let how = "מסגרת המפה";
      if (!box) {
        const c = await resolveCentre(city_name);
        if (!c) { console.log(`${tag} אין נקודת מקום ב-OSM — מדלג`); failed++; continue; }
        box = boxAround(c.lat, c.lon);
        how = "תיבה סביב נקודת המקום";
      }
      const elements = await fetchOverpass(overpassAddressQuery(box));
      const seen = new Map<string, ReturnType<typeof osmElementToGeocode>>();
      const byStreet = new Map<string, Array<{ lon: number; lat: number }>>();
      let ours = 0;
      for (const el of elements) {
        const g = osmElementToGeocode(el, city_name, box, cityFold);
        if (!g) continue;
        if (g.key.cityName !== city_name && !byNorm.has(normalizeCity(g.key.cityName))) continue;
        const k = `${g.key.cityName}|${addressKeyString(g.key)}`;
        if (!seen.has(k)) seen.set(k, g);
        if (g.key.cityName === city_name) ours++;
        const sk = `${g.key.cityName}|${g.key.streetNorm}`;
        byStreet.set(sk, [...(byStreet.get(sk) ?? []), { lon: g.lon, lat: g.lat }]);
      }
      let written = 0, kept = 0, streets = 0;
      db.transaction(() => {
        for (const g of seen.values()) {
          if (!g) continue;
          const cur = existing.get(g.key.cityName, g.key.streetNorm, g.key.houseNorm) as
            { lon: number; lat: number; itm_x: number; itm_y: number; level: Geocode["level"]; source: Geocode["source"] } | undefined;
          const incoming: Geocode = { lon: g.lon, lat: g.lat, itmX: g.itmX, itmY: g.itmY, level: "house", source: "osm", rawLabel: g.osmId };
          const chosen = chooseGeocode(cur ? { lon: cur.lon, lat: cur.lat, itmX: cur.itm_x, itmY: cur.itm_y, level: cur.level, source: cur.source } : null, incoming);
          if (chosen !== incoming) { kept++; continue; }
          upsert.run(g.key.cityName, g.key.streetNorm, g.key.houseNorm, g.lon, g.lat, g.itmX, g.itmY, "house", "osm", g.osmId);
          written++;
        }
        for (const [sk, pts] of byStreet) {
          const [city, street] = sk.split("|");
          const c = streetCentroid(pts);
          if (!c) continue;
          const cur = existing.get(city, street, "") as { lon: number; lat: number; itm_x: number; itm_y: number; level: Geocode["level"]; source: Geocode["source"] } | undefined;
          const incoming: Geocode = { lon: c.lon, lat: c.lat, itmX: null, itmY: null, level: "street", source: "osm", rawLabel: `centroid of ${pts.length}` };
          if (chooseGeocode(cur ? { lon: cur.lon, lat: cur.lat, itmX: cur.itm_x, itmY: cur.itm_y, level: cur.level, source: cur.source } : null, incoming) !== incoming) continue;
          upsert.run(city, street, "", c.lon, c.lat, null, null, "street", "osm", `centroid of ${pts.length}`);
          streets++;
        }
        upStatus.run(city_name, elements.length, ours, streets);
      })();
      console.log(`${tag} ${how} · ${elements.length.toLocaleString("en")} אלמנטים · ${ours.toLocaleString("en")} כתובות בעיר · נכתבו ${written.toLocaleString("en")} (${kept} נשארו ממקור עדיף) · ${streets} רחובות`);
      done++;
    } catch (e) {
      console.log(`${tag} נכשל — ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      failed++;
    }
    await sleep(PAUSE_BETWEEN_CITIES_MS);
  }
  console.log(`\n--- ${done} ערים יובאו · ${skipped} טריות (דולגו) · ${failed} נכשלו ---`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error("FATAL", e); process.exit(1); });
