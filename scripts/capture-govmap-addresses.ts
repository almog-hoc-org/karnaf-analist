#!/usr/bin/env tsx
/**
 * THE MAC HALF of the address campaign — network only, no database.
 *
 * WHY IT EXISTS. The backfill (scripts/backfill-govmap-addresses.ts) needs
 * two things at once: govmap answering, and the LIVE database on local disk.
 * No single machine has both — govmap answers 403 to the VPS (measured
 * 8/2026), and the Mac in Israel does not hold the live DB. So the campaign
 * splits: THIS script runs where govmap answers and captures each city's
 * deal feed into a JSON file; the backfill's existing --from-file mode
 * applies it on the server, where the DB lives. scripts/push-addresses.sh
 * drives both halves as one command.
 *
 * Reuses lib/govmapDeals.ts verbatim — same endpoints, same polite pace,
 * same geo-block detection as every other govmap consumer.
 *
 * Usage:
 *   npx tsx scripts/capture-govmap-addresses.ts "תל אביב-יפו" [...cities]
 *   npx tsx scripts/capture-govmap-addresses.ts --out=data/govmap_addr "חיפה"
 *
 * Output: <out>/<sanitized-city>.json — the raw GovmapRawDeal[] the backfill
 * expects. An existing file is skipped (resume-friendly) unless --force.
 */
import fs from "fs";
import path from "path";
import { fetchCityDeals, govmapWindows, isGeoBlockError } from "../lib/govmapDeals";

const START_DATE = process.env.KARNAF_COLLECT_FROM || "2016-01";
const WINDOWS = govmapWindows(START_DATE);

/** Filesystem-safe name: Hebrew stays, quotes/slashes/spaces do not. */
export function cityFileName(city: string): string {
  return city.replace(/[^֐-׿A-Za-z0-9-]+/g, "_");
}

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const outDir = argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "data/govmap_addr";
  const cities = argv.filter((a) => !a.startsWith("--"));
  if (!cities.length) {
    console.error("שימוש: capture-govmap-addresses.ts <עיר> [...ערים] [--out=dir] [--force]");
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });

  let ok = 0, skipped = 0, empty = 0;
  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    const file = path.join(outDir, `${cityFileName(city)}.json`);
    const tag = `[${i + 1}/${cities.length}] ${city}`;
    if (!force && fs.existsSync(file)) { console.log(`${tag}: קיים — מדלג`); skipped++; continue; }
    const t0 = Date.now();
    try {
      const deals = await fetchCityDeals(city, WINDOWS);
      if (!deals.length) { console.log(`${tag}: ריק`); empty++; continue; }
      // atomic-ish: write to tmp then rename, so a killed run never leaves a
      // half-file that a later resume would trust
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(deals));
      fs.renameSync(`${file}.tmp`, file);
      const withStreet = deals.filter((d) => d.streetNameHeb?.trim()).length;
      console.log(`${tag}: ${deals.length.toLocaleString("en")} עסקאות (${withStreet.toLocaleString("en")} עם רחוב) → ${file} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      ok++;
    } catch (e) {
      if (isGeoBlockError(e)) {
        console.error(`${tag}: ${e instanceof Error ? e.message : e}`);
        console.error("⛔ govmap חסום מהמכונה הזו — הסקריפט הזה חייב לרוץ מסביבה ישראלית.");
        process.exit(1);
      }
      console.error(`${tag}: שגיאה — ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`\n--- נלכדו ${ok} ערים, ${skipped} דולגו, ${empty} ריקות ---`);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
