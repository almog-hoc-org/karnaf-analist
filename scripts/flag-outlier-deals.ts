#!/usr/bin/env tsx
/**
 * Flag PRICE ANOMALIES and exclude them site-wide (user rule).
 *
 * Cohort = CITY × YEAR × ROOM-TYPE(rooms_effective) × BUILDING-AGE(modern/old/unknown).
 * A deal is compared to the ROBUST MEDIAN ₪/m² of deals of *its own exact type* —
 * so a legitimately-premium MODERN 4-room is judged against other modern 4-rooms,
 * not the old-dominated mix (which would wrongly flag it). `> anomaly_deviation_pct`
 * (admin-editable, default 35%) from that median → excluded from every average/graph.
 *
 * room-type = rooms_effective (area-corrected). building-age = modern (year_built ≥
 * modern_min_year, default 2005) / old (below) / unknown (no build-year — its OWN
 * cohort, never dropped). Ladder: fine cohort (city×year×rooms×age, n≥MIN) →
 * coarse (city×year×rooms) → don't flag. The coarse fallback is safe because the
 * city-level modern/old gap is small (~7%), well inside the 35% band.
 *
 * Also excludes UNUSABLE rows (area/₪m² out of the sane band). Reversible + logged.
 * Idempotent. Last 10 years. Run: pipeline merge → reclassify → flag → aggregate.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";
import { getRuleNum } from "../lib/systemRules";
import { buildingAgeOf } from "../lib/roomClassification";

const adapter = new PrismaBetterSqlite3({ url: path.resolve("./data/realestate.db") });
const prisma = new PrismaClient({ adapter });

const REASON = "אנומליית מחיר";
const MIN_COHORT = 10;
const YEARS_BACK = 10;

interface Row { id: number; city_name: string; neighborhood: string | null; deal_year: number; rr: number; year_built: number | null; area: number | null; price_sqm: number }

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const pct = getRuleNum("anomaly_deviation_pct", 35) / 100;
  const cityMult = getRuleNum("anomaly_city_mult", 3); // safety net for thin cohorts
  const largeArea = getRuleNum("anomaly_large_area", 120); // big apartments distort ₪/m²
  const modernMinYear = getRuleNum("modern_min_year", 2005);
  const MIN_SQM = getRuleNum("min_sqm_price", 2000), MAX_SQM = getRuleNum("max_sqm_price", 200000);
  const MIN_AREA = getRuleNum("min_area", 20), MAX_AREA = getRuleNum("max_area", 500);
  const minYear = new Date().getFullYear() - YEARS_BACK;
  console.log(`flag price-anomaly: >${(pct * 100).toFixed(0)}% from median · cohort=city×year×room-type×building-age(modern≥${modernMinYear}) · years≥${minYear}`);

  // 1. undo our own prior flags (in scope) — re-runnable. (also clears legacy reasons)
  await prisma.$executeRawUnsafe(
    `UPDATE nadlan_transactions SET excluded=0, exclusion_reason=NULL
     WHERE (exclusion_reason LIKE '${REASON}%' OR exclusion_reason LIKE 'חריג-שוק%' OR exclusion_reason LIKE 'סינון-שפיות%')
       AND deal_year >= ${minYear}`);

  // 2. exclude UNUSABLE rows so active == the set that feeds the graphs.
  const sane = await prisma.$executeRawUnsafe(
    `UPDATE nadlan_transactions SET excluded=1, exclusion_reason='סינון-שפיות (שטח/₪מ"ר מחוץ לתחום)'
     WHERE COALESCE(excluded,0)=0 AND deal_year >= ${minYear}
       AND (area IS NULL OR area < ${MIN_AREA} OR area > ${MAX_AREA}
            OR price_sqm IS NULL OR price_sqm < ${MIN_SQM} OR price_sqm > ${MAX_SQM})`);
  console.log(`  excluded ${Number(sane).toLocaleString("en")} unusable rows (sanity).`);

  // 3. active, priced deals in scope (nadlan feeds all price series). rooms_effective = area-corrected.
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT id, city_name, neighborhood, deal_year, CAST(rooms_effective AS INT) rr, year_built, area, price_sqm
     FROM nadlan_transactions
     WHERE COALESCE(excluded,0)=0 AND deal_year >= ${minYear} AND source='nadlan'
       AND rooms_effective > 0 AND price_sqm BETWEEN ${MIN_SQM} AND ${MAX_SQM} AND area BETWEEN ${MIN_AREA} AND ${MAX_AREA}`
  );
  console.log(`  scanning ${rows.length.toLocaleString("en")} deals…`);

  // 4. compare each deal to the SAME TYPE in the SAME AREA, so real neighbourhood
  //    price differences aren't mistaken for anomalies:
  //    fine  = city × NEIGHBOURHOOD × year × rooms × building-age  (preferred)
  //    type  = city × year × rooms × building-age  (same building type; fallback for thin/absent nbhd)
  //    city  = city × year (all rooms) → wide safety net for absurd ₪/m².
  const nbhd = new Map<string, number[]>(), type = new Map<string, number[]>(), cy = new Map<string, number[]>(), cc = new Map<string, number[]>();
  const push = (m: Map<string, number[]>, k: string, v: number) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  const ba = (r: Row) => buildingAgeOf(r.year_built, modernMinYear);
  const nbhdKey = (r: Row) => (r.neighborhood ? `${r.city_name}|${r.neighborhood}|${r.deal_year}|${r.rr}|${ba(r)}` : null);
  const typeKey = (r: Row) => `${r.city_name}|${r.deal_year}|${r.rr}|${ba(r)}`;
  const cyKey = (r: Row) => `${r.city_name}|${r.deal_year}`;
  for (const r of rows) { const nk = nbhdKey(r); if (nk) push(nbhd, nk, r.price_sqm); push(type, typeKey(r), r.price_sqm); push(cy, cyKey(r), r.price_sqm); push(cc, r.city_name, r.price_sqm); }
  const centerOf = (m: Map<string, number[]>) => { const c = new Map<string, number>(); for (const [k, v] of m) if (v.length >= MIN_COHORT) c.set(k, median(v)); return c; };
  const nbhdC = centerOf(nbhd), typeC = centerOf(type), cyC = centerOf(cy), ccC = centerOf(cc);

  // 5. flag a deal if ANY holds:
  //    (a) > pct from its same-type-same-area median (neighbourhood, else city-type),
  //    (b) beyond ±cityMult× the city×year median — wide net for absurd ₪/m²,
  //    (c) large apartment (area > largeArea) priced far ABOVE its type median (area-error).
  const flagged: number[] = [];
  const byCity = new Map<string, number>();
  for (const r of rows) {
    let anom = false;
    const nk = nbhdKey(r);
    const t = (nk ? nbhdC.get(nk) : undefined) ?? typeC.get(typeKey(r)); // same type, same area preferred
    if (t != null && t > 0 && Math.abs(r.price_sqm - t) / t > pct) anom = true;
    const cityRef = cyC.get(cyKey(r)) ?? ccC.get(r.city_name);
    if (!anom && cityRef != null && cityRef > 0 && (r.price_sqm > cityMult * cityRef || r.price_sqm < cityRef / cityMult)) anom = true;
    if (!anom && largeArea > 0 && (r.area ?? 0) > largeArea && t != null && t > 0 && r.price_sqm > (1 + pct) * t) anom = true;
    if (anom) { flagged.push(r.id); byCity.set(r.city_name, (byCity.get(r.city_name) ?? 0) + 1); }
  }

  // 6. mark excluded (chunked) + log
  const reason = `${REASON} (>${(pct * 100).toFixed(0)}% מחציון הטיפוס: עיר×שנה×חדרים×גיל-בניין)`;
  const CH = 400;
  for (let i = 0; i < flagged.length; i += CH) {
    const ids = flagged.slice(i, i + CH);
    await prisma.$executeRawUnsafe(
      `UPDATE nadlan_transactions SET excluded=1, exclusion_reason=? WHERE id IN (${ids.map(() => "?").join(",")})`,
      reason, ...ids);
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO admin_exclusion_log (action, affected, reason, created_at) VALUES ('exclude', ?, ?, datetime('now'))`,
    flagged.length, reason).catch(() => {});

  const p = rows.length ? (flagged.length / rows.length * 100).toFixed(1) : "0";
  console.log(`  flagged ${flagged.length.toLocaleString("en")} price anomalies (${p}%).`);
  for (const [c, n] of [...byCity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`    ${c}: ${n}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
