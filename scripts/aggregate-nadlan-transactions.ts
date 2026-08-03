#!/usr/bin/env tsx
/**
 * Aggregate nadlan_transactions → nadlan_year_room_stats, per
 * city × year × room_bucket("3"|"4"|"5"|"all") × scope("all"|"secondhand"|"new"):
 * avg/median price + avg/median ₪/m² + n. Sanity-bounded (₪/m² 2k–200k, area 20–500).
 *
 * Prices come from the NADLAN channel only (deduped). govmap is dropped from ALL
 * price stats: it is noisy/unreliable for price (TLV +30% vs the official median,
 * Haifa −10%) and is kept solely for street addresses in /deals.
 *   - scope "all"        ← nadlan rows (secondhand + new + unclassified) = a true union.
 *   - scope "secondhand" ← nadlan rows, dealYear − yearBuilt ≥ secondhand_min_age (4).
 *   - scope "new"        ← nadlan rows, has build year AND not second-hand.
 * Scope: last 10 years only.
 *
 * Two cleaning rules are enforced right here, at the choke point every price on
 * the site flows through: duplicate reports have already left via `excluded`,
 * and luxury deals are dropped by `COALESCE(luxury,0)=0` — they happened, so
 * they stay in the counts and the drill-down, but they do not set the average.
 */
import { getRuleNum } from "../lib/systemRules";
import { prisma } from "../lib/db";

// Sanity bounds are admin-editable (lib/systemRules) — defaults match the originals.
const MIN_SQM = getRuleNum("min_sqm_price", 2_000), MAX_SQM = getRuleNum("max_sqm_price", 200_000);
const MIN_AREA = getRuleNum("min_area", 20), MAX_AREA = getRuleNum("max_area", 500);
const MODERN_MIN = getRuleNum("modern_min_year", 2005); // second-hand: modern (≥) vs old building

interface Row { city_name: string; deal_year: number; room_bucket: string; price: number | null; price_sqm: number | null; is_secondhand: number; year_built: number | null; source: string; neighborhood: string | null; rooms_effective: number | null; class_source: string | null; }

