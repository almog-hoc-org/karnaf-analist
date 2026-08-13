#!/usr/bin/env tsx
/**
 * Prove the two cleaning rules actually hold in the data the site serves.
 *
 * A flag script that silently under-runs is worse than no flag script — the
 * numbers look clean and aren't. This re-derives both rules from scratch and
 * fails loudly on any survivor:
 *   1. no two ACTIVE deals are a duplicate report of each other
 *      (identical price/area/rooms, dates inside the window, same flat — and
 *       no more than dupe_same_building_max identical deals in one building)
 *   2. no deal that feeds an average satisfies BOTH luxury conditions
 * Also reconciles the counts the admin dashboard shows.
 *
 * Writes data/cleaning-verification.json for the reliability panel.
 * Run: npx tsx scripts/verify-cleaning-rules.ts   (nightly, after aggregation)
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { getRuleNum, getRuleBool } from "../lib/systemRules";
import { historyFromYear } from "../lib/historyWindow";

// Window comes from the shared history floor (lib/historyWindow) — every
// stage must process the SAME range or later stages aggregate rows earlier
// stages never cleaned. Was a private `YEARS_BACK = 10` per script.

interface Row {
  id: number; city_name: string; deal_date: string; deal_year: number;
  price: number; area: number; rooms: number | null; rooms_effective: number | null;
  year_built: number | null; is_secondhand: number; price_sqm: number;
  floor: string | number | null; street: string | null; house_num: string | null; luxury: number | null;
}

const dayOf = (s: string) => Math.floor(Date.parse(String(s).slice(0, 10)) / 86_400_000);
function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function main() {
  const dupesOn = getRuleBool("duplicate_detection_on", true);
  const luxOn = getRuleBool("luxury_filter_on", true);
  const windowDays = getRuleNum("dupe_window_days", 7);
  const priceTol = getRuleNum("dupe_price_tolerance", 0);
  const areaTol = getRuleNum("dupe_area_tolerance", 0);
  const requireSameUnit = getRuleBool("dupe_require_same_unit", true);
  const sameBuildingMax = Math.max(1, getRuleNum("dupe_same_building_max", 2));
  const minPrice = getRuleNum("luxury_min_price", 4_500_000);
  const premium = getRuleNum("luxury_sqm_premium_pct", 20) / 100;
  const minCohort = Math.max(2, getRuleNum("luxury_min_cohort", 10));
  const minYear = historyFromYear();

  const db = new Database(path.resolve("./data/realestate.db"), { readonly: true });
  const rows = db.prepare(
    `SELECT id, city_name, deal_date, deal_year, price, area, rooms, rooms_effective, year_built,
            is_secondhand, price_sqm, floor, street, house_num, COALESCE(luxury,0) luxury
     FROM nadlan_transactions
     WHERE COALESCE(excluded,0)=0 AND deal_year >= ? AND price > 0 AND area > 0`
  ).all(minYear) as Row[];

  // ── check 1: duplicate reports ────────────────────────────────────────
  const dupeViolations: string[] = [];
  if (dupesOn) {
    const blocks = new Map<string, Row[]>();
    for (const r of rows) {
      const k = priceTol === 0 && areaTol === 0 ? `${r.city_name}|${r.price}|${r.area}|${r.rooms ?? "?"}` : r.city_name;
      const a = blocks.get(k);
      if (a) a.push(r); else blocks.set(k, [r]);
    }
    for (const list of blocks.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => dayOf(a.deal_date) - dayOf(b.deal_date));
      for (let i = 0; i < list.length; i++) {
        // how many identical, in-window deals follow this one?
        const grp = [list[i]];
        for (let j = i + 1; j < list.length && dayOf(list[j].deal_date) - dayOf(list[i].deal_date) <= windowDays; j++) {
          const a = list[i], b = list[j];
          if (Math.abs(b.price - a.price) > priceTol || Math.abs(b.area - a.area) > areaTol) continue;
          if ((a.rooms ?? -1) !== (b.rooms ?? -1)) continue;
          if (a.year_built != null && b.year_built != null && a.year_built !== b.year_built) continue;
          grp.push(b);
        }
        if (grp.length < 2) continue;

        const addrs = grp.map((r) => (r.street ? `${r.street}|${r.house_num ?? ""}` : null)).filter(Boolean);
        const floors = grp.map((r) => r.floor).filter((f) => f != null);
        const differentBuildings = requireSameUnit && addrs.length >= 2 && new Set(addrs).size > 1;
        const sameBuilding = requireSameUnit && !differentBuildings && floors.length >= 2 && new Set(floors.map(String)).size > 1;
        const allowed = differentBuildings ? Infinity : sameBuilding ? sameBuildingMax : 1;
        if (grp.length > allowed) {
          dupeViolations.push(
            `${grp[0].city_name} ${grp[0].deal_date.slice(0, 10)} ₪${Math.round(grp[0].price).toLocaleString("he-IL")} ` +
            `${grp[0].area}מ״ר — ${grp.length} עסקאות פעילות, מותר ${allowed}`);
        }
      }
    }
  }

  // ── check 2: luxury deals that still feed an average ──────────────────
  const luxViolations: string[] = [];
  let luxActive = 0;
  if (luxOn) {
    const priced = rows.filter((r) => r.luxury === 0 && r.price_sqm > 0);
    luxActive = rows.filter((r) => r.luxury === 1).length;
    const typeOf = (r: Row) => ((r.year_built ?? 0) > 0 ? (r.is_secondhand ? "sh" : "new") : "unknown");
    const roomsOf = (r: Row) => ((r.rooms_effective ?? 0) > 0 ? String(Math.round(r.rooms_effective!)) : "?");
    const keys = [
      (r: Row) => `${r.city_name}|${r.deal_year}|${roomsOf(r)}|${typeOf(r)}`,
      (r: Row) => `${r.city_name}|${r.deal_year}|${typeOf(r)}`,
      (r: Row) => `${r.city_name}|${r.deal_year}`,
    ];
    // Cohort medians must be built from the SAME population the flagger used —
    // every active priced deal, luxury ones included. "20% above a similar
    // apartment" means above the market for that category, and the market
    // contains those sales. Rebuilding the median on the post-flag subset would
    // lower it and manufacture violations that aren't breaches of the rule.
    const cohortPool = rows.filter((r) => r.price_sqm > 0);
    const medians = keys.map((k) => {
      const m = new Map<string, number[]>();
      for (const r of cohortPool) { const key = k(r); const a = m.get(key); if (a) a.push(r.price_sqm); else m.set(key, [r.price_sqm]); }
      const o = new Map<string, number>();
      for (const [key, v] of m) if (v.length >= minCohort) o.set(key, median(v));
      return o;
    });
    for (const r of priced) {
      if (r.price <= minPrice) continue;
      const base = medians[0].get(keys[0](r)) ?? medians[1].get(keys[1](r)) ?? medians[2].get(keys[2](r));
      if (!base || base <= 0) continue;
      const ratio = r.price_sqm / base;
      if (ratio > 1 + premium + 1e-6) {
        luxViolations.push(`${r.city_name} ${r.deal_date.slice(0, 10)} ₪${Math.round(r.price).toLocaleString("he-IL")} · ₪${Math.round(r.price_sqm).toLocaleString("he-IL")}/מ״ר = ${(ratio * 100 - 100).toFixed(0)}% מעל החציון`);
      }
    }
  }

  // ── reconciliation: total = active + excluded(by reason) ──────────────
  const [rec] = db.prepare(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN COALESCE(excluded,0)=0 THEN 1 ELSE 0 END) active,
            SUM(CASE WHEN COALESCE(excluded,0)=1 THEN 1 ELSE 0 END) excluded,
            SUM(CASE WHEN exclusion_reason LIKE 'מוזג%' THEN 1 ELSE 0 END) merged,
            SUM(CASE WHEN exclusion_reason LIKE 'כפילות-דיווח%' THEN 1 ELSE 0 END) dupe,
            SUM(CASE WHEN exclusion_reason LIKE 'אנומליית מחיר%' THEN 1 ELSE 0 END) anomaly,
            SUM(CASE WHEN exclusion_reason LIKE 'סינון-שפיות%' THEN 1 ELSE 0 END) sanity
     FROM nadlan_transactions WHERE deal_year >= ?`).all(minYear) as any[];
  const parts = Number(rec.merged) + Number(rec.dupe) + Number(rec.anomaly) + Number(rec.sanity);
  const reconOk = Number(rec.total) === Number(rec.active) + Number(rec.excluded) && parts === Number(rec.excluded);

  const report = {
    generatedAt: new Date().toISOString(),
    scanned: rows.length,
    duplicates: { on: dupesOn, windowDays, sameBuildingMax, violations: dupeViolations.length, samples: dupeViolations.slice(0, 5) },
    luxury: { on: luxOn, minPrice, premiumPct: premium * 100, flaggedActive: luxActive, violations: luxViolations.length, samples: luxViolations.slice(0, 5) },
    reconciliation: {
      ok: reconOk, total: Number(rec.total), active: Number(rec.active), excluded: Number(rec.excluded),
      merged: Number(rec.merged), dupe: Number(rec.dupe), anomaly: Number(rec.anomaly), sanity: Number(rec.sanity),
    },
  };
  fs.writeFileSync(path.resolve("./data/cleaning-verification.json"), JSON.stringify(report, null, 2));

  console.log(`verify-cleaning-rules: scanned ${rows.length.toLocaleString("en")} active deals (since ${minYear})`);
  console.log(`  duplicates: ${dupeViolations.length} violations`);
  dupeViolations.slice(0, 3).forEach((v) => console.log(`    ✗ ${v}`));
  console.log(`  luxury: ${luxActive.toLocaleString("en")} flagged · ${luxViolations.length} still feeding an average`);
  luxViolations.slice(0, 3).forEach((v) => console.log(`    ✗ ${v}`));
  console.log(`  reconciliation: ${reconOk ? "OK" : "MISMATCH"} — ${Number(rec.total).toLocaleString("en")} = ${Number(rec.active).toLocaleString("en")} active + ${Number(rec.excluded).toLocaleString("en")} excluded`);
  db.close();

  if (dupeViolations.length || luxViolations.length || !reconOk) process.exit(1);
  console.log("  ✓ both rules hold across the whole repository.");
}
main();
