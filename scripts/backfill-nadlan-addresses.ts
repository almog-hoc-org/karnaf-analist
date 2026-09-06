#!/usr/bin/env tsx
/**
 * THE NADLAN ADDRESS CAMPAIGN — server half: donate the addresses captured
 * on the Mac (scripts/capture-nadlan-addresses.ts) onto the rows that
 * already exist. Database only; no network.
 *
 * WHY UPDATE-ONLY, NEVER INSERT. street and house_num are part of the deal
 * identity key (lib/dealKey.ts). Inserting a street-ful copy of a deal next
 * to its street-less legacy row would create a duplicate, not a match.
 * Updating in place also heals that trap: once the legacy row carries the
 * address, a future re-collection matches the full key and dedupes cleanly.
 * (Deals the site has and we do not are counted and reported; with
 * --insert-new they are inserted — see below.)
 *
 * --insert-new (5.9.2026, after the fill completed on all 164 cities). A
 * captured item with no row at all is inserted through the same row builder
 * the nightly collector uses (lib/nadlanRow.ts). "No row at all" is judged
 * by the strict key and the soft key against EVERY row of the city, all
 * sources — a govmap row of the same deal may spell the street differently
 * or round the area, and insertIfAbsentSql's full-key comparison alone
 * would let such a copy in. insertIfAbsentSql stays as the second guard.
 * This is safe only now: before the fill, a street-ful item next to a
 * street-less legacy row would have been inserted as a duplicate.
 *
 * MATCHING. A captured item and a nadlan row are the same deal when
 * (date, price, area, rooms) agree — the collector's own dedup key, so for
 * this channel the strict key is expected to hit almost every time; the
 * soft key (date + price, area within ±2 m²) is the fallback, exactly as in
 * scripts/backfill-govmap-addresses.ts. Candidates that disagree on the
 * street donate nothing (lib/addressBackfill.ts chooseDonation).
 *
 * WHAT IS DONATED. street, house_num, floor (text), neighborhood — with
 * COALESCE, an existing value is never overwritten — plus two new columns
 * (lib/addressBackfillDb.ts): parcel_num (gush-helka-tat) and
 * building_floors, and source_deal_id := the site's assetId.
 *
 * Usage:
 *   npx tsx scripts/backfill-nadlan-addresses.ts "תל אביב-יפו" --from-file=/app/data/nadlan_addr/תל_אביב-יפו.json
 *   npx tsx scripts/backfill-nadlan-addresses.ts "תל אביב-יפו" --from-file=… --insert-new
 *   npx tsx scripts/backfill-nadlan-addresses.ts --status      # per-city summary
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { strictKey, looseKey, chooseDonation, SOFT_AREA_TOLERANCE_SQM, type AddressDonor } from "../lib/addressBackfill";
import { ensureNadlanAddressColumnsSync } from "../lib/addressBackfillDb";
import { donorFromItem, type CaptureFile, type RawItem, type NadlanDonor } from "../lib/nadlanCapture";
import { buildNadlanRow, NADLAN_ROW_COLS } from "../lib/nadlanRow";
import { insertIfAbsentSql } from "../lib/dealKey";

export const METHOD = "nadlan-addr-v1";
/** The version a city carries once the insert step ran on it — the push script re-queues cities below it. */
export const METHOD_INSERT = "nadlan-addr-v2";

interface TargetRow {
  id: number; deal_date: string; price: number; area: number; rooms: number | null;
  street: string | null; house_num: string | null; neighborhood: string | null;
  parcel_num: string | null; building_floors: number | null; source_deal_id: string | null;
}

