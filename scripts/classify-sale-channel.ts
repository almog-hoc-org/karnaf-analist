#!/usr/bin/env tsx
/**
 * Fill the new / second-hand split where the build year is missing.
 *
 * WHY THIS EXISTS
 * A price trend built on deals that aren't split into new and second-hand is not
 * a price trend — it tracks the SALE MIX. A year that happened to sell mostly new
 * flats, following a year that sold mostly old ones, shows a jump the market
 * never had. Tirat Karmel was the case that surfaced it.
 *
 * The tax authority publishes yearBuilt as 0 on a real share of deals — 30% in
 * Tirat Karmel, 46% in Akko, 14% in Bat Yam — so those deals had no class at all.
 * But two other fields ride on EVERY row:
 *   · hokHamecher — the Sale Law governs a purchase from a DEVELOPER, so 1 = new,
 *     0 = an ordinary resale.
 *   · prevDeals   — the asset's earlier sales. A non-empty list means the flat
 *     already changed hands, which no first-hand sale can do.
 *
 * Measured against the deals that DO carry a build year (probe-yearbuilt.ts):
 *   hokHamecher=0 ⇒ second-hand   83.2% / 92.6% / 86.0% / 91.9% accurate
 *   prevDeals≠[]  ⇒ second-hand   85.8% / 95.2% / 96.8% / 99.6% precision
 *   (Tirat Karmel / Akko / Bat Yam / Be'er Sheva)
 *
 * ORDER MATTERS, AND THE BUILD YEAR STILL WINS. A deal that already has a build
 * year is never touched, so no number that exists today moves. The fallbacks only
 * classify what was previously unclassified. The two definitions are close but
 * not identical — "sold by a developer" is not the same question as "the building
 * is at least N years old" — so every filled row records WHICH signal decided it,
 * and the site can always show that.
 *
 * Idempotent: clears its own prior fills first. Run after collection, before
 * aggregation.
 */
import Database from "better-sqlite3";
import path from "path";
import { getRuleBool } from "../lib/systemRules";
import { historyFromYear } from "../lib/historyWindow";

// Window comes from the shared history floor (lib/historyWindow) — every
// stage must process the SAME range or later stages aggregate rows earlier
// stages never cleaned. Was a private `YEARS_BACK = 10` per script.

function ensureColumn(db: Database.Database, table: string, col: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function main() {
  const on = getRuleBool("class_fallback_on", true);
  const usePrev = getRuleBool("class_use_prev_deals", true);
  const minYear = historyFromYear();

  const db = new Database(path.resolve("./data/realestate.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 60000");
  // which signal decided the class: 'year_built' | 'hok_hamecher' | 'prev_deals' | null
  ensureColumn(db, "nadlan_transactions", "class_source", "class_source TEXT");

  // The two SIGNAL columns this script reads are created by the collectors, not
  // by prisma/schema.prisma — so a database built from the schema alone (a fresh
  // deployment, a restore, a dev machine that has not collected yet) has neither,
  // and this script died with "no such column: hok_hamecher" before doing
  // anything. Declaring them here makes a fresh database degrade correctly: the
  // columns exist, hold NULL, and the fallback simply classifies nothing —
  // which is the honest outcome when the signal was never collected.
  ensureColumn(db, "nadlan_transactions", "hok_hamecher", "hok_hamecher INTEGER");
  ensureColumn(db, "nadlan_transactions", "prev_deals", "prev_deals INTEGER");

  // idempotent: release only the rows THIS script classified
  const reset = db.prepare(
    `UPDATE nadlan_transactions SET is_secondhand=0, class_source=NULL
     WHERE class_source IN ('hok_hamecher','prev_deals') AND deal_year >= ?`).run(minYear);

  // rows whose class came from a real build year — stamped for provenance, never altered
  const stamped = db.prepare(
    `UPDATE nadlan_transactions SET class_source='year_built'
     WHERE year_built IS NOT NULL AND year_built > 0 AND deal_year >= ?
       AND COALESCE(class_source,'') <> 'year_built'`).run(minYear);

  if (!on) {
    console.log(`classify-sale-channel: DISABLED — released ${reset.changes.toLocaleString("en")} fallback classifications.`);
    db.close();
    return;
  }

  // 1) the authority's own developer flag: Sale Law ⇒ bought from a developer
  const byHok = db.prepare(
    `UPDATE nadlan_transactions
     SET is_secondhand = CASE WHEN hok_hamecher = 0 THEN 1 ELSE 0 END, class_source='hok_hamecher'
     WHERE (year_built IS NULL OR year_built = 0) AND hok_hamecher IS NOT NULL AND deal_year >= ?`).run(minYear);

  // 2) an earlier sale of the same asset — only where the flag was absent
  const byPrev = usePrev ? db.prepare(
    `UPDATE nadlan_transactions
     SET is_secondhand = 1, class_source='prev_deals'
     WHERE (year_built IS NULL OR year_built = 0) AND class_source IS NULL
       AND prev_deals IS NOT NULL AND prev_deals > 0 AND deal_year >= ?`).run(minYear) : { changes: 0 };

  const [cov] = db.prepare(
    `SELECT COUNT(*) n,
            SUM(CASE WHEN class_source IS NOT NULL THEN 1 ELSE 0 END) classified,
            SUM(CASE WHEN class_source='year_built' THEN 1 ELSE 0 END) by_yb,
            SUM(CASE WHEN class_source='hok_hamecher' THEN 1 ELSE 0 END) by_hok,
            SUM(CASE WHEN class_source='prev_deals' THEN 1 ELSE 0 END) by_prev
     FROM nadlan_transactions
     WHERE COALESCE(excluded,0)=0 AND source='nadlan' AND deal_year >= ?`).all(minYear) as any[];

  const pct = (v: number) => `${(v / Math.max(1, Number(cov.n)) * 100).toFixed(1)}%`;
  console.log(`classify-sale-channel (since ${minYear}, nadlan rows):`);
  console.log(`  released ${reset.changes.toLocaleString("en")} prior fallbacks · stamped ${stamped.changes.toLocaleString("en")} build-year rows`);
  console.log(`  filled by חוק מכר: ${byHok.changes.toLocaleString("en")} · by עסקאות קודמות: ${byPrev.changes.toLocaleString("en")}`);
  console.log(`  coverage: ${Number(cov.classified).toLocaleString("en")}/${Number(cov.n).toLocaleString("en")} (${pct(Number(cov.classified))}) ` +
    `— שנת בנייה ${pct(Number(cov.by_yb))} · חוק מכר ${pct(Number(cov.by_hok))} · עסקאות קודמות ${pct(Number(cov.by_prev))}`);
  db.close();
}
main();
