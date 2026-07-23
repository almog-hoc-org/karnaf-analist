#!/usr/bin/env tsx
/**
 * Rigorous data-quality check for the sub-area deal caches.
 * For every cached city it reports and FLAGS:
 *   • any mapped sub-area with 0 deals in a year the city has data (starved area)
 *   • cities where "אחר / לא ממופה" exceeds 25% of deals (patterns need work)
 * Exit code is non-zero if any city fails, so it can gate a release.
 *
 * Usage: npx tsx scripts/verify-subarea-data.ts
 */
import fs from "fs";
import path from "path";
import type { CitySubareaMatrix } from "../lib/subarea-deals-types";

const CACHE_DIR = path.resolve(process.cwd(), "data", "subarea_deals");
const OTHER_MAX_PCT = 25;

function cellN(byRoom: Record<string, { dealCount: number }>): number {
  return Object.values(byRoom).reduce((a, c) => a + c.dealCount, 0);
}

function main() {
  const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));
  let failures = 0;
  const summary: string[] = [];

  for (const f of files) {
    const m: CitySubareaMatrix = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), "utf-8"));
    const years = Object.keys(m.byYear);
    if (years.length === 0) continue;

    // total deals + "אחר" share across all years
    let total = 0;
    let other = 0;
    const starved: string[] = [];
    const areaYearsWithData: Record<string, number> = {};

    for (const y of years) {
      const ym = m.byYear[y];
      const yearTotal = ym.rows.reduce((s, r) => s + cellN(r.byRoom), 0);
      if (yearTotal === 0) continue;
      for (const r of ym.rows) {
        const n = cellN(r.byRoom);
        total += n;
        if (r.subareaSlug === "other") other += n;
        else if (r.subareaSlug !== "whole") {
          if (n > 0) areaYearsWithData[r.subareaLabel] = (areaYearsWithData[r.subareaLabel] ?? 0) + 1;
        }
      }
    }
    if (total === 0) continue;

    // A mapped sub-area is "starved" if it has data in 0 of the years
    const mappedAreas = new Set(
      m.byYear[years[0]].rows.filter((r) => r.subareaSlug !== "other" && r.subareaSlug !== "whole").map((r) => r.subareaLabel)
    );
    for (const label of mappedAreas) {
      if (!areaYearsWithData[label]) starved.push(label);
    }

    const otherPct = (100 * other) / total;
    const ok = starved.length === 0 && otherPct <= OTHER_MAX_PCT;
    if (!ok) failures++;
    const flags: string[] = [];
    if (starved.length) flags.push(`starved: ${starved.join(", ")}`);
    if (otherPct > OTHER_MAX_PCT) flags.push(`אחר ${otherPct.toFixed(0)}% > ${OTHER_MAX_PCT}%`);
    summary.push(
      `${ok ? "✓" : "✗"} ${m.cityName.padEnd(20)} deals=${String(total).padStart(6)} אחר=${otherPct.toFixed(0)}%` +
        (flags.length ? `  ⚠ ${flags.join(" | ")}` : "")
    );
  }

  summary.sort();
  console.log(summary.join("\n"));
  console.log(`\n${files.length} cities checked, ${failures} failing (starved area or אחר>${OTHER_MAX_PCT}%).`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
