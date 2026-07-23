#!/usr/bin/env tsx
/**
 * Aggregate nadlan_transactions → nadlan_year_room_stats, per
 * city × year × room_bucket("3"|"4"|"5"|"all") × scope("all"|"secondhand"|"new"):
 * avg/median price + avg/median ₪/m² + n. Sanity-bounded (₪/m² 2k–200k, area 20–500).
 *
 * Source-aware:
 *   - scope "all"        ← govmap rows (רשות המסים, broad 2015→now); nadlan fallback if none.
 *   - scope "secondhand" ← nadlan rows, dealYear − yearBuilt ≥ 3.
 *   - scope "new"        ← nadlan rows, has build year AND not second-hand.
 * (govmap has no build year, so second-hand/new come only from the nadlan build-year rows.)
 */
import { prisma } from "../lib/db";

const MIN_SQM = 2_000, MAX_SQM = 200_000, MIN_AREA = 20, MAX_AREA = 500;

interface Row { city_name: string; deal_year: number; room_bucket: string; price: number | null; price_sqm: number | null; is_secondhand: number; year_built: number | null; source: string; }

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
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT city_name, deal_year, room_bucket, price, price_sqm, is_secondhand, year_built, source
     FROM nadlan_transactions
     WHERE price_sqm >= ${MIN_SQM} AND price_sqm <= ${MAX_SQM} AND area >= ${MIN_AREA} AND area <= ${MAX_AREA}`
  );
  console.log(`aggregating ${rows.length} sane transactions…`);

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

  for (const [city, { govmap, nadlan }] of byCity) {
    const allRows = govmap.length ? govmap : nadlan; // broad source for "all"
    const allByYear = byYear(allRows);
    const nadByYear = byYear(nadlan);
    const years = new Set<number>([...allByYear.keys(), ...nadByYear.keys()]);
    for (const year of years) {
      const allY = allByYear.get(year) ?? [];
      const nadY = nadByYear.get(year) ?? [];
      for (const bucket of ["3", "4", "5", "all"]) {
        const a = inBucket(allY, bucket);
        if (a.length) out.push({ city, year, bucket, scope: "all", s: stat(a) });
        const nb = inBucket(nadY, bucket);
        const sh = nb.filter((r) => r.is_secondhand === 1);
        if (sh.length) out.push({ city, year, bucket, scope: "secondhand", s: stat(sh) });
        const nw = nb.filter((r) => r.is_secondhand === 0 && (r.year_built ?? 0) > 0);
        if (nw.length) out.push({ city, year, bucket, scope: "new", s: stat(nw) });
      }
    }
  }

  await prisma.$executeRawUnsafe("DELETE FROM nadlan_year_room_stats");
  const COLS = "city_name,year,room_bucket,scope,avg_price,median_price,avg_sqm,median_sqm,n";
  const CHUNK = 60;
  for (let i = 0; i < out.length; i += CHUNK) {
    const slice = out.slice(i, i + CHUNK);
    const vs = slice.map(() => "(?,?,?,?,?,?,?,?,?)").join(",");
    const params: unknown[] = [];
    for (const o of slice) params.push(o.city, o.year, o.bucket, o.scope, o.s.avg_price, o.s.median_price, o.s.avg_sqm, o.s.median_sqm, o.s.n);
    await prisma.$executeRawUnsafe(`INSERT INTO nadlan_year_room_stats (${COLS}) VALUES ${vs}`, ...params);
  }
  console.log(`wrote ${out.length} stat rows across ${byCity.size} cities.`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
