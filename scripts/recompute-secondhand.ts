#!/usr/bin/env tsx
/**
 * Re-derive `is_secondhand` from the CURRENT `secondhand_min_age` rule.
 *
 * WHY THIS SCRIPT EXISTS
 * `is_secondhand` is burned in at collection time against a hardcoded constant.
 * Four collectors do it independently — collect-transactions.ts:40,
 * collect-nadlan-transactions.ts:34, fill-city-years.ts:27 and
 * seed-nadlan-transactions-from-files.ts:12 — each with its own `= 4`, and none
 * of them import systemRules. Nothing ever recomputed the column afterwards.
 *
 * So `secondhand_min_age` in the admin dashboard was inert where it mattered
 * most. Changing it moved the explanatory text on /methodology and /city/[slug]
 * and the live /deals comparison, while the column that actually drives every
 * scope="secondhand" price series kept whatever the collector wrote. The
 * dashboard said one thing and the charts showed another, with no error.
 *
 * This closes that gap: one place, derived from the rule, run as a pipeline
 * stage. Idempotent — safe to run repeatedly; it recomputes from scratch each
 * time rather than mutating incrementally.
 *
 * SCOPE — build year only. A row with no year_built cannot be judged here and
 * is left untouched, because classify-sale-channel.ts is what resolves those,
 * from hok_hamecher / prev_deals. This script runs BEFORE it so that pass fills
 * only the genuinely unknown rows.
 *
 * Run: npx tsx scripts/recompute-secondhand.ts   (pipeline: after rooms, before classify)
 */
import Database from "better-sqlite3";
import path from "path";
import { getRuleNum } from "../lib/systemRules";

const YEARS_BACK = 10;

function main() {
  const dryRun = process.argv.includes("--dry-run");

  // NOTE: getRuleNum ignores the caller's fallback whenever the key exists in
  // RULE_DEFS (lib/systemRules.ts:173), which it does. The second argument is
  // therefore documentation, not a default — the real default lives in RULE_DEFS.
  const minAge = getRuleNum("secondhand_min_age", 4);
  if (!Number.isFinite(minAge) || minAge < 0) {
    console.error(`recompute-secondhand: refusing to run — secondhand_min_age is ${minAge}`);
    process.exit(1);
  }

  const db = new Database(path.resolve("./data/realestate.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 60000");

  const minYear = new Date().getFullYear() - YEARS_BACK;
  console.log(`recompute-secondhand: secondhand_min_age=${minAge} · years≥${minYear}${dryRun ? " · DRY RUN" : ""}`);

  // Only rows we can actually judge: a usable build year and a deal year.
  const rows = db.prepare(
    `SELECT id, deal_year, year_built, COALESCE(is_secondhand,0) AS cur
       FROM nadlan_transactions
      WHERE deal_year >= ? AND year_built IS NOT NULL AND year_built > 0`
  ).all(minYear) as Array<{ id: number; deal_year: number; year_built: number; cur: number }>;

  let flips = 0;
  const changes: Array<[number, number]> = [];
  for (const r of rows) {
    const want = r.deal_year - r.year_built >= minAge ? 1 : 0;
    if (want !== r.cur) { changes.push([want, r.id]); flips++; }
  }

  const pct = rows.length ? ((flips / rows.length) * 100).toFixed(2) : "0";
  console.log(`  examined ${rows.length.toLocaleString("en")} deals with a build year · ${flips.toLocaleString("en")} would change (${pct}%).`);

  if (dryRun) {
    console.log("  dry run — nothing written.");
    db.close();
    return;
  }

  if (flips) {
    const upd = db.prepare(`UPDATE nadlan_transactions SET is_secondhand=? WHERE id=?`);
    db.transaction(() => { for (const c of changes) upd.run(c[0], c[1]); })();
  }

  // Report what is left for classify-sale-channel, so a reader of the pipeline
  // log can tell "unknown" apart from "second-hand: no".
  const [{ n: unknown }] = db.prepare(
    `SELECT COUNT(*) n FROM nadlan_transactions
      WHERE deal_year >= ? AND (year_built IS NULL OR year_built <= 0)`
  ).all(minYear) as Array<{ n: number }>;

  console.log(`  wrote ${flips.toLocaleString("en")} changes · ${Number(unknown).toLocaleString("en")} rows have no build year (left to classify-sale-channel).`);
  db.close();
}

main();
