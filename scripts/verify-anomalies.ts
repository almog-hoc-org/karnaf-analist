#!/usr/bin/env tsx
/**
 * VERIFY the price-anomaly rules end-to-end, per city (user's Priority 2).
 *
 * Re-derives the comparison groups EXACTLY as scripts/flag-outlier-deals.ts does —
 * median ₪/m² of city×NEIGHBORHOOD×year×rooms_effective×building-age (fallback:
 * city×type; city×year safety net) — over the same input basis the flag saw
 * (active ∪ anomaly-flagged rows), then proves:
 *   1. ZERO active deals deviate > anomaly_deviation_pct from their own group median.
 *   2. ZERO active deals sit beyond ±anomaly_city_mult× the city×year median.
 *   3. Per-city flag rates are in a sane band (reported; outliers listed).
 *   4. A random sample of flagged deals with their deviation % (human spot-check).
 *
 * Writes data/anomaly-verification.json (shown in the admin reliability tab).
 * Read-only w.r.t. deals — never mutates the table.
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { getRuleNum } from "../lib/systemRules";
import { buildingAgeOf } from "../lib/roomClassification";
import { historyFromYear } from "../lib/historyWindow";

// Window comes from the shared history floor (lib/historyWindow) — every
// stage must process the SAME range or later stages aggregate rows earlier
// stages never cleaned. Was a private `YEARS_BACK = 10` per script.
const MIN_COHORT = 10;

interface Row {
  id: number; city_name: string; neighborhood: string | null; deal_year: number;
  rr: number; year_built: number | null; area: number | null; price_sqm: number;
  excluded: number; reason: string | null;
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function main() {
  const pct = getRuleNum("anomaly_deviation_pct", 35) / 100;
  const cityMult = getRuleNum("anomaly_city_mult", 3);
  const modernMin = getRuleNum("modern_min_year", 2005);
  const MIN_SQM = getRuleNum("min_sqm_price", 2000), MAX_SQM = getRuleNum("max_sqm_price", 200000);
  const MIN_AREA = getRuleNum("min_area", 20), MAX_AREA = getRuleNum("max_area", 500);
  const minYear = historyFromYear();

  const db = new Database(path.resolve("./data/realestate.db"), { readonly: true });
  db.pragma("busy_timeout = 60000");
  // the flag's input basis: rows that were active when it ran = active now ∪ flagged-as-anomaly
  const rows = db.prepare(
    `SELECT id, city_name, neighborhood, deal_year, CAST(rooms_effective AS INT) rr, year_built, area, price_sqm,
            COALESCE(excluded,0) excluded, exclusion_reason reason
     FROM nadlan_transactions
     WHERE deal_year >= ? AND source='nadlan' AND rooms_effective > 0
       AND (COALESCE(excluded,0)=0 OR exclusion_reason LIKE 'אנומליית מחיר%')
       AND price_sqm BETWEEN ? AND ? AND area BETWEEN ? AND ?`
  ).all(minYear, MIN_SQM, MAX_SQM, MIN_AREA, MAX_AREA) as Row[];

  // pools — identical keys to flag-outlier-deals.ts
  const nbhd = new Map<string, number[]>(), type = new Map<string, number[]>(), cy = new Map<string, number[]>(), cc = new Map<string, number[]>();
  const push = (m: Map<string, number[]>, k: string, v: number) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  const ba = (r: Row) => buildingAgeOf(r.year_built, modernMin);
  const nbhdKey = (r: Row) => (r.neighborhood ? `${r.city_name}|${r.neighborhood}|${r.deal_year}|${r.rr}|${ba(r)}` : null);
  const typeKey = (r: Row) => `${r.city_name}|${r.deal_year}|${r.rr}|${ba(r)}`;
  const cyKey = (r: Row) => `${r.city_name}|${r.deal_year}`;
  for (const r of rows) { const nk = nbhdKey(r); if (nk) push(nbhd, nk, r.price_sqm); push(type, typeKey(r), r.price_sqm); push(cy, cyKey(r), r.price_sqm); push(cc, r.city_name, r.price_sqm); }
  const centerOf = (m: Map<string, number[]>) => { const c = new Map<string, number>(); for (const [k, v] of m) if (v.length >= MIN_COHORT) c.set(k, median(v)); return c; };
  const nbhdC = centerOf(nbhd), typeC = centerOf(type), cyC = centerOf(cy), ccC = centerOf(cc);

  const perCity = new Map<string, { active: number; flagged: number; violGroup: number; violCity: number }>();
  const cs = (c: string) => { let s = perCity.get(c); if (!s) { s = { active: 0, flagged: 0, violGroup: 0, violCity: 0 }; perCity.set(c, s); } return s; };
  const samples: unknown[] = [];
  for (const r of rows) {
    const s = cs(r.city_name);
    const nk = nbhdKey(r);
    const t = (nk ? nbhdC.get(nk) : undefined) ?? typeC.get(typeKey(r));
    const cityRef = cyC.get(cyKey(r)) ?? ccC.get(r.city_name);
    const devGroup = t != null && t > 0 ? (r.price_sqm - t) / t : null;
    if (r.excluded) {
      s.flagged++;
      if (samples.length < 400 && Math.random() < 0.02) samples.push({
        city: r.city_name, year: r.deal_year, rooms: r.rr, building: ba(r),
        price_sqm: Math.round(r.price_sqm), group_median: t != null ? Math.round(t) : null,
        deviation_pct: devGroup != null ? Math.round(devGroup * 100) : null,
      });
      continue;
    }
    s.active++;
    if (devGroup != null && Math.abs(devGroup) > pct) s.violGroup++;
    if (cityRef != null && cityRef > 0 && (r.price_sqm > cityMult * cityRef || r.price_sqm < cityRef / cityMult)) s.violCity++;
  }

  const cities = [...perCity.entries()].map(([city, s]) => ({
    city, active: s.active, flagged: s.flagged,
    flag_rate_pct: s.active + s.flagged ? Math.round((100 * s.flagged) / (s.active + s.flagged)) : 0,
    violations_group: s.violGroup, violations_city_net: s.violCity,
  })).sort((a, b) => b.active - a.active);
  const nat = cities.reduce((acc, c) => ({ active: acc.active + c.active, flagged: acc.flagged + c.flagged, vg: acc.vg + c.violations_group, vc: acc.vc + c.violations_city_net }), { active: 0, flagged: 0, vg: 0, vc: 0 });

  const report = {
    generatedAt: new Date().toISOString(),
    params: { anomaly_deviation_pct: pct * 100, anomaly_city_mult: cityMult, modern_min_year: modernMin, min_cohort: MIN_COHORT, from_year: minYear },
    national: { active: nat.active, flagged: nat.flagged, flag_rate_pct: Math.round((100 * nat.flagged) / Math.max(1, nat.active + nat.flagged)), violations_group: nat.vg, violations_city_net: nat.vc, pass: nat.vg === 0 && nat.vc === 0 },
    worst_flag_rates: [...cities].filter((c) => c.active + c.flagged >= 200).sort((a, b) => b.flag_rate_pct - a.flag_rate_pct).slice(0, 10),
    cities_with_violations: cities.filter((c) => c.violations_group > 0 || c.violations_city_net > 0),
    cities,
    flagged_samples: samples,
  };
  fs.writeFileSync(path.resolve("./data/anomaly-verification.json"), JSON.stringify(report, null, 1), "utf8");
  console.log(`verify-anomalies: active=${nat.active.toLocaleString("en")} flagged=${nat.flagged.toLocaleString("en")} ` +
    `(${report.national.flag_rate_pct}%) · group-violations=${nat.vg} · city-net-violations=${nat.vc} → ${report.national.pass ? "PASS ✓" : "FAIL ✗"}`);
  if (!report.national.pass) for (const c of report.cities_with_violations.slice(0, 10)) console.log(`   ✗ ${c.city}: group=${c.violations_group} cityNet=${c.violations_city_net}`);
  db.close();
  process.exitCode = report.national.pass ? 0 : 1;
}
main();
