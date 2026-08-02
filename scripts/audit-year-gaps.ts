#!/usr/bin/env tsx
/**
 * Year-coverage gap audit — the "10 years in every city" campaign tracker.
 * For every city: which years 2016–2025 lack data (n≥10) in scope=all and
 * scope=secondhand. Writes data/coverage-gaps.json (feeds /admin + the
 * gap-fill collectors) and prints a prioritized summary.
 */
import { prisma } from "../lib/db";
import fs from "fs";
import path from "path";

const FROM_Y = 2016, TO_Y = 2025, MIN_N = 10;

export interface CityGaps {
  city: string;
  population: number;
  allMissing: number[];
  shMissing: number[];
  complete: boolean;
}

async function main() {
  const cities = await prisma.city.findMany({
    select: { city_name: true, population_2026: true },
    orderBy: { population_2026: "desc" },
  });
  const rows = await prisma.$queryRawUnsafe<Array<{ city_name: string; scope: string; year: number }>>(
    `SELECT city_name, scope, year FROM nadlan_year_room_stats
     WHERE room_bucket='all' AND scope IN ('all','secondhand')
       AND year BETWEEN ${FROM_Y} AND ${TO_Y} AND n >= ${MIN_N}`
  );
  const have = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = r.city_name;
    if (!have.has(k)) have.set(k, new Set());
    have.get(k)!.add(`${r.scope}:${r.year}`);
  }

  const out: CityGaps[] = [];
  for (const c of cities) {
    const h = have.get(c.city_name) ?? new Set();
    const allMissing: number[] = [];
    const shMissing: number[] = [];
    for (let y = FROM_Y; y <= TO_Y; y++) {
      if (!h.has(`all:${y}`)) allMissing.push(y);
      if (!h.has(`secondhand:${y}`)) shMissing.push(y);
    }
    out.push({
      city: c.city_name,
      population: c.population_2026 ?? 0,
      allMissing,
      shMissing,
      complete: allMissing.length === 0 && shMissing.length === 0,
    });
  }

  const gaps = out.filter((c) => !c.complete);
  const payload = {
    generatedAt: new Date().toISOString(),
    window: `${FROM_Y}-${TO_Y}`,
    minN: MIN_N,
    totalCities: out.length,
    completeCities: out.length - gaps.length,
    gaps: gaps.sort((a, b) => b.population - a.population),
  };
  fs.writeFileSync(path.join(process.cwd(), "data", "coverage-gaps.json"), JSON.stringify(payload, null, 1));

  console.log(`10-year coverage (${FROM_Y}–${TO_Y}, n≥${MIN_N}): ${payload.completeCities}/${out.length} cities complete`);
  console.log(`cities with scope=all gaps: ${gaps.filter((c) => c.allMissing.length).length}`);
  console.log(`cities with secondhand gaps: ${gaps.filter((c) => c.shMissing.length).length}`);
  for (const g of gaps.slice(0, 10)) {
    console.log(`  ${g.city}: all→[${g.allMissing.join(",") || "✓"}] sh→[${g.shMissing.join(",") || "✓"}]`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