function main(): number {
  const argv = process.argv.slice(2);
  const fromFile = argv.find((a) => a.startsWith("--from-file="))?.slice("--from-file=".length) ?? null;
  const insertNew = argv.includes("--insert-new");
  const names = argv.filter((a) => !a.startsWith("--"));

  const db = new Database(path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 60000");
  ensureNadlanAddressColumnsSync(db);
  db.exec(`CREATE TABLE IF NOT EXISTS nadlan_address_backfill_status (
    city_name TEXT NOT NULL UNIQUE,
    method_version TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    captured INTEGER NOT NULL DEFAULT 0,
    filled_street INTEGER NOT NULL DEFAULT 0,
    filled_hood INTEGER NOT NULL DEFAULT 0,
    filled_parcel INTEGER NOT NULL DEFAULT 0,
    ambiguous INTEGER NOT NULL DEFAULT 0,
    unmatched INTEGER NOT NULL DEFAULT 0,
    not_in_db INTEGER NOT NULL DEFAULT 0,
    years TEXT,
    last_run DATETIME
  )`);
  try { db.exec("ALTER TABLE nadlan_address_backfill_status ADD COLUMN inserted INTEGER NOT NULL DEFAULT 0"); } catch { /* exists */ }

  if (argv.includes("--status")) {
    const rows = db.prepare(`SELECT city_name, method_version, status, captured, filled_street, filled_parcel, unmatched, not_in_db, inserted, years, last_run
                               FROM nadlan_address_backfill_status ORDER BY filled_street DESC`).all() as Array<Record<string, unknown>>;
    // totals FIRST — the push script shows the first 20 lines of this, and the one line that matters must be among them
    const tot = db.prepare(`SELECT SUM(filled_street) s, SUM(filled_parcel) p, SUM(not_in_db) n, SUM(inserted) i, SUM(method_version = ?) v2, COUNT(*) c FROM nadlan_address_backfill_status`).get(METHOD_INSERT) as Record<string, number>;
    console.log(`סה"כ ${tot.c} ערים · +${Number(tot.s).toLocaleString("en")} רחוב · +${Number(tot.p).toLocaleString("en")} גוש-חלקה · ${Number(tot.n).toLocaleString("en")} לא במאגר · +${Number(tot.i).toLocaleString("en")} הוכנסו (${tot.v2} ערים עברו הכנסה)`);
    if (!rows.length) console.log("הקמפיין טרם רץ.");
    for (const r of rows) console.log(`${String(r.city_name).padEnd(18)} ${r.status} · נלכדו ${Number(r.captured).toLocaleString("en")} · +${Number(r.filled_street).toLocaleString("en")} רחוב · +${Number(r.filled_parcel).toLocaleString("en")} גוש-חלקה · ${Number(r.unmatched).toLocaleString("en")} ללא התאמה · ${Number(r.not_in_db).toLocaleString("en")} לא במאגר · ${r.method_version === METHOD_INSERT ? `+${Number(r.inserted).toLocaleString("en")} הוכנסו` : "טרם הוכנסו"} · ${r.years ?? "—"} · ${r.last_run}`);

    db.close();
    return 0;
  }

  if (!fromFile || names.length !== 1) {
    console.error('usage: backfill-nadlan-addresses.ts "עיר" --from-file=<capture.json>  |  --status');
    db.close();
    return 1;
  }
  const city = names[0];
  let cap: CaptureFile;
  try { cap = JSON.parse(fs.readFileSync(fromFile, "utf8")) as CaptureFile; }
  catch (e) { console.error(`לא ניתן לקרוא את ${fromFile}: ${e instanceof Error ? e.message : e}`); db.close(); return 1; }
  const items = Array.isArray(cap.items) ? (cap.items as RawItem[]) : [];

  const upsertStatus = db.prepare(`
    INSERT INTO nadlan_address_backfill_status
      (city_name, method_version, status, attempts, captured, filled_street, filled_hood, filled_parcel, ambiguous, unmatched, not_in_db, inserted, years, last_run)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(city_name) DO UPDATE SET
      method_version=excluded.method_version, status=excluded.status,
      attempts=nadlan_address_backfill_status.attempts+1, captured=excluded.captured,
      filled_street=excluded.filled_street, filled_hood=excluded.filled_hood, filled_parcel=excluded.filled_parcel,
      ambiguous=excluded.ambiguous, unmatched=excluded.unmatched, not_in_db=excluded.not_in_db,
      inserted=nadlan_address_backfill_status.inserted+excluded.inserted, years=excluded.years, last_run=excluded.last_run`);

  // Targets: nadlan-channel rows missing any of the fields the campaign
  // donates. govmap rows already carry their address from the feed.
  const targets = db.prepare(`
    SELECT id, deal_date, price, area, rooms, street, house_num, neighborhood, parcel_num, building_floors, source_deal_id
      FROM nadlan_transactions
     WHERE city_name = ? AND COALESCE(source,'nadlan') = 'nadlan' AND price>0 AND area>0
       AND (street IS NULL OR house_num IS NULL OR neighborhood IS NULL OR parcel_num IS NULL)`).all(city) as TargetRow[];
  const apply = db.prepare(`
    UPDATE nadlan_transactions SET
      street=COALESCE(street,?), house_num=COALESCE(house_num,?),
      floor=COALESCE(floor,?), neighborhood=COALESCE(neighborhood,?),
      parcel_num=COALESCE(parcel_num,?), building_floors=COALESCE(building_floors,?),
      source_deal_id=COALESCE(source_deal_id,?)
     WHERE id=?`);

  // Donor indexes by the merge's keys.
  const byStrict = new Map<string, NadlanDonor[]>();
  const byLoose = new Map<string, Array<{ area: number; donor: NadlanDonor }>>();
  let usable = 0;
  for (const it of items) {
    const price = Number(it.dealAmount), area = Number(it.assetArea);
    if (!(price > 0) || !(area > 0) || !it.dealDate) continue;
    const donor = donorFromItem(it, city);
    if (!donor.street && !donor.neighborhood && !donor.parcel_num) continue;
    usable++;
    const rec = { deal_date: String(it.dealDate).slice(0, 10), price, area, rooms: it.roomNum == null ? null : Number(it.roomNum) };
    const sk = strictKey(rec), lk = looseKey(rec);
    (byStrict.get(sk) ?? byStrict.set(sk, []).get(sk)!).push(donor);
    (byLoose.get(lk) ?? byLoose.set(lk, []).get(lk)!).push({ area, donor });
  }

  // How many captured deals have no row at all — reported, not inserted (see header).
  const ownRows = db.prepare(`SELECT deal_date, price, area, rooms FROM nadlan_transactions WHERE city_name = ? AND price > 0 AND area > 0`)
    .all(city) as Array<{ deal_date: string; price: number; area: number; rooms: number | null }>;
  const ownKeys = new Set(ownRows.map((r) => strictKey(r)));
  const ownLoose = new Map<string, number[]>();
  for (const r of ownRows) (ownLoose.get(looseKey(r)) ?? ownLoose.set(looseKey(r), []).get(looseKey(r))!).push(r.area);
  /** Does ANY row of the city (any source) already hold this deal — strictly, or softly within the area tolerance? */
  const alreadyHave = (rec: { deal_date: string; price: number; area: number; rooms: number | null }): boolean =>
    ownKeys.has(strictKey(rec)) || (ownLoose.get(looseKey(rec)) ?? []).some((a) => Math.abs(a - rec.area) <= SOFT_AREA_TOLERANCE_SQM);
  let notInDb = 0;
  for (const k of byStrict.keys()) if (!ownKeys.has(k)) notInDb++;

  let filledStreet = 0, filledHood = 0, filledParcel = 0, ambiguous = 0, unmatched = 0, matched = 0;
  const donorsOf = (t: TargetRow): NadlanDonor[] | null => {
    const strict = byStrict.get(strictKey(t));
    if (strict?.length) return strict;
    const loose = (byLoose.get(looseKey(t)) ?? []).filter((d) => Math.abs(d.area - t.area) <= SOFT_AREA_TOLERANCE_SQM).map((d) => d.donor);
    return loose.length ? loose : null;
  };
  db.transaction(() => {
    for (const t of targets) {
      const cands = donorsOf(t);
      if (!cands) { unmatched++; continue; }
      const base = chooseDonation(cands as AddressDonor[]);
      if (!base) { ambiguous++; continue; }
      matched++;
      // parcel/floors/asset: agree-or-nothing, same rule as the street
      const parcels = new Set(cands.map((d) => d.parcel_num).filter(Boolean));
      const parcel = parcels.size === 1 ? [...parcels][0]! : null;
      const floorsSet = new Set(cands.map((d) => d.building_floors).filter((v) => v != null));
      const floors = floorsSet.size === 1 ? [...floorsSet][0]! : null;
      const sid = cands.length === 1 ? cands[0].asset_id : null;
      const wantStreet = !t.street && !!base.street;
      const wantHood = !t.neighborhood && !!base.neighborhood;
      const wantParcel = !t.parcel_num && !!parcel;
      if (!wantStreet && !wantHood && !wantParcel && !(t.building_floors == null && floors != null)) continue;
      apply.run(base.street, base.house_num, base.floor, base.neighborhood, parcel, floors, sid, t.id);
      if (wantStreet) filledStreet++;
      if (wantHood) filledHood++;
      if (wantParcel) filledParcel++;
    }
  })();

  // --insert-new: the deals the site has and no row of ours holds, through the
  // collector's own row builder; insertIfAbsentSql is the second guard.
  let inserted = 0;
  if (insertNew) {
    const tuples: unknown[][] = [];
    const seen = new Set<string>();
    for (const it of items) {
      const price = Number(it.dealAmount), area = Number(it.assetArea);
      if (!(price > 0) || !(area > 0) || !it.dealDate) continue;
      const rec = { deal_date: String(it.dealDate).slice(0, 10), price, area, rooms: it.roomNum == null ? null : Number(it.roomNum) };
      const sk = strictKey(rec);
      if (seen.has(sk) || alreadyHave(rec)) continue;
      const tuple = buildNadlanRow(it as Record<string, unknown>, city, cap.cbsCode ? String(cap.cbsCode) : null);
      if (!tuple) continue;
      seen.add(sk);
      tuples.push(tuple);
    }
    const COLS = NADLAN_ROW_COLS.join(",");
    const CHUNK = 80;
    db.transaction(() => {
      for (let i = 0; i < tuples.length; i += CHUNK) {
        const slice = tuples.slice(i, i + CHUNK);
        inserted += Number(db.prepare(insertIfAbsentSql(COLS, slice.length)).run(...slice.flat()).changes);
      }
    })();
  }

  const yearsOf = (() => {
    let min = Infinity, max = -Infinity;
    for (const it of items) { const y = Number(String(it.dealDate ?? "").slice(0, 4)); if (y > 1990) { min = Math.min(min, y); max = Math.max(max, y); } }
    return min === Infinity ? null : `${min}–${max}`;
  })();
  // an empty capture is not a finished city — the push script must pick it up again
  upsertStatus.run(city, insertNew ? METHOD_INSERT : METHOD, items.length ? "ok" : "empty", items.length, filledStreet, filledHood, filledParcel, ambiguous, unmatched, notInDb, inserted, yearsOf);
  console.log(`${city}: ${items.length.toLocaleString("en")} נלכדו (${usable.toLocaleString("en")} עם כתובת/גוש) · ${targets.length.toLocaleString("en")} שורות חסרות · ${matched.toLocaleString("en")} הותאמו · +${filledStreet.toLocaleString("en")} רחוב · +${filledHood.toLocaleString("en")} שכונה · +${filledParcel.toLocaleString("en")} גוש-חלקה · ${ambiguous} דו-משמעי · ${unmatched.toLocaleString("en")} ללא התאמה · ${notInDb.toLocaleString("en")} עסקאות באתר שאינן במאגר${insertNew ? ` · +${inserted.toLocaleString("en")} הוכנסו` : ""} · שנים ${yearsOf ?? "—"}`);
  db.close();
  return 0;
}

process.exit(main());
