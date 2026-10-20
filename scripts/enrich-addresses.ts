#!/usr/bin/env tsx
/**
 * Pipeline stage `addresses`: a street, house and neighbourhood for every deal
 * the tables can vouch for, before anything counts neighbourhoods.
 *
 *   npx tsx scripts/enrich-addresses.ts [--dry-run] [--city=חיפה]
 *
 * WHY A STAGE. Rows reach the table from five collectors, and the
 * neighbourhood was set by exactly one of them: a tax-register deal (source
 * 'mekarkein') never had one — 0% in every year, 22% of a city's 2026 deals
 * and almost half of 2005 — so the neighbourhood statistics, drawer and map
 * pins silently left them out. Filling it here, nightly, covers every
 * collector and every row, including rows added tonight.
 *
 * Per city, only empty fields, never an overwrite:
 *  1. street + house for rows with a parcel: the parcel_addresses table (the
 *     govmap mirror's agreed address per flat, then per parcel), then the
 *     parcel→address table (over_parcel_addresses), one unambiguous address
 *     only;
 *  2. neighbourhood for rows with a parcel: the same tables, then our own
 *     deals on the same flat or parcel — taken only when they agree;
 *  3. neighbourhood for rows with a street: the neighbourhood our own deals
 *     on that building, then that street, report — lib/searchIndex.ts
 *     pickModalHood (≥70% of them, ≥5 deals). A street that crosses
 *     neighbourhoods gets none.
 */
import Database from "better-sqlite3";
import path from "path";
import { gushHelkaOf } from "../lib/mekarkein";
import { normStreet, normHouse } from "../lib/addressKey";
import { pickModalHood } from "../lib/searchIndex";
import { overParcelFromRows } from "../lib/parcelAddresses";

const DB_PATH = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db");
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ONLY = args.find((a) => a.startsWith("--city="))?.slice(7);

const blank = (v: string | null | undefined) => !v || !v.trim();

type Row = { id: number; p: string | null; street: string | null; house: string | null; hood: string | null };

