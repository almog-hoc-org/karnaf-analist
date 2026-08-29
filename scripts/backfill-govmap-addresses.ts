#!/usr/bin/env tsx
/**
 * THE ADDRESS BACKFILL CAMPAIGN — pull streets onto the deals that lack them.
 *
 * WHY MOST DEALS HAVE NO STREET. The bulk history (~1.45M rows) was collected
 * by scripts/collect-transactions.ts, whose insert column list simply omits
 * street/house_num/floor — for BOTH channels, including govmap, the one
 * channel whose API returns a full address for every deal. The addresses were
 * on the wire and were dropped at the door. The nightly merge can only donate
 * addresses from govmap rows that HAVE one, so coverage stalled at the slice
 * of the country the modern govmap collector happened to re-visit.
 *
 * WHAT THIS DOES. Re-walks the govmap deal feed city by city and DONATES the
 * addresses onto the existing rows:
 *
 *   pass 0 — exact join by source_deal_id (rows written after the column landed);
 *   pass 1 — the merge's strict key: deal_date | round(price) | round(area) | round(rooms);
 *   pass 2 — the merge's soft key:   deal_date | round(price), area within ±2 m²;
 *
 * with the merge's never-guess rules (lib/addressBackfill.ts): donors that
 * conflict on the street donate nothing; agreeing street + conflicting hood
 * donates the street only. All writes are UPDATE … COALESCE — an existing
 * value is never overwritten.
 *
 * UPDATE-ONLY, NEVER INSERT — the load-bearing decision. street is part of
 * the deal identity key (lib/dealKey.ts), so inserting a street-ful copy next
 * to a street-less legacy row would create a duplicate instead of a match.
 * Updating in place also HEALS that trap: once the legacy row carries the
 * govmap values, a future re-collection matches the full key and dedupes
 * cleanly.
 *
 * CAMPAIGN MECHANICS. ~400-550 requests per city at a polite 300ms pace means
 * the whole country is ~15-20 hours of network — not one night. So: per-city
 * checkpoint table (govmap_address_backfill_status), gap-first ordering
 * (largest street-less counts first), and a time budget
 * (KARNAF_BACKFILL_BUDGET_MIN, default 60) that stops STARTING cities and
 * prints "rest resume next run". Exit 0 on a budget stop — resumable is
 * success; non-zero only on the geo-block or a fatal error.
 *
 * Registered in lib/collectors.ts (probe-gated: runs wherever govmap answers,
 * skipped loudly where it is geo-blocked) and triggerable from deploy.yml via
 * the run_backfill dispatch input.
 *
 * Usage:
 *   npx tsx scripts/backfill-govmap-addresses.ts              # campaign step, budgeted
 *   npx tsx scripts/backfill-govmap-addresses.ts "תל אביב-יפו" --force
 *   npx tsx scripts/backfill-govmap-addresses.ts "עיר" --from-file=deals.json
 *     (--from-file: read the govmap deal list from a JSON file instead of the
 *      network — the offline harness for verifying the matching rules, and the
 *      escape hatch for replaying a captured feed.)
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fetchCityDeals, govmapWindows, isGeoBlockError, type GovmapRawDeal } from "../lib/govmapDeals";
import { strictKey, looseKey, chooseDonation, orderCitiesByGap, SOFT_AREA_TOLERANCE_SQM, type AddressDonor } from "../lib/addressBackfill";
import { ensureSourceDealIdColumnSync } from "../lib/addressBackfillDb";
import { normalizeCity } from "../lib/cityAliases";

/** Bump to re-run the campaign over cities already marked ok (a method change
 *  means the old pass may have missed donations the new one finds). */
const METHOD = "backfill-v1";
// Same window discipline as the collector: ten years by default, narrowable.
const START_DATE = process.env.KARNAF_COLLECT_FROM || "2016-01";
const WINDOWS = govmapWindows(START_DATE);

interface TargetRow {
  id: number; deal_date: string; price: number; area: number; rooms: number | null;
  street: string | null; neighborhood: string | null; source_deal_id: string | null;
}

