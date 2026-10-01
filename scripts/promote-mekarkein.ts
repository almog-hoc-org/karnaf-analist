#!/usr/bin/env tsx
/**
 * Register rows (mekarkein_deals) that are whole apartments no deal of ours
 * reports → new nadlan_transactions rows, source 'mekarkein'. The rules are in
 * lib/mekarkeinPromote.ts; this script loads, looks up addresses, and writes.
 *
 *   npx tsx scripts/promote-mekarkein.ts --city "חולון" --dry-run   measure, write nothing
 *   npx tsx scripts/promote-mekarkein.ts --city "חולון"             write one city
 *   npx tsx scripts/promote-mekarkein.ts                            every city
 *   --since 2026-01-01   only deals from that date (or KARNAF_MEKARKEIN_PROMOTE_SINCE)
 *   --lookups 2000       over.org.il parcel lookups allowed this run (0 = none)
 *
 * ORDER. Runs after import-mekarkein-deals.ts and match-mekarkein.ts: the match
 * claims the register rows that ARE ours, and only unclaimed rows are candidates.
 *
 * ADDRESSES. First our own deals in the same flat or parcel; then over.org.il's
 * parcel↔address table (/api/nadlan/parcel/{gush}/{helka}, one parcel per call,
 * cached in over_parcel_cache so a parcel is asked once). Their bulk SQL export
 * needs an account, so the lookups are rationed per run (--lookups), newest
 * deals first; a row promoted without an address gets one on a later run, when
 * its parcel's turn comes. Rows without any address still count in the city and
 * neighbourhood-free statistics.
 *
 * WHAT IT WRITES: INSERT into nadlan_transactions (never UPDATE of a row it did
 * not write), street/house on its own rows that had none, over_parcel_cache,
 * mekarkein_promote_status. Nothing else.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import type { MekarkeinRow } from "../lib/mekarkein";
import {
  PROMOTE_SOURCE, promoteSkipReason, knownIndex, isKnown, parseOverParcel, addressFor, ourParcelDonors,
  streetSpeller, promotedTuple, type OverParcel, type SkipReason, type AddressVia,
} from "../lib/mekarkeinPromote";
import { NADLAN_ROW_COLS } from "../lib/nadlanRow";
import { insertIfAbsentSql, DEAL_KEY_INDEX_SQL } from "../lib/dealKey";
import { ensureMekarkeinTables, ensureMekarkeinIdColumn } from "../lib/mekarkeinDb";
import { ensureNadlanAddressColumnsSync } from "../lib/addressBackfillDb";

const args = process.argv.slice(2);
const arg = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const dry = args.includes("--dry-run");
const cityArg = arg("--city");
// --since wins; the nightly unit sets KARNAF_MEKARKEIN_PROMOTE_SINCE instead, so the
// first nights add only the months our own collectors missed and leave history
// alone until it has been measured (docs/MEKARKEIN.md, stage 2a → 2b).
const since = arg("--since") ?? (process.env.KARNAF_MEKARKEIN_PROMOTE_SINCE || null);
if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error(`✗ תאריך התחלה לא תקין: "${since}" — צריך YYYY-MM-DD`);
  process.exit(1);
}
const nightly = args.includes("--nightly");
let lookupBudget = Number(arg("--lookups") ?? (nightly ? 2000 : 500));

// Enrichment (import + match) and promotion are switched on separately: the
// operator measures a city with --dry-run before new rows reach the site.
if (nightly && (process.env.KARNAF_MEKARKEIN_ENABLED !== "1" || process.env.KARNAF_MEKARKEIN_PROMOTE !== "1")) {
  console.log("↷ עסקאות חדשות ממיסוי מקרקעין כבויות — KARNAF_MEKARKEIN_ENABLED=1 ו-KARNAF_MEKARKEIN_PROMOTE=1 מפעילים");
  process.exit(0);
}

const DATA_DIR = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data");
const DB = path.join(DATA_DIR, "realestate.db");
const UA = "karnaf-analist/1.0 (+https://analyst.karnafnadlan.com; parcel address lookup)";
const OVER_PARCEL_URL = "https://www.over.org.il/api/nadlan/parcel";
const LOOKUP_GAP_MS = 400;

function cbsCodes(): Record<string, number> {
  try { return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/city_cbs_codes.json"), "utf8")); } catch { return {}; }
}

async function lookupParcel(gh: string): Promise<OverParcel | null> {
  const [g, h] = gh.split("-");
  try {
    const res = await fetch(`${OVER_PARCEL_URL}/${g}/${h}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (res.status === 429) { lookupBudget = 0; console.log("  ⚠ over.org.il: 429 — הבדיקות נעצרות לריצה הזו"); return null; }
    if (!res.ok) return null;
    return parseOverParcel(await res.json());
  } catch { return null; }
}

interface Report {
  city: string; register: number; skipped: Record<SkipReason, number>; known: number; candidates: number;
  inserted: number; via: Record<AddressVia | "none", number>; backfilled: number; newest: string | null;
}

async function main() {
  const db = new Database(DB, dry ? { readonly: true } : undefined);
  if (!dry) {
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 60000");
    ensureMekarkeinTables(db);
    ensureNadlanAddressColumnsSync(db);
    ensureMekarkeinIdColumn(db);
    db.exec(DEAL_KEY_INDEX_SQL);
    db.exec(`
      CREATE TABLE IF NOT EXISTS over_parcel_cache (
        gh TEXT PRIMARY KEY, ambiguous INTEGER NOT NULL, addresses TEXT NOT NULL,
        fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS mekarkein_promote_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT, run_at DATETIME DEFAULT CURRENT_TIMESTAMP, city_name TEXT NOT NULL,
        register INTEGER, known INTEGER, candidates INTEGER, inserted INTEGER,
        with_address INTEGER, street_only INTEGER, no_address INTEGER, backfilled INTEGER, newest TEXT);
      CREATE INDEX IF NOT EXISTS idx_nadlan_tx_source_deal ON nadlan_transactions(source, source_deal_id);`);
  }
  const hasCache = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='over_parcel_cache'").get();
  const cache = new Map<string, OverParcel>();
  if (hasCache) {
    for (const r of db.prepare("SELECT gh, ambiguous, addresses FROM over_parcel_cache").all() as Array<{ gh: string; ambiguous: number; addresses: string }>) {
      cache.set(r.gh, { ambiguous: !!r.ambiguous, addresses: JSON.parse(r.addresses) });
    }
  }
  const putCache = dry ? null : db.prepare("INSERT OR REPLACE INTO over_parcel_cache (gh, ambiguous, addresses) VALUES (?, ?, ?)");

  const cities = cityArg
    ? [cityArg]
    : (db.prepare(`SELECT city_name FROM mekarkein_deals WHERE city_name IS NOT NULL GROUP BY city_name ORDER BY COUNT(*) DESC`)
        .all() as Array<{ city_name: string }>).map((r) => r.city_name);
  if (!cities.length) { console.log("✗ mekarkein_deals ריקה — להריץ קודם scripts/import-mekarkein-deals.ts"); return; }
  const codes = cbsCodes();
  console.log(`▸ עסקאות חדשות ממיסוי מקרקעין · ${cities.length} ערים${since ? ` · מ-${since}` : ""} · עד ${lookupBudget} בדיקות חלקה${dry ? " · יבש, לא נכתב דבר" : ""}\n`);

  const hasMekId = (db.prepare("PRAGMA table_info(nadlan_transactions)").all() as Array<{ name: string }>).some((c) => c.name === "mekarkein_id");
  const loadReg = db.prepare(`SELECT m.id, m.settlement, m.settlement_code settlementCode, m.gush, m.helka, m.sub, m.deal_date dealDate,
      m.amount, m.declared_amount declaredAmount, m.nature, m.portion, m.area, m.rooms, m.year_built yearBuilt, m.first_seen firstSeen
    FROM mekarkein_deals m
    WHERE m.city_name = ? AND m.deal_date >= ?
    ORDER BY m.deal_date DESC`);
  // Register rows already claimed — matched to a deal of ours, or promoted
  // earlier — read once per city through the city index and filtered in
  // memory. A NOT EXISTS per register row on mekarkein_id (unindexed) was a
  // scan of the whole deals table for each of up to millions of rows: the
  // all-years dry run of 1.10.2026 never finished.
  const loadClaimed = db.prepare(`SELECT ${hasMekId ? "mekarkein_id" : "NULL"} mid, source, source_deal_id sid
    FROM nadlan_transactions WHERE city_name = ? AND (${hasMekId ? "mekarkein_id IS NOT NULL OR " : ""}source = '${PROMOTE_SOURCE}')`);
  const loadOurs = db.prepare(`SELECT deal_date dealDate, price, parcel_num parcelNum, street, house_num houseNum
    FROM nadlan_transactions WHERE city_name = ?`);
  const loadStreets = db.prepare(`SELECT street, COUNT(*) n FROM nadlan_transactions
    WHERE city_name = ? AND street IS NOT NULL AND TRIM(street) <> '' GROUP BY street`);
  const loadBare = db.prepare(`SELECT id, parcel_num parcelNum, deal_date dealDate FROM nadlan_transactions
    WHERE city_name = ? AND source = '${PROMOTE_SOURCE}' AND (street IS NULL OR TRIM(street) = '') AND parcel_num IS NOT NULL`);
  const setAddr = dry ? null : db.prepare(`UPDATE nadlan_transactions SET street = ?, house_num = ?
    WHERE id = ? AND source = '${PROMOTE_SOURCE}' AND (street IS NULL OR TRIM(street) = '')`);
  const setMekId = hasMekId && !dry ? db.prepare(`UPDATE nadlan_transactions SET mekarkein_id = source_deal_id
    WHERE city_name = ? AND source = '${PROMOTE_SOURCE}' AND mekarkein_id IS NULL`) : null;
  const logRun = dry ? null : db.prepare(`INSERT INTO mekarkein_promote_status
    (city_name, register, known, candidates, inserted, with_address, street_only, no_address, backfilled, newest)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const reports: Report[] = [];
  // per deal year, over every city: what promotion would add (the measurement
  // that decides whether history — stage 2b — is turned on)
  const byYear = new Map<number, { cand: number; addr: number }>();
  for (const city of cities) {
    const claimed = new Set<string>();
    for (const c of loadClaimed.all(city) as Array<{ mid: string | null; source: string; sid: string | null }>) {
      if (c.mid) claimed.add(c.mid);
      if (c.source === PROMOTE_SOURCE && c.sid) claimed.add(c.sid);
    }
    const reg = (loadReg.all(city, since ?? "0000") as MekarkeinRow[]).filter((r) => !claimed.has(r.id));
    const ours = loadOurs.all(city) as Array<{ dealDate: string; price: number | null; parcelNum: string | null; street: string | null; houseNum: string | null }>;
    const idx = knownIndex(ours);
    const { bySub, byGh } = ourParcelDonors(ours);
    const spell = streetSpeller(loadStreets.all(city) as Array<{ street: string; n: number }>);
    const r: Report = {
      city, register: reg.length, skipped: { nature: 0, portion: 0, area: 0, amount: 0, date: 0 }, known: 0, candidates: 0,
      inserted: 0, via: { sub: 0, parcel: 0, over: 0, "over-street": 0, none: 0 }, backfilled: 0, newest: null,
    };

    const cands: MekarkeinRow[] = [];
    for (const row of reg) {
      const why = promoteSkipReason(row);
      if (why) { r.skipped[why]++; continue; }
      if (isKnown(row, idx)) { r.known++; continue; }
      cands.push(row);
    }
    r.candidates = cands.length;

    // Parcels still without an address from our own deals, newest deal first;
    // plus our earlier promoted rows that are still bare.
    const bare = dry ? [] : (loadBare.all(city) as Array<{ id: number; parcelNum: string; dealDate: string }>);
    const need: Array<{ gh: string; date: string }> = [];
    const seen = new Set<string>();
    const wants = (g: number, h: number, s: number, date: string) => {
      const gh = `${g}-${h}`;
      if (seen.has(gh) || cache.has(gh)) return;
      if (addressFor(g, h, s, bySub, byGh, null).via) return;
      seen.add(gh); need.push({ gh, date });
    };
    for (const c of cands) wants(c.gush, c.helka, c.sub, c.dealDate);
    for (const b of bare) { const [g, h, s] = b.parcelNum.split("-").map(Number); if (g && h) wants(g, h, s || 0, b.dealDate); }
    need.sort((a, b) => b.date.localeCompare(a.date));
    for (const n of need) {
      if (lookupBudget <= 0) break;
      lookupBudget--;
      const p = await lookupParcel(n.gh);
      if (p) { cache.set(n.gh, p); putCache?.run(n.gh, p.ambiguous ? 1 : 0, JSON.stringify(p.addresses)); }
      await new Promise((res) => setTimeout(res, LOOKUP_GAP_MS));
    }

    const cbs = codes[city] != null ? String(codes[city]) : null;
    const tuples: unknown[][] = [];
    for (const c of cands) {
      const a = addressFor(c.gush, c.helka, c.sub, bySub, byGh, cache.get(`${c.gush}-${c.helka}`) ?? null);
      if (a.street && (a.via === "over" || a.via === "over-street")) a.street = spell(a.street);
      r.via[a.via ?? "none"]++;
      const y = Number(c.dealDate.slice(0, 4));
      const yy = byYear.get(y) ?? { cand: 0, addr: 0 };
      yy.cand++; if (a.houseNum) yy.addr++;
      byYear.set(y, yy);
      tuples.push(promotedTuple(c, city, cbs, a));
      if (!r.newest || c.dealDate > r.newest) r.newest = c.dealDate;
    }

    if (!dry) {
      const cols = NADLAN_ROW_COLS.join(",");
      const BATCH = 200;
      db.transaction(() => {
        for (let i = 0; i < tuples.length; i += BATCH) {
          const chunk = tuples.slice(i, i + BATCH);
          r.inserted += db.prepare(insertIfAbsentSql(cols, chunk.length)).run(...chunk.flat()).changes;
        }
        setMekId?.run(city);
        for (const b of bare) {
          const [g, h, s] = b.parcelNum.split("-").map(Number);
          const a = addressFor(g, h, s || 0, bySub, byGh, cache.get(`${g}-${h}`) ?? null);
          if (!a.street) continue;
          const street = a.via === "over" || a.via === "over-street" ? spell(a.street) : a.street;
          r.backfilled += setAddr!.run(street, a.houseNum, b.id).changes;
        }
      })();
      logRun!.run(city, r.register, r.known, r.candidates, r.inserted,
        r.via.sub + r.via.parcel + r.via.over, r.via["over-street"], r.via.none, r.backfilled, r.newest);
    }
    reports.push(r);

    const n = (x: number) => x.toLocaleString("he-IL");
    const skipped = Object.values(r.skipped).reduce((s, x) => s + x, 0);
    console.log(
      `✓ ${city}: ${n(r.register)} שורות בפנקס · ${n(skipped)} לא דירה שלמה · ${n(r.known)} כבר אצלנו · ` +
      `${n(r.candidates)} חדשות${dry ? "" : ` (${n(r.inserted)} נכתבו)`}` +
      ` · כתובת מלאה ${n(r.via.sub + r.via.parcel + r.via.over)} (מאיתנו ${n(r.via.sub + r.via.parcel)}, מ-over ${n(r.via.over)})` +
      ` · רחוב בלבד ${n(r.via["over-street"])} · בלי כתובת ${n(r.via.none)}` +
      (r.backfilled ? ` · +${n(r.backfilled)} כתובות לשורות קודמות` : "") +
      (r.newest ? ` · אחרונה ${r.newest}` : "")
    );
  }

  const tot = (f: (r: Report) => number) => reports.reduce((s, r) => s + f(r), 0).toLocaleString("he-IL");
  console.log(`\nסה״כ: ${tot((r) => r.candidates)} עסקאות חדשות${dry ? "" : ` · ${tot((r) => r.inserted)} נכתבו`} · ` +
    `${tot((r) => r.via.sub + r.via.parcel + r.via.over)} עם כתובת מלאה · ${tot((r) => r.via.none)} בלי כתובת${dry ? " · יבש" : ""}`);
  if (!dry && reports.some((r) => r.inserted)) console.log("הצינור הלילי יחשב מחדש את המחירים, הגרפים ועמודי הרחוב והבניין.");

  if (byYear.size) {
    // Against what the site already counts per year (active deals), so the
    // effect on each year's statistics is read directly.
    const ours = new Map((db.prepare(`SELECT deal_year y, COUNT(*) n FROM nadlan_transactions
        WHERE COALESCE(excluded,0)=0 GROUP BY deal_year`).all() as Array<{ y: number; n: number }>).map((r) => [Number(r.y), r.n]));
    console.log("\nלפי שנת עסקה — אצלנו (פעילות) · היו מתווספות · תוספת · מהן עם כתובת מלאה:");
    for (const y of [...byYear.keys()].sort((a, b) => a - b)) {
      const v = byYear.get(y)!; const o = ours.get(y) ?? 0;
      const pct = o ? `+${((v.cand / o) * 100).toFixed(1)}%` : "—";
      console.log(`  ${y}: ${o.toLocaleString("he-IL").padStart(9)} · ${v.cand.toLocaleString("he-IL").padStart(8)} · ${pct.padStart(7)} · ${v.addr.toLocaleString("he-IL")}`);
    }
  }
}

main().catch((e) => { console.error(`✗ ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
