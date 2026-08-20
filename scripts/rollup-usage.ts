#!/usr/bin/env tsx
/**
 * Nightly usage roll-up — the raw event log condensed into daily counts.
 *
 * Runs BEFORE the retention sweep in the pipeline. See lib/usageRollup.ts for
 * why that ordering is not cosmetic: reversed, the first run past the raw
 * log's 90-day horizon would delete a day and then aggregate the hole.
 *
 * Default: yesterday only, which is the one whole day that exists.
 *
 *   npx tsx scripts/rollup-usage.ts                 yesterday
 *   npx tsx scripts/rollup-usage.ts --day=2026-08-19
 *   npx tsx scripts/rollup-usage.ts --backfill=30   the last 30 whole days
 *
 * --backfill exists for exactly one moment: the first deploy, where months of
 * log already exist and no aggregate does. It is idempotent, so running it
 * twice costs time and changes nothing.
 */
import { rollupDay, rollupCoverage, dayOffset } from "../lib/usageRollup";

const argv = process.argv.slice(2);
const val = (f: string) => argv.find((a) => a.startsWith(`--${f}=`))?.split("=")[1];

function main() {
  const day = val("day");
  const backfill = Number(val("backfill") ?? 0);

  if (day) {
    const r = rollupDay(day);
    console.log(`  ${r.day}: ${r.sessions} ביקורים · ${r.pages} עמודים · ${r.cities} ערים`);
  } else if (backfill > 0) {
    const n = Math.min(730, Math.floor(backfill));
    console.log(`  צבירה למפרע — ${n} ימים אחרונים`);
    let written = 0;
    for (let i = n; i >= 1; i--) {
      const d = rollupDay(dayOffset(i));
      if (d.sessions || d.pages) written++;
    }
    console.log(`  ${written} ימים עם תנועה מתוך ${n}`);
  } else {
    const r = rollupDay();
    console.log(`  ${r.day}: ${r.sessions} ביקורים · ${r.pages} עמודים · ${r.cities} ערים`);
  }

  const c = rollupCoverage();
  console.log(`  הצבירה מכסה ${c.days} ימים${c.first ? ` (${c.first} → ${c.last})` : ""}`);
}

main();
