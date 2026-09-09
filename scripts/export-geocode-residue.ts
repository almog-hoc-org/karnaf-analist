#!/usr/bin/env tsx
/**
 * THE SERVER HALF, STEP ONE: which addresses still have no coordinate.
 *
 * Reads the deal repository and address_geocodes, and writes one JSON file
 * per city under data/geocode_todo/ with the distinct normalised addresses
 * that have deals but no house-level geocode — the residue the national
 * file did not cover. The Mac half (scripts/geocode-govmap-residue.ts) asks
 * govmap about exactly these and nothing else. DB-only, safe anywhere.
 *
 * Gap-first: cities with the most un-located addresses come first, so the
 * busiest neighbourhoods get their pins before the long tail. --budget caps
 * the number of addresses exported per run; --city restricts to one city.
 *
 *   npx tsx scripts/export-geocode-residue.ts [--city "חיפה"] [--budget 20000] [--out data/geocode_todo]
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { addressKey, addressKeyString } from "../lib/addressKey";
import { ensureGeocodeTablesSync } from "../lib/geocodeDb";
import { orderCitiesByGap } from "../lib/addressBackfill";

const DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db");
const argv = process.argv.slice(2);
const arg = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = path.resolve(arg("out") ?? path.join(process.env.KARNAF_DATA_DIR ?? "./data", "geocode_todo"));
const BUDGET = Number(arg("budget") ?? 0) || Infinity;
const ONLY = arg("city");
/** bump when the geocoder's method changes and 'none' answers deserve another ask */
/**
 * Bumped to v2 on 9.9.2026: the town-name check rejected correct answers
 * whose Hebrew spelling of an Arabic name differed from ours (lib/geocode
 * answerMentionsTown), and every one of those addresses was recorded as
 * "asked, no answer" — so a rerun would have skipped them. A new version
 * re-asks exactly the addresses that came back empty, and nothing else:
 * a house-level geocode is never re-asked, whatever the version.
 */
export const GEOCODE_METHOD = "geocode-v2";

/** filesystem-safe city name — the same rule as capture-govmap-addresses.ts */
export function cityFileName(city: string): string {
  return city.replace(/[^֐-׿A-Za-z0-9-]+/g, "_");
}

export interface TodoAddress { street: string; houseNum: string; streetNorm: string; houseNorm: string; deals: number }

function main(): number {
  const db = new Database(DB, { readonly: false });
  db.pragma("busy_timeout = 60000");
  ensureGeocodeTablesSync(db);
  fs.mkdirSync(OUT, { recursive: true });

  const cities = (ONLY ? [{ city_name: ONLY }] :
    db.prepare("SELECT DISTINCT city_name FROM nadlan_transactions WHERE street IS NOT NULL AND street != '' AND house_num IS NOT NULL AND house_num != ''").all()) as Array<{ city_name: string }>;
  const already = db.prepare(`SELECT 1 FROM govmap_geocode_status WHERE city_name=? AND status='ok' AND method_version=?`);
  const perCity: Array<{ city: string; todo: TodoAddress[]; missing: number }> = [];

  for (const { city_name } of cities) {
    if (!ONLY && already.get(city_name, GEOCODE_METHOD)) continue;
    const rows = db.prepare(
      `SELECT street, house_num, COUNT(*) n FROM nadlan_transactions
        WHERE city_name = ? AND street IS NOT NULL AND street != '' AND house_num IS NOT NULL AND house_num != ''
          AND COALESCE(excluded,0) = 0
        GROUP BY street, house_num`
    ).all(city_name) as Array<{ street: string; house_num: string; n: number }>;
    const have = new Set(
      (db.prepare(`SELECT street_norm, house_norm FROM address_geocodes WHERE city_name = ? AND level = 'house'`).all(city_name) as
        Array<{ street_norm: string; house_norm: string }>).map((r) => addressKeyString({ streetNorm: r.street_norm, houseNorm: r.house_norm }))
    );
    const asked = new Set(
      (db.prepare(`SELECT street_norm, house_norm FROM address_geocodes WHERE city_name = ? AND level = 'none' AND raw_label = ?`).all(city_name, GEOCODE_METHOD) as
        Array<{ street_norm: string; house_norm: string }>).map((r) => addressKeyString({ streetNorm: r.street_norm, houseNorm: r.house_norm }))
    );
    const seen = new Map<string, TodoAddress>();
    for (const r of rows) {
      const k = addressKey(city_name, r.street, r.house_num);
      if (!k || !k.houseNorm) continue;
      const ks = addressKeyString(k);
      if (have.has(ks) || asked.has(ks)) continue;
      const cur = seen.get(ks);
      if (cur) { cur.deals += Number(r.n); continue; }
      seen.set(ks, { street: r.street.trim(), houseNum: String(r.house_num).trim(), streetNorm: k.streetNorm, houseNorm: k.houseNorm, deals: Number(r.n) });
    }
    const todo = [...seen.values()].sort((a, b) => b.deals - a.deals);
    if (todo.length) perCity.push({ city: city_name, todo, missing: todo.reduce((s, t) => s + t.deals, 0) });
  }

  let exported = 0, files = 0;
  const order: string[] = [];
  for (const c of orderCitiesByGap(perCity)) {
    if (exported >= BUDGET) break;
    const slice = c.todo.slice(0, Math.max(0, BUDGET - exported));
    const file = path.join(OUT, `${cityFileName(c.city)}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ city: c.city, method: GEOCODE_METHOD, addresses: slice }));
    fs.renameSync(`${file}.tmp`, file);
    exported += slice.length; files++;
    order.push(path.basename(file));
    console.log(`${c.city}: ${slice.length.toLocaleString("en")} כתובות (${c.missing.toLocaleString("en")} עסקאות ללא מיקום) → ${file}`);
  }
  // The order the Mac should ask in — gap first. A shell glob is alphabetical,
  // and alphabetical put אבו גוש before באר שבע (7.9.2026).
  fs.writeFileSync(path.join(OUT, "order.txt"), order.join("\n") + (order.length ? "\n" : ""));
  console.log(`\n--- ${files} ערים, ${exported.toLocaleString("en")} כתובות לגיאוקוד ב-${OUT} ---`);
  return 0;
}

process.exit(main());