function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const fromFile = argv.find((a) => a.startsWith("--from-file="))?.slice("--from-file=".length) ?? null;
  const names = argv.filter((a) => !a.startsWith("--"));
  if (fromFile && names.length !== 1) {
    console.error("--from-file דורש בדיוק עיר אחת בארגומנטים");
    process.exit(1);
  }
  // A dedicated env var, NOT MAX_RUNTIME_MIN: scripts/collect.ts spawns its
  // children with the whole process env, and the shared name would silently
  // retune collect-transactions' own budget too.
  const budgetMin = Number(process.env.KARNAF_BACKFILL_BUDGET_MIN ?? (names.length ? 0 : 60));
  const t0 = Date.now();
  const overBudget = () => budgetMin > 0 && (Date.now() - t0) / 60000 >= budgetMin;

  const db = new Database(path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 60000");
  ensureSourceDealIdColumnSync(db);
  db.exec(`CREATE TABLE IF NOT EXISTS govmap_address_backfill_status (
    city_name TEXT NOT NULL UNIQUE,
    method_version TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    filled_street INTEGER NOT NULL DEFAULT 0,
    filled_hood INTEGER NOT NULL DEFAULT 0,
    ambiguous INTEGER NOT NULL DEFAULT 0,
    unmatched INTEGER NOT NULL DEFAULT 0,
    last_run DATETIME
  )`);
  const upsertStatus = db.prepare(`
    INSERT INTO govmap_address_backfill_status
      (city_name, method_version, status, attempts, filled_street, filled_hood, ambiguous, unmatched, last_run)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(city_name) DO UPDATE SET
      method_version=excluded.method_version, status=excluded.status,
      attempts=govmap_address_backfill_status.attempts+1,
      filled_street=excluded.filled_street, filled_hood=excluded.filled_hood,
      ambiguous=excluded.ambiguous, unmatched=excluded.unmatched, last_run=excluded.last_run`);
  const doneCity = db.prepare(
    `SELECT 1 FROM govmap_address_backfill_status WHERE city_name=? AND status='ok' AND method_version=?`);

  // Targets: rows missing street or hood, from ANY source and INCLUDING
  // excluded rows — address donation is harmless (the merge's own rule), and a
  // healed excluded row still improves future dedup matching.
  const selectTargets = db.prepare(`
    SELECT id, deal_date, price, area, rooms, street, neighborhood, source_deal_id
      FROM nadlan_transactions
     WHERE city_name = ? AND (street IS NULL OR neighborhood IS NULL) AND price>0 AND area>0`);
  const applyDonation = db.prepare(`
    UPDATE nadlan_transactions SET
      street=COALESCE(street,?), house_num=COALESCE(house_num,?),
      floor=COALESCE(floor,?), neighborhood=COALESCE(neighborhood,?),
      source_deal_id=COALESCE(source_deal_id,?)
     WHERE id=?`);

  // Gap-first ordering: the biggest holes get the first nights.
  const gapRows = db.prepare(`
    SELECT city_name, COUNT(*) missing FROM nadlan_transactions
     WHERE (street IS NULL OR neighborhood IS NULL) AND price>0 AND area>0
     GROUP BY city_name`).all() as Array<{ city_name: string; missing: number }>;
  const gapByCity = new Map(gapRows.map((r) => [r.city_name, r.missing]));
  const cities = names.length
    ? names
    : orderCitiesByGap(gapRows.map((r) => ({ ...r }))).map((r) => r.city_name);

  console.log(`\n=== backfill-govmap-addresses (${METHOD}) — ${cities.length} cities, window from ${START_DATE}, budget ${budgetMin || "∞"}min ===`);

  (async () => {
    let done = 0, skipped = 0, budgetStopped = false;
    const totals = { street: 0, hood: 0, ambiguous: 0, unmatched: 0 };

    for (let i = 0; i < cities.length; i++) {
      const city = cities[i];
      const tag = `[${i + 1}/${cities.length}] ${city}`;
      if (!force && doneCity.get(city, METHOD)) { skipped++; continue; }
      const missing = gapByCity.get(city) ?? 0;
      if (missing === 0) { upsertStatus.run(city, METHOD, "ok", 0, 0, 0, 0); skipped++; continue; }
      if (overBudget()) {
        console.log(`\n⏱ תקציב הזמן נגמר אחרי ${done} ערים — ההמשך בריצה הבאה (${cities.length - i} ערים ממתינות).`);
        budgetStopped = true;
        break;
      }

      let deals: GovmapRawDeal[];
      const tCity = Date.now();
      try {
        deals = fromFile
          ? (JSON.parse(fs.readFileSync(fromFile, "utf8")) as GovmapRawDeal[])
          : await fetchCityDeals(city, WINDOWS);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        upsertStatus.run(city, METHOD, "error", 0, 0, 0, missing);
        if (isGeoBlockError(e)) {
          // Every later city would fail with the same answer — stop the run
          // instead of burning hours confirming the same block 168 times.
          console.error(`${tag}: ${msg}`);
          console.error(`⛔ govmap חסום מהסביבה הזו — הקמפיין ירוץ מסביבה שבה govmap עונה (מק/פרוקסי ישראלי).`);
          db.close();
          process.exit(1);
        }
        console.error(`${tag}: ERROR — ${msg}`);
        continue;
      }

      // Donor indexes. Only deals that actually carry something donateable.
      const donorOf = (d: GovmapRawDeal): AddressDonor => ({
        street: d.streetNameHeb?.trim() || null,
        house_num: d.houseNum != null ? String(d.houseNum) : null,
        floor: d.floorNo ?? null,
        neighborhood: d.neighborhood?.trim() || null,
      });
      const cityKey = normalizeCity(city);
      void cityKey; // fetchCityDeals already filtered by settlement
      const usable = deals.filter((d) => (d.streetNameHeb?.trim() || d.neighborhood?.trim()) && d.dealAmount > 0 && (d.assetArea ?? 0) > 0);
      const byId = new Map<string, GovmapRawDeal>();
      const byStrict = new Map<string, GovmapRawDeal[]>();
      const byLoose = new Map<string, GovmapRawDeal[]>();
      for (const d of usable) {
        const dd = { deal_date: String(d.dealDate).slice(0, 10), price: d.dealAmount, area: d.assetArea ?? 0, rooms: d.assetRoomNum };
        if (d.dealId != null) byId.set(String(d.dealId), d);
        const sk = strictKey(dd);
        const lk = looseKey(dd);
        (byStrict.get(sk) ?? byStrict.set(sk, []).get(sk)!).push(d);
        (byLoose.get(lk) ?? byLoose.set(lk, []).get(lk)!).push(d);
      }

      const targets = selectTargets.all(city) as TargetRow[];
      let filledStreet = 0, filledHood = 0, ambiguous = 0, unmatched = 0;

      db.transaction(() => {
        for (const t of targets) {
          // pass 0 — exact by source id
          let cands: GovmapRawDeal[] | null = null;
          if (t.source_deal_id && byId.has(t.source_deal_id)) {
            cands = [byId.get(t.source_deal_id)!];
          } else {
            // pass 1 — strict key
            const sk = strictKey(t);
            const strict = byStrict.get(sk);
            if (strict?.length) cands = strict;
            else {
              // pass 2 — soft key + area tolerance
              const loose = (byLoose.get(looseKey(t)) ?? [])
                .filter((d) => Math.abs((d.assetArea ?? 0) - t.area) <= SOFT_AREA_TOLERANCE_SQM);
              if (loose.length) cands = loose;
            }
          }
          if (!cands) { unmatched++; continue; }
          const donation = chooseDonation(cands.map(donorOf));
          if (!donation) { ambiguous++; continue; }
          const wantStreet = !t.street && donation.street;
          const wantHood = !t.neighborhood && donation.neighborhood;
          if (!wantStreet && !wantHood) continue;
          // source_deal_id only on an unambiguous single-donor match — the id
          // must mean "this exact govmap record", never "one of these".
          const sid = cands.length === 1 && cands[0].dealId != null ? String(cands[0].dealId) : null;
          applyDonation.run(donation.street, donation.house_num, donation.floor, donation.neighborhood, sid, t.id);
          if (wantStreet) filledStreet++;
          if (wantHood) filledHood++;
        }
      })();

      totals.street += filledStreet; totals.hood += filledHood;
      totals.ambiguous += ambiguous; totals.unmatched += unmatched;
      upsertStatus.run(city, METHOD, "ok", filledStreet, filledHood, ambiguous, unmatched);
      done++;
      console.log(`${tag}: ${usable.length.toLocaleString("en")} עסקאות govmap · +${filledStreet.toLocaleString("en")} רחוב · +${filledHood.toLocaleString("en")} שכונה · ${ambiguous} דו-משמעי · ${unmatched.toLocaleString("en")} ללא התאמה (${((Date.now() - tCity) / 1000).toFixed(0)}s)`);
    }

    console.log(`\n--- backfill done: ${done} ערים טופלו, ${skipped} דולגו${budgetStopped ? ", נעצר בתקציב" : ""} · ` +
      `סה״כ +${totals.street.toLocaleString("en")} רחובות, +${totals.hood.toLocaleString("en")} שכונות, ` +
      `${totals.ambiguous.toLocaleString("en")} דו-משמעיים, ${totals.unmatched.toLocaleString("en")} ללא התאמה ---`);
    db.close();
  })().catch((e) => { console.error("FATAL", e); db.close(); process.exit(1); });
}
main();
