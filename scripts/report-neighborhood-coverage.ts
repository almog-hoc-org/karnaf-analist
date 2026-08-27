#!/usr/bin/env tsx
/**
 * How much of the deal repository actually carries a neighbourhood and a
 * street — per city, per source.
 *
 * WHY THIS RUNS BEFORE ANY FIX. Three writers put deals into
 * nadlan_transactions and they disagree about what a row carries: the nightly
 * nadlan collector drops the neighbourhood it already parsed, the historical
 * backfill keeps it, and govmap keeps neighbourhood+street but its prices are
 * banned from the stats. The result cannot be reasoned about from the code —
 * production coverage depends on which cities were filled by which writer in
 * which order. This prints the actual state, so the enrichment work
 * (collector fix + cross-channel fact-copy) can be measured as before/after
 * instead of assumed.
 *
 * Report only: reads, prints, changes nothing.
 *
 *   npx tsx scripts/report-neighborhood-coverage.ts [--city "תל אביב-יפו"]
 */
import { prisma } from "../lib/db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Row {
  city_name: string;
  source: string | null;
  n: number;
  with_nb: number;
  with_street: number;
  with_house: number;
  hoods: number;
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

async function main(): Promise<number> {
  const onlyCity = arg("city");
  const where = onlyCity ? "WHERE city_name = ?" : "";
  const args = onlyCity ? [onlyCity] : [];

  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT city_name,
            COALESCE(source,'nadlan') source,
            COUNT(*) n,
            SUM(CASE WHEN neighborhood IS NOT NULL AND neighborhood != '' THEN 1 ELSE 0 END) with_nb,
            SUM(CASE WHEN street IS NOT NULL AND street != '' THEN 1 ELSE 0 END) with_street,
            SUM(CASE WHEN house_num IS NOT NULL AND house_num != '' THEN 1 ELSE 0 END) with_house,
            COUNT(DISTINCT neighborhood) hoods
       FROM nadlan_transactions ${where}
      GROUP BY city_name, COALESCE(source,'nadlan')
      ORDER BY n DESC`,
    ...args
  );

  if (!rows.length) {
    console.log("אין עסקאות במאגר — אין מה למדוד.");
    return 0;
  }

  // Per-city rollup across sources — the number the neighbourhood pages live on.
  const byCity = new Map<string, { n: number; with_nb: number; with_street: number; hoods: Set<string> }>();
  for (const r of rows) {
    const c = byCity.get(r.city_name) ?? { n: 0, with_nb: 0, with_street: 0, hoods: new Set<string>() };
    c.n += Number(r.n); c.with_nb += Number(r.with_nb); c.with_street += Number(r.with_street);
    byCity.set(r.city_name, c);
  }

  console.log("── כיסוי שכונה ורחוב, פר עיר ופר מקור ──");
  let curCity = "";
  for (const r of rows) {
    if (r.city_name !== curCity) {
      curCity = r.city_name;
      const c = byCity.get(curCity)!;
      console.log(`\n${curCity} — סה״כ ${Number(c.n).toLocaleString("he-IL")} עסקאות · שכונה ${pct(c.with_nb, c.n)} · רחוב ${pct(c.with_street, c.n)}`);
    }
    console.log(
      `    ${String(r.source).padEnd(8)} n=${String(Number(r.n)).padStart(7)} · שכונה ${pct(Number(r.with_nb), Number(r.n)).padStart(4)} · רחוב ${pct(Number(r.with_street), Number(r.n)).padStart(4)} · מס׳ בית ${pct(Number(r.with_house), Number(r.n)).padStart(4)} · שכונות ייחודיות ${r.hoods}`
    );
  }

  // The number that decides how many neighbourhood pages exist at all.
  const cells = await prisma.$queryRawUnsafe<Array<{ city_name: string; hoods: number }>>(
    `SELECT city_name, COUNT(DISTINCT neighborhood) hoods
       FROM neighborhood_year_stats ${onlyCity ? "WHERE city_name = ?" : ""}
      GROUP BY city_name ORDER BY hoods DESC`,
    ...args
  ).catch(() => []);
  console.log(`\n── שכונות עם תאים מפורסמים (עוברות את רף המדגם) ──`);
  if (!cells.length) console.log("  אין — האגרגציה טרם כתבה תאי שכונה.");
  for (const c of cells.slice(0, 25)) console.log(`  ${c.city_name}: ${c.hoods}`);
  if (cells.length > 25) console.log(`  … ועוד ${cells.length - 25} ערים`);

  const totalN = [...byCity.values()].reduce((s, c) => s + c.n, 0);
  const totalNb = [...byCity.values()].reduce((s, c) => s + c.with_nb, 0);
  const totalSt = [...byCity.values()].reduce((s, c) => s + c.with_street, 0);
  console.log(`\nסה״כ מאגר: ${totalN.toLocaleString("he-IL")} עסקאות · שכונה ${pct(totalNb, totalN)} · רחוב ${pct(totalSt, totalN)}`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
