#!/usr/bin/env tsx
/**
 * over.org.il's parcel→address table → over_parcel_addresses.
 *
 *   npx tsx scripts/import-over-addresses.ts [--dry-run] [--force] [--file=addresses.csv]
 *
 * Every address in the country tied to its gush-helka ("נדל״ן לעם — כתובות",
 * dataset 88670e58…, republished several times a day). It is what the
 * tax-register promoter asked over.org.il's parcel endpoint for, one parcel
 * per request, 2,000 a night, largest city first — the reason a small town's
 * register deals sat without a street for weeks. With the table here, every
 * parcel is answered at once, and a new project's parcel (no deal reported on
 * it yet, so absent from the govmap mirror) gets the address the register of
 * addresses gives it.
 *
 * Re-imported when a newer version exists and the last import is at least six
 * days old (the addresses of a building do not move nightly), or with --force.
 * One DELETE+INSERT transaction; under MIN_ROWS rows nothing is written.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import readline from "readline";
import { Readable } from "stream";
import { OVER_ADDRESSES_DATASET, OVER_API, cleanHood, latestResource, parseParcelKey } from "../lib/parcelAddresses";
import { parseCsvLine } from "../lib/mapiAddresses";

const DATA_DIR = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data");
const DB_PATH = path.join(DATA_DIR, "realestate.db");
const UA = "karnaf-analist/1.0 (+https://analyst.karnafnadlan.com; weekly parcel-address import)";
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const FORCE = args.includes("--force");
const FILE = args.find((a) => a.startsWith("--file="))?.slice(7);
const MIN_ROWS = 400_000;
const MIN_AGE_DAYS = 6;

async function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 60000");
  db.exec(`CREATE TABLE IF NOT EXISTS over_parcel_addresses (
      gush INTEGER NOT NULL, helka INTEGER NOT NULL, suffix INTEGER NOT NULL,
      settlement TEXT, street TEXT NOT NULL, house TEXT NOT NULL, hood TEXT, lat REAL, lon REAL);
    CREATE INDEX IF NOT EXISTS idx_over_parcel_addresses ON over_parcel_addresses(gush, helka);
    CREATE TABLE IF NOT EXISTS over_addresses_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_at TEXT DEFAULT (datetime('now')), version INTEGER, rows INTEGER, dry INTEGER)`);

  let input: NodeJS.ReadableStream;
  let version = 0;
  if (FILE) {
    input = fs.createReadStream(FILE);
  } else {
    const versions = (await (await fetch(`${OVER_API}/datasets/${OVER_ADDRESSES_DATASET}/versions`, { headers: { "User-Agent": UA } })).json()) as never[];
    const r = latestResource(versions, ".csv");
    if (!r) throw new Error("no .csv resource in the dataset's versions");
    version = r.version;
    const last = db.prepare("SELECT version, run_at FROM over_addresses_status WHERE dry = 0 ORDER BY id DESC LIMIT 1").get() as { version: number; run_at: string } | undefined;
    const ageDays = last ? (Date.now() - Date.parse(last.run_at.replace(" ", "T") + "Z")) / 86_400_000 : Infinity;
    if (!FORCE && last && (last.version >= version || ageDays < MIN_AGE_DAYS)) {
      console.log(`↷ טבלת הכתובות יובאה לפני ${ageDays.toFixed(1)} ימים (גרסה ${last.version}, אחרונה ${version}) — אין צורך עכשיו`);
      return;
    }
    const res = await fetch(r.url, { headers: { "User-Agent": UA } });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${r.url}`);
    input = Readable.fromWeb(res.body as never);
  }

  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let header: string[] | null = null;
  const rows: Array<[number, number, number, string | null, string, string, string | null, number | null, number | null]> = [];
  let read = 0;
  for await (const line of rl) {
    if (!header) { header = parseCsvLine(line.replace(/^﻿/, "")); continue; }
    read++;
    const f = parseCsvLine(line);
    const get = (k: string) => f[header!.indexOf(k)] ?? "";
    const pk = parseParcelKey(get("parcel_key"));
    const street = get("street_name").trim();
    const house = `${get("house_num").trim()}${get("house_suffix").trim()}`;
    if (!pk || !street || !get("house_num").trim()) continue;
    const lat = Number(get("lat")), lon = Number(get("lon"));
    rows.push([pk.gush, pk.helka, pk.suffix, get("settlement_name").trim() || null, street, house, cleanHood(get("neighbourhood")),
      Number.isFinite(lat) && lat ? lat : null, Number.isFinite(lon) && lon ? lon : null]);
  }
  console.log(`  נקראו ${read.toLocaleString("he-IL")} כתובות · ${rows.length.toLocaleString("he-IL")} עם חלקה ומספר בית`);
  if (rows.length < MIN_ROWS) {
    console.error(`✗ רק ${rows.length} כתובות עם חלקה — הטבלה הקיימת נשארת`);
    process.exit(1);
  }
  if (DRY) { console.log("(יבש) לא נכתב דבר"); return; }

  const ins = db.prepare("INSERT INTO over_parcel_addresses (gush, helka, suffix, settlement, street, house, hood, lat, lon) VALUES (?,?,?,?,?,?,?,?,?)");
  db.transaction(() => {
    db.exec("DELETE FROM over_parcel_addresses");
    for (const r of rows) ins.run(...r);
  })();
  db.prepare("INSERT INTO over_addresses_status (version, rows, dry) VALUES (?, ?, 0)").run(version, rows.length);
  console.log(`✓ over_parcel_addresses: ${rows.length.toLocaleString("he-IL")} כתובות (גרסה ${version})`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
