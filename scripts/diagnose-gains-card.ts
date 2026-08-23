#!/usr/bin/env tsx
/**
 * Why is "שינויי מחיר — לבחירתך" empty, and do its numbers match the city chart?
 *
 * The card renders from a compact per-city series the home page ships to the
 * browser. Between the stats table and that series sit three filters — a room
 * bucket, a sample floor, and ranking eligibility — and the card itself adds a
 * fourth (|Δ| ≤ 120%). Any one of them emptying the board produces the same
 * single sentence on screen, so the only way to know which is to count the
 * survivors at each step against the live database.
 *
 * It also reconciles the card against the city page's chart for a few cities,
 * because "the numbers should match the graph" is a separate question from
 * "the numbers exist" and the two have different answers.
 *
 * Run: npx tsx scripts/diagnose-gains-card.ts [fromYear] [toYear]
 */
import { prisma } from "../lib/db";
import { loadRankingEligibleCities, loadThinSampleCities, priceRefYear } from "../lib/cityTransactionPrices";
import { historyFromYear } from "../lib/historyWindow";
import { getRuleNum, getRuleBool } from "../lib/systemRules";

const SCOPES = ["secondhand", "new", "all"] as const;

async function main() {
  const fromY = Number(process.argv[2] ?? 2022);
  const toY = Number(process.argv[3] ?? 2025);

  console.log(`אבחון כרטיס "שינויי מחיר" · ${fromY}→${toY}\n`);
  // Said out loud because a clean report from this script was read, more than
  // once, as proof that the live card was fine — and it is not evidence of
  // that. Running outside the Next runtime, lib/cache.ts deliberately bypasses
  // unstable_cache here (see the "incrementalCache missing" branch), so every
  // number below comes straight from the database. The card on the site reads
  // the SAME data through a six-hour cache, and a poisoned cache produces an
  // empty board while everything printed here looks perfect.
  console.log(
    "⚠ הסקריפט הזה עוקף את הקאש (הוא רץ מחוץ ל-Next) ולכן מודד את המאגר בלבד.\n" +
    "  ״תקין״ כאן אינו ״תקין באתר״ — לבדיקה דרך הקאש: scripts/probe-home-board.ts\n"
  );
  console.log(`כללים: ranking_min_per_scope=${getRuleNum("ranking_min_per_scope")} · ` +
    `city_min_total_deals=${getRuleNum("city_min_total_deals", 150)} · ` +
    `ranking_normalization_on=${getRuleBool("ranking_normalization_on", true)} · ` +
    `ref_year=${priceRefYear()} · history_from=${historyFromYear()}`);

  // ── step 1: the raw rows the home page reads ──
  const rows = await prisma.$queryRawUnsafe<
    Array<{ city_name: string; scope: string; year: number; avg_sqm: number | null; median_sqm: number | null }>
  >(
    `SELECT city_name, scope, year, avg_sqm, median_sqm FROM nadlan_year_room_stats
      WHERE room_bucket='all' AND year >= ${historyFromYear()} AND n >= 10`
  );
  const citiesRaw = new Set(rows.map((r) => r.city_name));
  console.log(`\n[1] שורות גולמיות (room_bucket=all, n≥10): ${rows.length} · ${citiesRaw.size} ערים`);

  // ── step 2: the eligibility gate ──
  const thin = await loadThinSampleCities();
  const eligible = await loadRankingEligibleCities();
  console.log(`[2] מדגם דל: ${thin.size} ערים · כשירות לדירוג: ${eligible.size} ערים`);
  if (eligible.size === 0) {
    console.log("    ⚠ אף עיר לא כשירה — זו לבדה מרוקנת את הכרטיס לחלוטין.");
    const probe = await prisma.$queryRawUnsafe<Array<{ city_name: string; scopes: number }>>(
      `SELECT city_name, COUNT(DISTINCT scope) scopes FROM nadlan_year_room_stats
        WHERE room_bucket='all' AND scope IN ('all','secondhand','new')
          AND year IN (?, ?) AND n >= ?
        GROUP BY city_name ORDER BY scopes DESC LIMIT 5`,
      priceRefYear(), priceRefYear() - 1, getRuleNum("ranking_min_per_scope")
    );
    console.log(`    שאילתת הכשירות מחזירה ${probe.length} שורות לפני HAVING=3:`,
      probe.map((p) => `${p.city_name}:${p.scopes}`).join(", ") || "(כלום)");
  }

  // ── step 3: the series the card actually receives ──
  const series: Record<string, Record<string, Record<number, [number, number]>>> = {};
  let dropped = 0;
  for (const r of rows) {
    if (r.avg_sqm == null || r.median_sqm == null) continue;
    if (!eligible.has(r.city_name)) { dropped++; continue; }
    ((series[r.city_name] ??= {})[r.scope] ??= {})[Number(r.year)] =
      [Math.round(Number(r.avg_sqm)), Math.round(Number(r.median_sqm))];
  }
  console.log(`[3] אחרי סינון כשירות: ${Object.keys(series).length} ערים (${dropped} שורות נזרקו)`);

  // ── step 4: per scope, how many cities have BOTH endpoints ──
  console.log(`\n[4] ערים עם שתי נקודות קצה (${fromY} ו-${toY}):`);
  for (const scope of SCOPES) {
    const withBoth = Object.entries(series).filter(
      ([, sc]) => sc[scope]?.[fromY] && sc[scope]?.[toY]
    );
    const items = withBoth
      .map(([city, sc]) => ({ city, pct: (sc[scope][toY][0] / sc[scope][fromY][0] - 1) * 100 }))
      .filter((i) => Number.isFinite(i.pct) && Math.abs(i.pct) <= 120)
      .sort((a, b) => b.pct - a.pct);
    console.log(`  ${scope.padEnd(11)} ${String(withBoth.length).padStart(4)} ערים · ` +
      `${items.length} עוברות את סף ±120%`);
    for (const it of items.slice(0, 5)) {
      const sc = series[it.city][scope];
      console.log(`      ${it.city}: ${sc[fromY][0].toLocaleString("he-IL")} → ` +
        `${sc[toY][0].toLocaleString("he-IL")} ₪/מ״ר  (${it.pct >= 0 ? "+" : ""}${it.pct.toFixed(1)}%)`);
    }
    if (!withBoth.length) {
      // Which endpoint is missing matters: a missing START is a coverage
      // problem, a missing END is a pipeline problem.
      const hasFrom = Object.values(series).filter((sc) => sc[scope]?.[fromY]).length;
      const hasTo = Object.values(series).filter((sc) => sc[scope]?.[toY]).length;
      console.log(`      ⚠ ${hasFrom} ערים עם ${fromY} · ${hasTo} ערים עם ${toY}`);
      const years = new Set<number>();
      for (const sc of Object.values(series)) for (const y of Object.keys(sc[scope] ?? {})) years.add(Number(y));
      console.log(`      שנים זמינות ב-${scope}: ${[...years].sort((a, b) => a - b).join(", ") || "(אין)"}`);
    }
  }

  // ── step 5: does the card agree with the city page's chart? ──
  // Both read nadlan_year_room_stats, but the chart's HEADLINE second-hand
  // series is the mix-adjusted one (secondhand_fixedmix), a different number by
  // construction. Printing them side by side is the only honest way to say
  // whether a mismatch is a bug or two different statistics.
  console.log(`\n[5] הכרטיס מול הגרף בעמוד העיר (${toY}, ₪/מ״ר):`);
  const sample = Object.keys(series).slice(0, 6);
  for (const city of sample) {
    const fx = await prisma.$queryRawUnsafe<Array<{ median_sqm: number | null; n: number }>>(
      `SELECT median_sqm, n FROM nadlan_year_room_stats
        WHERE city_name=? AND room_bucket='all' AND scope='secondhand_fixedmix' AND year=?`,
      city, toY
    );
    const sh = series[city].secondhand?.[toY];
    console.log(
      `  ${city}: כרטיס יד-2 ממוצע ${sh ? sh[0].toLocaleString("he-IL") : "—"} · ` +
      `חציון ${sh ? sh[1].toLocaleString("he-IL") : "—"} · ` +
      `גרף מתוקנן-הרכב ${fx[0]?.median_sqm != null ? Math.round(Number(fx[0].median_sqm)).toLocaleString("he-IL") : "—"}`
    );
  }
  console.log("\nהערה: 'מתוקנן-הרכב' הוא סדרה אחרת במכוון (סל קבוע), ולכן פער מולו אינו באג.");
}

main().catch((e) => { console.error(e); process.exit(1); });
