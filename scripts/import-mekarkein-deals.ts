#!/usr/bin/env tsx
/**
 * Import the tax authority's deal register (מיסוי מקרקעין) from over.org.il
 * into a SIDE table, mekarkein_deals. See lib/mekarkein.ts for what the
 * register is and why it is matched rather than merged.
 *
 * Never touches nadlan_transactions: the address is part of a deal's identity
 * there (lib/dealKey.ts), and a register row has no address. Matching and
 * address inheritance are separate, reviewable steps (scripts/match-mekarkein.ts).
 *
 * Usage:
 *   npx tsx scripts/import-mekarkein-deals.ts                 full load, or incremental if the table has rows
 *   npx tsx scripts/import-mekarkein-deals.ts --full          full load even if rows exist
 *   npx tsx scripts/import-mekarkein-deals.ts --file x.csv    load a CSV downloaded elsewhere
 *   npx tsx scripts/import-mekarkein-deals.ts --dry-run       parse and count, write nothing
 *
 * NETWORK. One streamed GET of ~0.6–0.75 GB for the full load (inside the
 * publisher's 2 GB/day per-IP budget), with an explicit User-Agent. The
 * incremental run asks for rows first seen on each day since the last one it
 * holds (`?first_seen=YYYY-MM-DD`), a few MB. The publisher asks bulk users to
 * get in touch (guy@z-g.co.il); do that before scheduling this nightly.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import readline from "readline";
import { Readable } from "stream";
import { parseCsvLine } from "../lib/mapiAddresses";
import { MEKARKEIN_CSV_URL, cityResolver, parseRegisterRecord, type MekarkeinRow } from "../lib/mekarkein";
import { ensureMekarkeinTables } from "../lib/mekarkeinDb";

const DATA_DIR = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data");
const DB = path.join(DATA_DIR, "realestate.db");
const UA = "karnaf-analist/1.0 (+https://analyst.karnafnadlan.com; data import)";
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const full = args.includes("--full");
const fileArg = args.includes("--file") ? args[args.indexOf("--file") + 1] : null;

// The nightly collector passes --nightly. Until the operator turns the source
// on (after writing to the publisher), a nightly run is a no-op that says so.
if (args.includes("--nightly") && process.env.KARNAF_MEKARKEIN_ENABLED !== "1") {
  console.log("↷ מיסוי מקרקעין כבוי — KARNAF_MEKARKEIN_ENABLED=1 ב-.env.production מפעיל אותו");
  process.exit(0);
}

async function openCsv(url: string): Promise<readline.Interface> {
  if (fileArg) return readline.createInterface({ input: fs.createReadStream(fileArg, "utf8"), crlfDelay: Infinity });
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/csv" } });
  if (res.status === 429) throw new Error(`429 — the publisher's daily byte budget is spent (${await res.text().catch(() => "")}). Try tomorrow.`);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} from ${url}`);
  return readline.createInterface({ input: Readable.fromWeb(res.body as never), crlfDelay: Infinity });
}

async function load(db: Database.Database | null, url: string, resolve: (s: string) => string | null) {
  const rl = await openCsv(url);
  let header: string[] | null = null;
  let read = 0, fresh = 0, unmapped = 0, bad = 0;
  let lastSeen: string | null = null;
  const insert = db?.prepare(`INSERT OR IGNORE INTO mekarkein_deals
    (id, city_name, settlement, settlement_code, gush, helka, sub, deal_date, amount, declared_amount,
     nature, portion, area, rooms, year_built, first_seen)
    VALUES (@id, @city, @settlement, @settlementCode, @gush, @helka, @sub, @dealDate, @amount, @declaredAmount,
     @nature, @portion, @area, @rooms, @yearBuilt, @firstSeen)`);
  let batch: Array<MekarkeinRow & { city: string | null }> = [];
  const flush = db?.transaction((rows: Array<MekarkeinRow & { city: string | null }>) => {
    for (const r of rows) fresh += insert!.run(r).changes;
  });

  for await (const raw of rl) {
    const text: string = String(raw);
    const line: string = header ? text : text.replace(/^\uFEFF/, "");
    if (!line.trim()) continue;
    if (!header) { header = parseCsvLine(line).map((h) => h.trim()); continue; }
    const cells = parseCsvLine(line);
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = cells[i] ?? ""; });
    const row = parseRegisterRecord(rec);
    read++;
    if (!row) { bad++; continue; }
    const city = resolve(row.settlement);
    if (!city) unmapped++;
    if (row.firstSeen && (!lastSeen || row.firstSeen > lastSeen)) lastSeen = row.firstSeen;
    if (flush) {
      batch.push({ ...row, city });
      if (batch.length >= 5000) { flush(batch); batch = []; }
    }
    if (read % 250_000 === 0) console.log(`   … ${read.toLocaleString("he-IL")} שורות`);
  }
  if (flush && batch.length) flush(batch);
  if (!header) throw new Error("empty response — no header line");
  for (const need of ["gush", "chelka", "deal_date", "deal_amount", "settlement"]) {
    if (!header.includes(need)) throw new Error(`column "${need}" missing — the publisher changed the format: ${header.join(",")}`);
  }
  return { read, fresh, unmapped, bad, lastSeen };
}

async function main() {
  const db = new Database(DB, dry ? { readonly: true } : undefined);
  if (!dry) {
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 60000");
    ensureMekarkeinTables(db);
  }
  const cities = (db.prepare("SELECT city_name FROM cities").all() as Array<{ city_name: string }>).map((r) => r.city_name);
  const resolve = cityResolver(cities);

  let since: string | null = null;
  if (!full && !fileArg && !dry) {
    const r = db.prepare("SELECT MAX(first_seen) m FROM mekarkein_deals").get() as { m: string | null };
    since = r.m ? r.m.slice(0, 10) : null;
  }

  const urls: string[] = [];
  if (fileArg || !since) {
    urls.push(`${MEKARKEIN_CSV_URL}?sort=gush&order=asc`);
  } else {
    // one request per day since the newest row we hold; the filter is a text
    // match on first_seen, so a date prefix selects that day
    const today = new Date().toISOString().slice(0, 10);
    for (let d = since; d <= today; d = new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10)) {
      urls.push(`${MEKARKEIN_CSV_URL}?first_seen=${d}`);
    }
  }
  const mode = fileArg ? "file" : since ? "incremental" : "full";
  console.log(`▸ מיסוי מקרקעין (over.org.il) · ${mode}${since ? ` מאז ${since}` : ""} · ${urls.length} בקשות${dry ? " · יבש" : ""}`);

  let tot = { read: 0, fresh: 0, unmapped: 0, bad: 0, lastSeen: null as string | null };
  for (const url of urls) {
    const r = await load(dry ? null : db, url, resolve);
    tot = {
      read: tot.read + r.read, fresh: tot.fresh + r.fresh, unmapped: tot.unmapped + r.unmapped, bad: tot.bad + r.bad,
      lastSeen: [tot.lastSeen, r.lastSeen].filter(Boolean).sort().pop() ?? null,
    };
    if (urls.length > 1) await new Promise((res) => setTimeout(res, 11_000)); // the export endpoint allows 6/min
  }

  if (!dry) {
    db.prepare(`INSERT INTO mekarkein_import_status (mode, rows_read, rows_new, rows_unmapped, last_first_seen) VALUES (?, ?, ?, ?, ?)`)
      .run(mode, tot.read, tot.fresh, tot.unmapped, tot.lastSeen);
  }
  const total = dry ? null : (db.prepare("SELECT COUNT(*) c FROM mekarkein_deals").get() as { c: number }).c;
  console.log(`✓ נקראו ${tot.read.toLocaleString("he-IL")} · חדשות ${tot.fresh.toLocaleString("he-IL")} · לא שויכו לעיר שלנו ${tot.unmapped.toLocaleString("he-IL")} · לא תקינות ${tot.bad.toLocaleString("he-IL")}${total != null ? ` · בטבלה ${total.toLocaleString("he-IL")}` : ""}`);
}

main().catch((e) => { console.error(`✗ ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
