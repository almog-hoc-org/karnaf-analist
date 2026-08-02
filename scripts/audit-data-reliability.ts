#!/usr/bin/env tsx
/**
 * Data-reliability audit for the transaction repository.
 *
 * The nadlan/govmap channels are SAMPLES, not the full population — so a
 * city-year ₪/m² can be distorted by sampling bias, a partial year, or a thin
 * sample. This audit flags every city × year × scope cell that fails a check,
 * so the UI can suppress hard failures and caveat soft ones (see the read layer
 * in lib/cityTransactionPrices.ts). Extends the OK/WARN/ERROR pattern of
 * scripts/audit_city.ts.
 *
 * Writes data/data-reliability.json:  { generatedAt, thresholds, summary,
 *   flags: { "<city>|<year>|<scope>": {level, reasons[]} }, cities: [...] }
 *
 * Run:  npx tsx scripts/audit-data-reliability.ts
 *       npx tsx scripts/audit-data-reliability.ts "תל אביב-יפו"   # one city, verbose
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import fs from "fs";
import path from "path";

const adapter = new PrismaBetterSqlite3({ url: path.resolve("./data/realestate.db") });
const prisma = new PrismaClient({ adapter });

// ── thresholds (tune here; surfaced in the JSON so the UI can show them) ──
const T = {
  MIN_N: 10,               // a year below this is not priced (hard)
  CROSS_SOURCE_PCT: 15,    // nadlan vs govmap avg gap → WARN
  YOY_PCT: 18,             // year-over-year ₪/m² jump → WARN (real markets rarely move this fast)
  PARTIAL_MIN_MONTHS: 11,  // a year with fewer distinct months = partial → hard-flag as "חלקית"
  SH_OVER_ALL_PCT: 25,     // second-hand avg exceeding "all" by more than this → WARN
  N_STABILITY: 0.35,       // a year's n below 35% of the city's median-year n → WARN (composition risk)
};

type Level = "OK" | "WARN" | "ERROR";
interface Cell { level: Level; reasons: string[] }

interface StatRow { city_name: string; year: number; scope: string; avg_sqm: number | null; median_sqm: number | null; n: number }
interface SrcRow { city_name: string; deal_year: number; source: string; avg_sqm: number; n: number }
interface MonthRow { city_name: string; deal_year: number; months: number }

const worse = (a: Level, b: Level): Level => (["OK", "WARN", "ERROR"].indexOf(a) >= ["OK", "WARN", "ERROR"].indexOf(b) ? a : b);

async function main() {
  const only = process.argv.slice(2).find((a) => !a.startsWith("--")) || null;
  const cityFilter = only ? "AND city_name = ?" : "";
  const args = only ? [only] : [];

  // per city×year×scope stats (room_bucket='all')
  const stats = await prisma.$queryRawUnsafe<StatRow[]>(
    `SELECT city_name, year, scope, avg_sqm, median_sqm, n FROM nadlan_year_room_stats
     WHERE room_bucket='all' AND scope IN ('all','secondhand','new') ${cityFilter} ORDER BY city_name, scope, year`,
    ...args
  );
  // per city×year×source avg (raw, sane-bounded) for cross-source check
  const src = await prisma.$queryRawUnsafe<SrcRow[]>(
    `SELECT city_name, deal_year, source, AVG(price_sqm) avg_sqm, COUNT(*) n FROM nadlan_transactions
     WHERE COALESCE(excluded,0)=0 AND price_sqm BETWEEN 2000 AND 200000 ${cityFilter}
     GROUP BY city_name, deal_year, source`,
    ...args
  );
  // months present per city×year (partial-year detection)
  const months = await prisma.$queryRawUnsafe<MonthRow[]>(
    `SELECT city_name, deal_year, COUNT(DISTINCT substr(deal_date,6,2)) months FROM nadlan_transactions
     WHERE COALESCE(excluded,0)=0 ${cityFilter} GROUP BY city_name, deal_year`,
    ...args
  );
  // duplicate check (global, natural key)
  const dupRows = await prisma.$queryRawUnsafe<{ extra: number }[]>(
    `SELECT COALESCE(SUM(c-1),0) extra FROM (
       SELECT COUNT(*) c FROM nadlan_transactions WHERE COALESCE(excluded,0)=0
       GROUP BY city_name, source, deal_date, price, area, rooms, year_built HAVING c>1)`
  );
  const duplicates = Number(dupRows[0]?.extra ?? 0);

  // index helpers
  const monthOf = new Map<string, number>();
  for (const m of months) monthOf.set(`${m.city_name}|${m.deal_year}`, Number(m.months));
  const srcOf = new Map<string, Map<string, { avg: number; n: number }>>(); // city|year -> {nadlan,govmap}
  for (const r of src) {
    const k = `${r.city_name}|${r.deal_year}`;
    if (!srcOf.has(k)) srcOf.set(k, new Map());
    srcOf.get(k)!.set(r.source, { avg: Number(r.avg_sqm), n: Number(r.n) });
  }
  // "all" scope value per city|year (for secondhand-vs-all coherence)
  const allOf = new Map<string, number>();
  for (const s of stats) if (s.scope === "all" && s.avg_sqm) allOf.set(`${s.city_name}|${s.year}`, Number(s.avg_sqm));

  const thisYear = new Date().getFullYear();
  const flags: Record<string, Cell> = {};
  const cityAgg = new Map<string, { ok: number; warn: number; error: number }>();

  // group stats by city+scope for YoY + n-stability
  const byCityScope = new Map<string, StatRow[]>();
  for (const s of stats) {
    const k = `${s.city_name}|${s.scope}`;
    if (!byCityScope.has(k)) byCityScope.set(k, []);
    byCityScope.get(k)!.push(s);
  }

  for (const [k, series] of byCityScope) {
    const [city, scope] = k.split("|");
    series.sort((a, b) => a.year - b.year);
    const ns = series.map((s) => Number(s.n)).filter((x) => x > 0).sort((a, b) => a - b);
    const medN = ns.length ? ns[Math.floor(ns.length / 2)] : 0;

    for (let i = 0; i < series.length; i++) {
      const s = series[i];
      const reasons: string[] = [];
      let level: Level = "OK";
      const n = Number(s.n);
      const cell = `${city}|${s.year}|${scope}`;

      // hard: sample too small
      if (n < T.MIN_N) { level = "ERROR"; reasons.push(`מדגם קטן (n=${n} < ${T.MIN_N})`); }

      // hard: partial year (current year, or any year missing months)
      const mo = monthOf.get(`${city}|${s.year}`) ?? 12;
      if (s.year >= thisYear && mo < T.PARTIAL_MIN_MONTHS) {
        level = worse(level, "ERROR"); reasons.push(`שנה חלקית (${mo} חודשים בלבד)`);
      }

      // soft: n instability vs the city's typical year
      if (medN > 0 && n < medN * T.N_STABILITY) {
        level = worse(level, "WARN"); reasons.push(`מדגם לא-יציב (n=${n} מול חציון ${medN})`);
      }

      // soft: YoY jump
      if (i > 0 && series[i - 1].avg_sqm && s.avg_sqm) {
        const prev = Number(series[i - 1].avg_sqm), cur = Number(s.avg_sqm);
        const yoy = Math.round(((cur / prev) - 1) * 100);
        if (Math.abs(yoy) > T.YOY_PCT) { level = worse(level, "WARN"); reasons.push(`קפיצת YoY חריגה (${yoy > 0 ? "+" : ""}${yoy}%)`); }
      }

      // soft: cross-source disagreement (only meaningful where both sources exist)
      const so = srcOf.get(`${city}|${s.year}`);
      const nad = so?.get("nadlan"), gov = so?.get("govmap");
      if (nad && gov && gov.avg > 0 && nad.n >= 20 && gov.n >= 20) {
        const gapPct = Math.round(Math.abs(nad.avg - gov.avg) / gov.avg * 100);
        if (gapPct > T.CROSS_SOURCE_PCT) {
          level = worse(level, "WARN");
          reasons.push(`פער בין מקורות ${gapPct}% (nadlan ₪${Math.round(nad.avg).toLocaleString("he-IL")} מול govmap ₪${Math.round(gov.avg).toLocaleString("he-IL")})`);
        }
      }

      // soft: secondhand exceeding "all" implausibly
      if (scope === "secondhand" && s.avg_sqm) {
        const allV = allOf.get(`${city}|${s.year}`);
        if (allV && Number(s.avg_sqm) > allV * (1 + T.SH_OVER_ALL_PCT / 100)) {
          level = worse(level, "WARN"); reasons.push(`יד-2 חורג מ"הכל" ב->${T.SH_OVER_ALL_PCT}%`);
        }
      }

      if (reasons.length) flags[cell] = { level, reasons };
      const agg = cityAgg.get(city) ?? { ok: 0, warn: 0, error: 0 };
      agg[level === "ERROR" ? "error" : level === "WARN" ? "warn" : "ok"]++;
      cityAgg.set(city, agg);
    }
  }

  const cities = [...cityAgg.entries()]
    .map(([city, a]) => ({ city, ...a, flagged: a.warn + a.error }))
    .sort((a, b) => b.error - a.error || b.warn - a.warn);

  const summary = {
    duplicates,
    cellsChecked: stats.length,
    flagged: Object.keys(flags).length,
    errors: Object.values(flags).filter((f) => f.level === "ERROR").length,
    warnings: Object.values(flags).filter((f) => f.level === "WARN").length,
    citiesWithFlags: cities.filter((c) => c.flagged > 0).length,
  };

  const outPath = path.resolve("./data/data-reliability.json");
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), thresholds: T, summary, cities, flags }, null, 1));

  console.log(`\n=== data-reliability audit ===`);
  console.log(`duplicates: ${duplicates}  ·  cells: ${summary.cellsChecked}  ·  flagged: ${summary.flagged} (${summary.errors} ERROR, ${summary.warnings} WARN)`);
  console.log(`cities with flags: ${summary.citiesWithFlags}\n`);
  console.log(`worst cities:`);
  for (const c of cities.slice(0, 8)) console.log(`  ${c.city}: ${c.error} ERROR, ${c.warn} WARN`);
  if (only) {
    console.log(`\nflags for ${only}:`);
    for (const [cell, f] of Object.entries(flags)) if (cell.startsWith(only + "|")) console.log(`  ${cell} [${f.level}]: ${f.reasons.join(" · ")}`);
  }
  console.log(`\nwrote ${outPath}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
