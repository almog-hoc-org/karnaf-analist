#!/usr/bin/env tsx
/**
 * AUDIT: does every cached street-comparison neighbourhood belong to its city?
 *
 * THE BUG THIS CLEANS UP (operator report, 8/2026). The street-comparison
 * cache (data/deals_cache/*.json) was built by a govmap sweep with NO
 * settlement filter — a 7km radius around a small city's centre swallows its
 * big neighbour, so טירת כרמל's file held Haifa's אחוזה, נווה שאנן and
 * תל עמל as its own top "neighbourhoods". The fetch path is gated now
 * (lib/govNadlanService.ts), but the poisoned files keep serving until they
 * are either re-fetched from Israel or cleaned in place. This script is the
 * in-place clean — it needs no network, so it runs anywhere the files are.
 *
 * THE TEST: a cached neighbourhood name is looked up (via normHoodKey, the
 * spelling bridge) in neighborhood_year_stats — our own per-city hood
 * registry. A name that belongs to a DIFFERENT city and NOT to this one is
 * foreign and is dropped (--fix) or reported. A name our registry does not
 * know at all is kept — absence of evidence is not evidence of leakage.
 * "כל היישוב" (the whole-town fallback) is always kept.
 *
 * Usage:
 *   npx tsx scripts/verify-city-hoods.ts          # audit only, full report
 *   npx tsx scripts/verify-city-hoods.ts --fix    # rewrite poisoned files
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { normHoodKey } from "../lib/hoodKey";
import { normalizeCity } from "../lib/cityAliases";

const FIX = process.argv.includes("--fix");
const DATA_DIR = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data");
const CACHE_DIR = path.join(DATA_DIR, "deals_cache");

function main() {
  if (!fs.existsSync(CACHE_DIR)) {
    console.log(`אין ${CACHE_DIR} — אין מה לבקר.`);
    return;
  }

  // hood-name (normalised) → the cities whose registry claims it
  const owners = new Map<string, Set<string>>();
  try {
    const db = new Database(path.join(DATA_DIR, "realestate.db"), { readonly: true });
    const rows = db.prepare(
      "SELECT DISTINCT city_name, neighborhood FROM neighborhood_year_stats"
    ).all() as Array<{ city_name: string; neighborhood: string }>;
    db.close();
    for (const r of rows) {
      const k = normHoodKey(r.neighborhood);
      (owners.get(k) ?? owners.set(k, new Set()).get(k)!).add(normalizeCity(r.city_name));
    }
  } catch (e) {
    console.error("לא הצלחתי לקרוא את רישום השכונות — הביקורת דורשת את ה-DB:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
  console.log(`רישום השכונות: ${owners.size} שמות שכונה ייחודיים\n`);

  let filesTouched = 0, hoodsDropped = 0, hoodsKept = 0, hoodsUnknown = 0;
  const findings: string[] = [];

  for (const file of fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json")).sort()) {
    const full = path.join(CACHE_DIR, file);
    let data: { cityName?: string; neighborhoods?: Array<{ neighborhood: string; totalDeals?: number }>; totalDealsAnalyzed?: number };
    try { data = JSON.parse(fs.readFileSync(full, "utf8")); } catch { continue; }
    const city = normalizeCity(data.cityName ?? file.replace(/\.json$/, ""));
    if (!Array.isArray(data.neighborhoods)) continue;

    const kept: typeof data.neighborhoods = [];
    const dropped: Array<{ name: string; owner: string; deals: number }> = [];
    for (const nh of data.neighborhoods) {
      const name = nh.neighborhood ?? "";
      if (!name || name === "כל היישוב") { kept.push(nh); hoodsKept++; continue; }
      const own = owners.get(normHoodKey(name));
      if (!own) { kept.push(nh); hoodsUnknown++; continue; }
      if (own.has(city)) { kept.push(nh); hoodsKept++; continue; }
      dropped.push({ name, owner: [...own].join("/"), deals: nh.totalDeals ?? 0 });
      hoodsDropped++;
    }

    if (dropped.length) {
      findings.push(
        `✗ ${data.cityName ?? file}: ${dropped.map((d) => `"${d.name}" שייכת ל${d.owner} (${d.deals} עסקאות)`).join(" · ")}` +
        (kept.length ? ` — נשארו ${kept.length} שכונות` : " — לא נשארו שכונות, הפאנל יציג את מצב הריק")
      );
      if (FIX) {
        const droppedDeals = dropped.reduce((t, d) => t + d.deals, 0);
        data.neighborhoods = kept;
        if (typeof data.totalDealsAnalyzed === "number") {
          data.totalDealsAnalyzed = Math.max(0, data.totalDealsAnalyzed - droppedDeals);
        }
        fs.writeFileSync(full, JSON.stringify(data));
        filesTouched++;
      }
    }
  }

  if (findings.length) {
    console.log(`נמצאו ${findings.length} ערים עם שכונות זרות:\n`);
    for (const f of findings) console.log("  " + f);
  } else {
    console.log("✓ כל שכונה בכל קובץ מטמון שייכת לעיר שלה (או לא מוכרת לרישום).");
  }
  console.log(
    `\nסה״כ: ${hoodsKept} שכונות תקינות · ${hoodsUnknown} לא ברישום (נשמרו) · ${hoodsDropped} זרות` +
    (FIX ? ` · ${filesTouched} קבצים תוקנו` : findings.length ? " · הרץ עם --fix לתיקון" : "")
  );
  // exit 0 either way: in report mode the findings ARE the product, and in
  // fix mode the problem no longer exists once we printed it.
}
main();