function median(v: number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function stat(rows: Row[]) {
  const sqm = rows.map((r) => r.price_sqm!).filter((x) => x && x > 0);
  const price = rows.map((r) => r.price!).filter((x) => x && x > 0);
  return {
    avg_price: price.length ? price.reduce((s, v) => s + v, 0) / price.length : null,
    median_price: median(price),
    avg_sqm: sqm.length ? sqm.reduce((s, v) => s + v, 0) / sqm.length : null,
    median_sqm: median(sqm),
    n: rows.length,
  };
}
const inBucket = (rows: Row[], bucket: string) => (bucket === "all" ? rows : rows.filter((r) => r.room_bucket === bucket));

async function main() {
  const minYear = new Date().getFullYear() - 10; // last 10 years only
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT city_name, deal_year, room_bucket, price, price_sqm, is_secondhand, year_built, source, neighborhood, rooms_effective, class_source
     FROM nadlan_transactions
     WHERE price_sqm >= ${MIN_SQM} AND price_sqm <= ${MAX_SQM} AND area >= ${MIN_AREA} AND area <= ${MAX_AREA}
       AND COALESCE(excluded,0)=0 AND COALESCE(luxury,0)=0 AND deal_year >= ${minYear}`
  );
  console.log(`aggregating ${rows.length} sane transactions (last 10y, nadlan-priced)…`);

  // city -> { govmap: Row[], nadlan: Row[] }
  const byCity = new Map<string, { govmap: Row[]; nadlan: Row[] }>();
  for (const r of rows) {
    let c = byCity.get(r.city_name);
    if (!c) { c = { govmap: [], nadlan: [] }; byCity.set(r.city_name, c); }
    (r.source === "govmap" ? c.govmap : c.nadlan).push(r);
  }

  type Out = { city: string; year: number; bucket: string; scope: string; s: ReturnType<typeof stat> };
  const out: Out[] = [];
  const byYear = (arr: Row[]) => { const m = new Map<number, Row[]>(); for (const r of arr) { let a = m.get(r.deal_year); if (!a) { a = []; m.set(r.deal_year, a); } a.push(r); } return m; };

  // ── SOURCE CHOICE PER CITY (verified 2026-07-29) ─────────────────────────
  // govmap measures area ~9% larger than nadlan, so its ₪/m² sits ~10-14% LOWER.
  // Splicing the two inside one city's line produced phantom jumps of 40-94%
  // (Dimona +93.8%) — so we NEVER mix sources within a city. Instead: a city whose
  // nadlan coverage is thin uses govmap for the WHOLE decade (one source, no seam),
  // flagged so the UI can label it. Second-hand/new stay nadlan-only (need year_built).
  const GOV_MIN_DEALS = getRuleNum("govmap_only_min_deals", 30);
  const GOV_MIN_YEARS = getRuleNum("govmap_only_min_years", 8);
  const yearsWith = (rows: Row[], min: number) => {
    const c = new Map<number, number>();
    for (const r of rows) c.set(r.deal_year, (c.get(r.deal_year) ?? 0) + 1);
    return [...c.values()].filter((n) => n >= min).length;
  };
  const govmapOnlyCities = new Set<string>();
  for (const [city, { govmap, nadlan }] of byCity) {
    const gy = yearsWith(govmap, GOV_MIN_DEALS), ny = yearsWith(nadlan, GOV_MIN_DEALS);
    if (gy >= GOV_MIN_YEARS && gy > ny) govmapOnlyCities.add(city);
  }
  console.log(`  govmap-only "all" series for ${govmapOnlyCities.size} cities (thin nadlan coverage)`);

  for (const [city, { govmap, nadlan }] of byCity) {
    // "all" = one source for the whole decade — govmap where nadlan is too thin.
    //
    // In nadlan cities "all" takes CLASSIFIED deals only. The gate used to be
    // year_built>0, for a good reason: the no-build-year group is heavy with presale
    // marketing prices (TLV 2025: 28% of deals at ₪60.3K/m² — towers sold on paper),
    // and as an unlabelled lump it pushed "all" ABOVE both of its own subsets.
    //
    // The gate is now class_source, which is strictly wider and keeps that finding
    // intact: those presale deals are no longer unlabelled — the authority's own
    // Sale-Law flag identifies them as first-hand, so they land in "new" where they
    // belong instead of being discarded. Requiring a build year was also throwing
    // away 44% of Tirat Karmel's deals, leaving that city with no split at all and a
    // "trend" that only tracked which kind of flat happened to sell that year.
    // (scripts/classify-sale-channel.ts assigns class_source.)
    const allRows = govmapOnlyCities.has(city) ? govmap : nadlan.filter((r) => r.class_source != null);
    const allByYear = byYear(allRows);
    const nadByYear = byYear(nadlan);
    const years = new Set<number>([...allByYear.keys(), ...nadByYear.keys()]);
    for (const year of years) {
      const allY = allByYear.get(year) ?? [];
      const nadY = nadByYear.get(year) ?? [];
      for (const bucket of ["3", "4", "5", "all"]) {
        const a = inBucket(allY, bucket);
        // govmap-sourced cities need the higher per-year floor (their line is the only one)
        const minCell = govmapOnlyCities.has(city) ? GOV_MIN_DEALS : 1;
        if (a.length >= minCell) out.push({ city, year, bucket, scope: govmapOnlyCities.has(city) ? "all_govmap" : "all", s: stat(a) });
        const nb = inBucket(nadY, bucket);
        const sh = nb.filter((r) => r.is_secondhand === 1);
        if (sh.length) out.push({ city, year, bucket, scope: "secondhand", s: stat(sh) });
        // second-hand split by building age (user rule): modern (built ≥ MODERN_MIN) vs old
        const shModern = sh.filter((r) => (r.year_built ?? 0) >= MODERN_MIN);
        if (shModern.length) out.push({ city, year, bucket, scope: "secondhand_modern", s: stat(shModern) });
        const shOld = sh.filter((r) => (r.year_built ?? 0) > 0 && (r.year_built ?? 0) < MODERN_MIN);
        if (shOld.length) out.push({ city, year, bucket, scope: "secondhand_old", s: stat(shOld) });
        const nw = nb.filter((r) => r.is_secondhand === 0 && r.class_source != null);
        if (nw.length) out.push({ city, year, bucket, scope: "new", s: stat(nw) });
      }
    }

    // ── MIX-ADJUSTED second-hand series (scope "secondhand_fixedmix") ──────────
    // The raw median is inflated by SAMPLE-COMPOSITION drift (verified 2026-07-29:
    // TLV raw +12.3% 2022→2025 while repeat-sales says ~+3% and the official median
    // is flat — ~10 of the 12.3 points were mix, not price). Fix: a FIXED BASKET of
    // neighborhood×rooms cells — each year is the weighted mean of its cell medians
    // using the SAME all-period weights, so a shifting sample can't move the series.
    {
      const sh = nadlan.filter((r) => r.is_secondhand === 1 && r.neighborhood && (r.rooms_effective ?? 0) > 0 && r.price_sqm != null && r.price_sqm > 0);
      const cellOf = (r: Row) => `${r.neighborhood}|${Math.round(r.rooms_effective!)}`;
      const cellTotal = new Map<string, number>();
      for (const r of sh) cellTotal.set(cellOf(r), (cellTotal.get(cellOf(r)) ?? 0) + 1);
      // basket = cells with enough deals overall to have a stable median
      const basket = new Map([...cellTotal].filter(([, n]) => n >= 10));
      const totalW = [...basket.values()].reduce((s, v) => s + v, 0);
      if (totalW >= 100) {
        const byYearCell = new Map<number, Map<string, number[]>>();
        for (const r of sh) {
          const c = cellOf(r);
          if (!basket.has(c)) continue;
          let ym = byYearCell.get(r.deal_year); if (!ym) { ym = new Map(); byYearCell.set(r.deal_year, ym); }
          const a = ym.get(c); if (a) a.push(r.price_sqm!); else ym.set(c, [r.price_sqm!]);
        }
        for (const [year, ym] of byYearCell) {
          let wSum = 0, vSum = 0, nDeals = 0;
          for (const [c, vals] of ym) {
            if (vals.length < 3) continue; // cell too thin this year
            const w = basket.get(c)!;
            wSum += w; vSum += w * (median(vals) ?? 0); nDeals += vals.length;
          }
          // require the year to cover most of the basket, else the constant-mix promise breaks
          if (wSum / totalW >= 0.5 && vSum > 0) {
            const adj = vSum / wSum;
            out.push({ city, year, bucket: "all", scope: "secondhand_fixedmix", s: { avg_price: null, median_price: null, avg_sqm: adj, median_sqm: adj, n: nDeals } });
          }
        }
      }
    }
  }

  // ── publish ────────────────────────────────────────────────────────
  //
  // nadlan_year_room_stats is the table every price graph and price card on the
  // site reads. Rewriting it used to be: an unqualified DELETE, committed on its
  // own, followed by ~N/60 separately-committed INSERTs. Three problems, all of
  // which this block fixes:
  //
  //   1. Between the DELETE and the last INSERT the table was EMPTY, then
  //      partially filled, and every one of those states was visible. SQLite runs
  //      in WAL mode here, so readers are not blocked by the writer — they see
  //      the latest committed state, which is exactly what made the gap
  //      observable rather than serialised away. Visitors got "no data" pages and
  //      cities silently missing from rankings, with nothing logged.
  //   2. A failure mid-way left the table permanently truncated, with no
  //      rollback and no restore path — the old FATAL handler just exited.
  //   3. The DELETE had no WHERE, so it also destroyed rows outside the 10-year
  //      window that this run never re-inserts.
  //
  // Wrapping the whole rewrite in ONE transaction fixes all three: readers keep
  // seeing the previous snapshot until COMMIT, and any error rolls the entire
  // thing back to that same snapshot.
  const [prevRow] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    "SELECT COUNT(*) n FROM nadlan_year_room_stats"
  );
  const prevCount = Number(prevRow?.n ?? 0);

  // Delta gate. A run that produces far fewer rows than the last one is a
  // symptom — an upstream collection failure, a rule edit that excluded too
  // much, a half-finished pipeline — not something to publish and find out
  // about from a reader. Growth is always allowed; only a collapse blocks.
  const MAX_SHRINK_PCT = 2;
  if (prevCount > 0) {
    const shrinkPct = ((prevCount - out.length) / prevCount) * 100;
    if (shrinkPct > MAX_SHRINK_PCT) {
      console.error(
        `✗ REFUSING TO PUBLISH: ${out.length} rows vs ${prevCount} previously ` +
        `(${shrinkPct.toFixed(1)}% smaller, limit ${MAX_SHRINK_PCT}%).`
      );
      console.error("  The live table was NOT touched. Investigate before re-running.");
      console.error("  Override with --force once you know why the count dropped.");
      if (!process.argv.includes("--force")) {
        await prisma.$disconnect();
        process.exit(2); // distinct from a crash: the data is suspect, not the machine
      }
      console.error("  --force given; publishing anyway.");
    }
  }

  if (out.length === 0) {
    console.error("✗ REFUSING TO PUBLISH: aggregation produced zero rows. Live table untouched.");
    await prisma.$disconnect();
    process.exit(2);
  }

  const COLS = "city_name,year,room_bucket,scope,avg_price,median_price,avg_sqm,median_sqm,n";
  const CHUNK = 60;
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("DELETE FROM nadlan_year_room_stats");
      for (let i = 0; i < out.length; i += CHUNK) {
        const slice = out.slice(i, i + CHUNK);
        const vs = slice.map(() => "(?,?,?,?,?,?,?,?,?)").join(",");
        const params: unknown[] = [];
        for (const o of slice) params.push(o.city, o.year, o.bucket, o.scope, o.s.avg_price, o.s.median_price, o.s.avg_sqm, o.s.median_sqm, o.s.n);
        await tx.$executeRawUnsafe(`INSERT INTO nadlan_year_room_stats (${COLS}) VALUES ${vs}`, ...params);
      }
    },
    // Generous bounds: this is a bulk rewrite of the whole stats table, and the
    // defaults (5s) would abort it long before it finishes.
    { timeout: 20 * 60_000, maxWait: 60_000 }
  );

  const delta = prevCount ? ` (was ${prevCount}, ${out.length >= prevCount ? "+" : ""}${out.length - prevCount})` : "";

  // Report the cities that came OUT, not the ones that went in. byCity.size is
  // the input count and reads as coverage while being nothing of the sort: a
  // city whose every cohort fell below the minimum cell size contributes zero
  // rows and shows a visitor an empty page, yet was still counted here. The two
  // numbers differed by twenty on the first live run and nothing said so.
  const citiesOut = new Set(out.map((o) => o.city));
  console.log(`wrote ${out.length} stat rows across ${citiesOut.size} cities${delta}.`);

  const empty = [...byCity.keys()].filter((c) => !citiesOut.has(c));
  if (empty.length) {
    const shown = empty.slice(0, 12).join(", ");
    console.log(
      `  ${empty.length} cities had transactions but produced no stat rows ` +
      `(every cohort below the minimum): ${shown}${empty.length > 12 ? " …" : ""}`
    );
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