function main() {
  const db = new Database(DB_PATH, DRY ? { readonly: true } : undefined);
  db.pragma("busy_timeout = 60000");
  const has = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  const mirror = has("parcel_addresses") ? db.prepare("SELECT street, house, hood FROM parcel_addresses WHERE gush = ? AND helka = ? AND sub = ?") : null;
  const over = has("over_parcel_addresses") ? db.prepare("SELECT suffix, street, house, hood FROM over_parcel_addresses WHERE gush = ? AND helka = ?") : null;

  const cities = ONLY ? [ONLY] : (db.prepare("SELECT DISTINCT city_name c FROM nadlan_transactions").all() as Array<{ c: string }>).map((r) => r.c);
  const rowsOf = db.prepare(`SELECT id, parcel_num p, street, house_num house, neighborhood hood FROM nadlan_transactions
     WHERE city_name = ? AND COALESCE(excluded, 0) = 0`);
  const set = DRY ? null : db.prepare(`UPDATE nadlan_transactions SET
      street = CASE WHEN street IS NULL OR TRIM(street) = '' THEN ? ELSE street END,
      house_num = CASE WHEN house_num IS NULL OR TRIM(house_num) = '' THEN ? ELSE house_num END,
      neighborhood = CASE WHEN neighborhood IS NULL OR TRIM(neighborhood) = '' THEN ? ELSE neighborhood END
    WHERE id = ?`);

  let totStreet = 0, totHouse = 0, totHood = 0, totRows = 0, totNoHood = 0;
  for (const city of cities) {
    const rows = rowsOf.all(city) as Row[];
    totRows += rows.length;

    // our own deals' neighbourhoods, by parcel and by address
    const hoodByParcel = new Map<string, Set<string>>();
    const byBuilding = new Map<string, Map<string, number>>();
    const byStreet = new Map<string, Map<string, number>>();
    const bump = (m: Map<string, Map<string, number>>, k: string, h: string) => {
      let c = m.get(k); if (!c) m.set(k, (c = new Map()));
      c.set(h, (c.get(h) ?? 0) + 1);
    };
    for (const r of rows) {
      if (blank(r.hood)) continue;
      const h = r.hood!.trim();
      if (r.p) {
        for (const k of [r.p.trim(), gushHelkaOf(r.p)]) if (k) { const s = hoodByParcel.get(k) ?? new Set(); s.add(h); hoodByParcel.set(k, s); }
      }
      if (!blank(r.street)) {
        const st = normStreet(r.street);
        bump(byStreet, st, h);
        if (!blank(r.house)) bump(byBuilding, `${st}|${normHouse(r.house).primary}`, h);
      }
    }

    const writes: Array<[string | null, string | null, string | null, number]> = [];
    let cStreet = 0, cHouse = 0, cHood = 0;
    for (const r of rows) {
      const needStreet = blank(r.street), needHouse = blank(r.house), needHood = blank(r.hood);
      if (!needStreet && !needHouse && !needHood) continue;
      let street: string | null = null, house: string | null = null, hood: string | null = null;

      // 1 + 2: by parcel
      const gh = gushHelkaOf(r.p);
      if (gh) {
        const [g, h] = gh.split("-").map(Number);
        const sub = Number(r.p!.split("-")[2] ?? 0);
        const fromMirror = mirror
          ? ((sub > 0 ? mirror.get(g, h, sub) : undefined) ?? mirror.get(g, h, 0)) as { street: string; house: string; hood: string | null } | undefined
          : undefined;
        let cand: { street: string; house: string; hood: string | null } | null = fromMirror ?? null;
        if (!cand && over) {
          const op = overParcelFromRows(over.all(g, h) as Array<{ suffix: number; street: string; house: string; hood: string | null }>);
          if (!op.ambiguous && op.addresses.length === 1) cand = { ...op.addresses[0], hood: op.hood };
          else if (!op.ambiguous && op.hood) hood = op.hood;
        }
        if (cand) {
          // a row that names a street takes the rest only from that street
          const same = needStreet || normStreet(r.street) === normStreet(cand.street);
          if (same) {
            if (needStreet) street = cand.street;
            if (needHouse) house = cand.house;
            if (cand.hood) hood = cand.hood;
          }
        }
        if (!hood) {
          const own = hoodByParcel.get(r.p!.trim()) ?? hoodByParcel.get(gh);
          if (own?.size === 1) hood = [...own][0];
        }
      }

      // 3: by the address our own deals know
      const st = street ?? (blank(r.street) ? null : r.street);
      if (!hood && st) {
        const hs = house ?? (blank(r.house) ? null : r.house);
        const k = normStreet(st);
        const pick = (hs ? pickModalHood(byBuilding.get(`${k}|${normHouse(hs).primary}`) ?? new Map(), { minN: 3 }) : null)
          ?? pickModalHood(byStreet.get(k) ?? new Map());
        if (pick) hood = pick.hood;
      }

      const w: [string | null, string | null, string | null, number] = [
        needStreet ? street : null, needHouse ? house : null, needHood ? hood : null, r.id,
      ];
      if (w[0] == null && w[1] == null && w[2] == null) continue;
      writes.push(w);
      if (w[0]) cStreet++;
      if (w[1]) cHouse++;
      if (w[2]) cHood++;
    }
    if (set && writes.length) db.transaction(() => { for (const w of writes) set.run(...w); })();
    totStreet += cStreet; totHouse += cHouse; totHood += cHood;
    totNoHood += rows.filter((r) => blank(r.hood)).length - cHood;
    if (cStreet + cHood > 50) console.log(`  ${city}: +${cStreet.toLocaleString("he-IL")} רחובות · +${cHouse.toLocaleString("he-IL")} מספרי בית · +${cHood.toLocaleString("he-IL")} שכונות`);
  }
  console.log(`\n✓ כתובות${DRY ? " (יבש)" : ""}: +${totStreet.toLocaleString("he-IL")} רחובות · +${totHouse.toLocaleString("he-IL")} מספרי בית · +${totHood.toLocaleString("he-IL")} שכונות · ` +
    `עדיין בלי שכונה: ${totNoHood.toLocaleString("he-IL")} מתוך ${totRows.toLocaleString("he-IL")} (${totRows ? ((totNoHood / totRows) * 100).toFixed(1) : 0}%)`);
}

main();
