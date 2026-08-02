#!/usr/bin/env tsx
/**
 * Flag LUXURY DEALS and keep them out of the price statistics (user rule).
 *
 * TWO CUMULATIVE CONDITIONS — an expensive deal is only a distortion if it is
 * also expensive *for its own category*:
 *   1. price > luxury_min_price (default ₪4.5M), and
 *   2. ₪/m² > (1 + luxury_sqm_premium_pct) × the MEDIAN ₪/m² of the same
 *      category = city × year × rooms × type(second-hand / new).
 * A ₪5M penthouse priced like every other 5-room flat in that city is NOT an
 * outlier and stays in. Measured: half the deals over ₪4.5M fail condition 2.
 *
 * Unlike a duplicate report, a luxury deal DID happen — so it is never
 * `excluded`. It keeps its place in the counts and in the deal drill-down, and
 * only leaves the averages/medians/graphs, through the `luxury` column.
 *
 * Cohort ladder (thin cohorts have no trustworthy median):
 *   city|year|rooms|type → city|year|type → city|year → don't flag.
 * The govmap channel has no build-year, so its rows land in a type="unknown"
 * cohort of their own — the 29 govmap-only cities stay covered without ever
 * being compared against nadlan-priced rows.
 *
 * Idempotent. Last 10 years. Pipeline: … → flag-duplicate → flag-outlier →
 * THIS → aggregate. It runs after the anomaly pass so the cohort medians are
 * computed on a base already free of duplicates and broken rows.
 *
 * Run: npx tsx scripts/flag-luxury-deals.ts
 */
import Database from "better-sqlite3";
import path from "path";
import { getRuleNum, getRuleBool } from "../lib/systemRules";
import { ensureAuditLog } from "../lib/auditLog";

const YEARS_BACK = 10;

interface Row {
  id: number; city_name: string; deal_year: number; rooms_effective: number | null;
  is_secondhand: number; year_built: number | null; price: number; price_sqm: number; source: string;
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** idempotent column add — same pattern as reclassify-rooms-by-area.ts */
function ensureColumn(db: Database.Database, table: string, col: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function main() {
  const on = getRuleBool("luxury_filter_on", true);
  const minPrice = getRuleNum("luxury_min_price", 4_500_000);
  const premium = getRuleNum("luxury_sqm_premium_pct", 20) / 100;
  const minCohort = Math.max(2, getRuleNum("luxury_min_cohort", 10));
  const minYear = new Date().getFullYear() - YEARS_BACK;

  const db = new Database(path.resolve("./data/realestate.db"));
  db.pragma("journal_mode = WAL");
  ensureAuditLog(db); // seven writers, no owner — see lib/auditLog.ts
  db.pragma("busy_timeout = 60000");
  ensureColumn(db, "nadlan_transactions", "luxury", "luxury INTEGER DEFAULT 0");
  ensureColumn(db, "nadlan_transactions", "luxury_ratio", "luxury_ratio REAL");

  // idempotent reset — a rule change in the dashboard must clear the old marks
  const reset = db.prepare(
    `UPDATE nadlan_transactions SET luxury=0, luxury_ratio=NULL WHERE COALESCE(luxury,0)=1 AND deal_year >= ?`).run(minYear);

  if (!on) {
    console.log(`flag-luxury-deals: rule DISABLED — released ${reset.changes.toLocaleString("en")} previously-flagged deals.`);
    db.close();
    return;
  }
  console.log(`flag luxury: price > ₪${minPrice.toLocaleString("en")} AND ₪/m² > +${(premium * 100).toFixed(0)}% over the category median · cohort ≥${minCohort} · years≥${minYear}`);

  const rows = db.prepare(
    `SELECT id, city_name, deal_year, rooms_effective, is_secondhand, year_built, price, price_sqm, source
     FROM nadlan_transactions
     WHERE COALESCE(excluded,0)=0 AND deal_year >= ? AND price > 0 AND price_sqm > 0`
  ).all(minYear) as Row[];
  console.log(`  scanning ${rows.length.toLocaleString("en")} active priced deals…`);

  // category keys, widest fallback last
  const typeOf = (r: Row) => ((r.year_built ?? 0) > 0 ? (r.is_secondhand ? "sh" : "new") : "unknown");
  const roomsOf = (r: Row) => ((r.rooms_effective ?? 0) > 0 ? String(Math.round(r.rooms_effective!)) : "?");
  const kFull = (r: Row) => `${r.city_name}|${r.deal_year}|${roomsOf(r)}|${typeOf(r)}`;
  const kType = (r: Row) => `${r.city_name}|${r.deal_year}|${typeOf(r)}`;
  const kCity = (r: Row) => `${r.city_name}|${r.deal_year}`;

  const bucket = (keyFn: (r: Row) => string) => {
    const m = new Map<string, number[]>();
    for (const r of rows) {
      const k = keyFn(r);
      const a = m.get(k);
      if (a) a.push(r.price_sqm); else m.set(k, [r.price_sqm]);
    }
    return m;
  };
  const mediansOf = (m: Map<string, number[]>) => {
    const o = new Map<string, number>();
    for (const [k, v] of m) if (v.length >= minCohort) o.set(k, median(v));
    return o;
  };
  const mFull = mediansOf(bucket(kFull)), mType = mediansOf(bucket(kType)), mCity = mediansOf(bucket(kCity));

  const flagged: Array<{ id: number; ratio: number }> = [];
  const perCity = new Map<string, number>();
  let overPrice = 0, noBaseline = 0, expensiveButNormal = 0;

  for (const r of rows) {
    if (r.price <= minPrice) continue;
    overPrice++;
    const base = mFull.get(kFull(r)) ?? mType.get(kType(r)) ?? mCity.get(kCity(r));
    if (!base || base <= 0) { noBaseline++; continue; }
    const ratio = r.price_sqm / base;
    if (ratio > 1 + premium) {
      flagged.push({ id: r.id, ratio });
      perCity.set(r.city_name, (perCity.get(r.city_name) ?? 0) + 1);
    } else expensiveButNormal++;
  }

  const mark = db.prepare(`UPDATE nadlan_transactions SET luxury=1, luxury_ratio=? WHERE id=?`);
  db.transaction(() => { for (const f of flagged) mark.run(Number(f.ratio.toFixed(3)), f.id); })();

  // the exclusion log is the site's audit trail — luxury is a price-only rule, so
  // it is written as its own action and never mixed into the excluded counts
  db.prepare(
    `INSERT INTO admin_exclusion_log (action, affected, reason, created_at) VALUES ('luxury', ?, ?, datetime('now'))`
  ).run(flagged.length, `עסקאות יוקרה (מעל ₪${(minPrice / 1e6).toFixed(1)}M וגם +${(premium * 100).toFixed(0)}% מחציון הקטגוריה) — הוחרגו מהמחירים בלבד`);

  console.log(`  reset ${reset.changes.toLocaleString("en")} prior marks`);
  console.log(`  over ₪${(minPrice / 1e6).toFixed(1)}M: ${overPrice.toLocaleString("en")} · flagged luxury: ${flagged.length.toLocaleString("en")} (${(flagged.length / rows.length * 100).toFixed(2)}% of active)`);
  console.log(`  expensive but normal for their category — kept in the averages: ${expensiveButNormal.toLocaleString("en")} · no usable baseline: ${noBaseline.toLocaleString("en")}`);
  for (const [c, n] of [...perCity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${c}: ${n.toLocaleString("en")}`);
  db.close();
}
main();
