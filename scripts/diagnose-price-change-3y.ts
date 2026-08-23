#!/usr/bin/env tsx
/**
 * Why the "שינוי 3 שנים" column in /cities is "—" for every city.
 *
 * THE CLAIM UNDER TEST
 * The column is computed by lib/price-changes.ts from `nadlan_price_trends` —
 * the OFFICIAL quarterly medians. That series is sparse: a city can have 2015,
 * 2020 and 2025 and nothing between. computeChange() then does
 *
 *     const start = years.find((y) => y >= end - win);
 *     if (start === undefined || start >= end) return null;
 *
 * which succeeds for win=5 (start=2020, end=2025) and returns null for win=3
 * (the first year >= 2022 IS 2025). That would explain, exactly, why the city
 * page shows a five-year change while the table's three-year column is empty
 * in every row.
 *
 * This script does not assume that. It counts it: per city, which years exist,
 * whether a 3-year and a 5-year window can be formed, and — for the proposed
 * replacement — whether the DENSE repository series (nadlan_year_room_stats,
 * scope="all", room_bucket="all") can form a 3-year window for the same city.
 *
 * Read the last three lines: they are the decision. If the official series
 * forms a 3-year window for almost no city and the repository series forms one
 * for most, the column's SOURCE is the bug, not its arithmetic.
 *
 * Runs against the live database inside the container:
 *   docker compose exec -T app npx tsx scripts/diagnose-price-change-3y.ts
 */
import { prisma } from "../lib/db";
import { refYear } from "../lib/refYear";

/** The exact window test from lib/price-changes.ts — copied, not imported, so
 *  this measures the rule as it is written there even if it is changed later. */
function canForm(years: number[], win: number, endCap: number): { ok: boolean; from?: number; to?: number } {
  const ys = years.filter((y) => y <= endCap).sort((a, b) => a - b);
  const end = ys[ys.length - 1];
  if (end === undefined) return { ok: false };
  const start = ys.find((y) => y >= end - win);
  if (start === undefined || start >= end) return { ok: false };
  if (start > end - win + 2) return { ok: false };
  return { ok: true, from: start, to: end };
}

const MIN_N = 10; // the same sample floor the repository columns already use

async function main(): Promise<number> {
  const endCap = refYear();
  console.log(`שנת ייחוס (endCap): ${endCap}`);

  // ── official quarterly medians ────────────────────────────────────────
  const official = await prisma.nadlan_price_trends.findMany({
    where: { median_price: { not: null, gt: 0 } },
    select: { city_name: true, year: true },
  });
  const offYears = new Map<string, Set<number>>();
  for (const r of official) {
    let s = offYears.get(r.city_name);
    if (!s) { s = new Set(); offYears.set(r.city_name, s); }
    s.add(r.year);
  }

  // ── the dense repository series proposed as the replacement ───────────
  const repo = await prisma.nadlan_year_room_stats.findMany({
    where: { room_bucket: "all", scope: "all", median_price: { not: null, gt: 0 }, n: { gte: MIN_N } },
    select: { city_name: true, year: true },
  });
  const repoYears = new Map<string, Set<number>>();
  for (const r of repo) {
    let s = repoYears.get(r.city_name);
    if (!s) { s = new Set(); repoYears.set(r.city_name, s); }
    s.add(r.year);
  }

  console.log(`ערים ב-nadlan_price_trends (רשמי): ${offYears.size}`);
  console.log(`ערים ב-nadlan_year_room_stats (מאגר עצמאי, n>=${MIN_N}): ${repoYears.size}`);

  let off3 = 0, off5 = 0, rep3 = 0;
  const sample: string[] = [];
  for (const [city, set] of offYears) {
    const ys = [...set];
    const a = canForm(ys, 3, endCap);
    const b = canForm(ys, 5, endCap);
    if (a.ok) off3++;
    if (b.ok) off5++;
    if (sample.length < 12) {
      sample.push(
        `  ${city.padEnd(18)} שנים: ${ys.sort((x, y) => x - y).join(",")}` +
        `  → 3ש׳: ${a.ok ? `${a.from}→${a.to}` : "אין"}  5ש׳: ${b.ok ? `${b.from}→${b.to}` : "אין"}`
      );
    }
  }
  for (const [, set] of repoYears) if (canForm([...set], 3, endCap).ok) rep3++;

  console.log("\nדוגמאות (12 ערים ראשונות בסדר המסד):");
  for (const line of sample) console.log(line);

  console.log("\n── ההכרעה ──");
  console.log(`מקור רשמי — ערים שאפשר להרכיב להן חלון 3 שנים: ${off3}/${offYears.size}`);
  console.log(`מקור רשמי — ערים שאפשר להרכיב להן חלון 5 שנים: ${off5}/${offYears.size}`);
  console.log(`מאגר עצמאי — ערים שאפשר להרכיב להן חלון 3 שנים: ${rep3}/${repoYears.size}`);
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => { console.error(e); process.exit(1); });
