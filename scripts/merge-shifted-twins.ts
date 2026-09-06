#!/usr/bin/env tsx
/**
 * One-off repair after the first insert run of the nadlan address campaign
 * (scripts/backfill-nadlan-addresses.ts --insert-new, 5–6.9.2026). Database
 * only; no network.
 *
 * WHAT WENT WRONG. The insert step judged "no row holds this deal" by the
 * exact deal date. MEASURED 6.9.2026: 11,945 of the 101,030 inserted rows
 * have an older nadlan row for the same city, price, area and rooms dated
 * exactly one day LATER (against 519 one day earlier — the symmetric
 * background of identical units sold on consecutive days). That one-sided
 * surplus is a systematic shift between the date the collector stored years
 * ago and the date the site returns today, i.e. the same deal twice.
 *
 * WHAT THIS DOES. For every row the campaign inserted (nadlan source,
 * captured on or after --since) that has such a twin dated +1 day and
 * captured before --since: the twin receives everything the new row knows
 * (street, house number, floor, neighbourhood, parcel, building floors, the
 * site's asset id — COALESCE, nothing overwritten), a duplicate mark the
 * nightly flag left on the twin is lifted, and the new row is deleted. The
 * older row keeps its identity; the address it lacked arrives from the copy.
 * Run scripts/flag-duplicate-deals.ts afterwards (the pipeline does nightly).
 *
 * The same rule now lives in the campaign itself (lib/addressBackfill.ts
 * NADLAN_DATE_SHIFT_DAYS), so a future run neither inserts nor misses these.
 *
 * Usage:
 *   npx tsx scripts/merge-shifted-twins.ts --since=2026-09-05 [--dry-run]
 */
import Database from "better-sqlite3";
import path from "path";
import { shiftDate, NADLAN_DATE_SHIFT_DAYS } from "../lib/addressBackfill";

const DUP_PREFIX = "כפילות-דיווח";

interface NewRow {
  id: number; city_name: string; deal_date: string; price: number; area: number; rooms: number | null;
  street: string | null; house_num: string | null; floor: string | null; neighborhood: string | null;
  parcel_num: string | null; building_floors: number | null; source_deal_id: string | null;
}

function main(): number {
  const argv = process.argv.slice(2);
  const since = argv.find((a) => a.startsWith("--since="))?.slice("--since=".length) ?? "2026-09-05";
  const dryRun = argv.includes("--dry-run");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) { console.error("usage: merge-shifted-twins.ts --since=YYYY-MM-DD [--dry-run]"); return 1; }

  const db = new Database(path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 60000");

  const inserted = db.prepare(`
    SELECT id, city_name, deal_date, price, area, rooms, street, house_num, floor, neighborhood, parcel_num, building_floors, source_deal_id
      FROM nadlan_transactions
     WHERE COALESCE(source,'nadlan') = 'nadlan' AND captured_at >= ? AND price > 0 AND area > 0`).all(since) as NewRow[];
  // the COALESCE forms are what idx_nadlan_tx_dealkey_x indexes (lib/dealKey.ts) — 100k lookups must hit it
  const twinsOf = db.prepare(`
    SELECT id, exclusion_reason FROM nadlan_transactions
     WHERE COALESCE(city_name,'') = ? AND COALESCE(deal_date,'') = ? AND COALESCE(price,-1) = ? AND COALESCE(area,-1) = ?
       AND COALESCE(rooms,0) = ? AND captured_at < ? AND id <> ?`);
  const donate = db.prepare(`
    UPDATE nadlan_transactions SET
      street=COALESCE(street,?), house_num=COALESCE(house_num,?), floor=COALESCE(floor,?), neighborhood=COALESCE(neighborhood,?),
      parcel_num=COALESCE(parcel_num,?), building_floors=COALESCE(building_floors,?), source_deal_id=COALESCE(source_deal_id,?)
     WHERE id=?`);
  const unflag = db.prepare(`UPDATE nadlan_transactions SET excluded=0, exclusion_reason=NULL WHERE id=? AND exclusion_reason LIKE ?`);
  const del = db.prepare(`DELETE FROM nadlan_transactions WHERE id=?`);

  let merged = 0, twins = 0, unflagged = 0;
  const perCity = new Map<string, number>();
  const run = db.transaction(() => {
    for (const r of inserted) {
      const shifted = shiftDate(r.deal_date, NADLAN_DATE_SHIFT_DAYS);
      const olds = twinsOf.all(r.city_name, shifted, r.price, r.area, r.rooms ?? 0, since, r.id) as Array<{ id: number; exclusion_reason: string | null }>;
      if (!olds.length) continue;
      merged++;
      twins += olds.length;
      perCity.set(r.city_name, (perCity.get(r.city_name) ?? 0) + 1);
      if (dryRun) continue;
      for (const o of olds) {
        donate.run(r.street, r.house_num, r.floor, r.neighborhood, r.parcel_num, r.building_floors, r.source_deal_id, o.id);
        if (o.exclusion_reason?.startsWith(DUP_PREFIX)) { unflag.run(o.id, `${DUP_PREFIX}%`); unflagged++; }
      }
      del.run(r.id);
    }
  });
  run();

  console.log(`${dryRun ? "[dry-run] " : ""}נבדקו ${inserted.length.toLocaleString("en")} שורות שהוכנסו מאז ${since} · ${merged.toLocaleString("en")} מהן תאומות של שורה ישנה (+${NADLAN_DATE_SHIFT_DAYS} יום) → ${dryRun ? "היו" : ""} ${twins.toLocaleString("en")} שורות ישנות קיבלו כתובת, ${unflagged.toLocaleString("en")} שוחררו מסימון כפילות, ${merged.toLocaleString("en")} עותקים חדשים נמחקו`);
  for (const [c, n] of [...perCity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`   ${c}: ${n.toLocaleString("en")}`);
  if (!dryRun) console.log("להריץ עכשיו: npx tsx scripts/flag-duplicate-deals.ts (הצינור הלילי עושה זאת ב-02:30 ממילא)");
  db.close();
  return 0;
}

process.exit(main());
