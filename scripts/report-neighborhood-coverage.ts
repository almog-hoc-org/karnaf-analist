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
import fs from "fs";
import path from "path";
import { prisma } from "../lib/db";
import { addressKey, addressKeyString } from "../lib/addressKey";

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

  // ── geocode coverage: how many deals could be drawn as pins ──
  // Joined in JS over the distinct (street, house) pairs — a few seconds,
  // and the same normalisation the pin layer uses, so this number IS the
  // number the caption under the map will show.
  console.log(`\n── גיאוקוד: כמה מהעסקאות ניתנות למיקום על המפה ──`);
  const geoSummary: Array<{ city: string; deals: number; withStreet: number; addresses: number; houseLevel: number; streetLevel: number; placeable: number; recentDeals: number; recentPlaceable: number; hasMap: boolean }> = [];
  try {
    const mapi = await prisma.$queryRawUnsafe<Array<{ imported_at: string | null; rows_kept: number | null; package_title: string | null }>>(
      `SELECT imported_at, rows_kept, package_title FROM mapi_import_status WHERE id = 1`).catch(() => []);
    console.log(mapi[0]?.imported_at
      ? `  קובץ מפ״י: ${mapi[0].rows_kept?.toLocaleString("he-IL")} כתובות, יובא ${new Date(mapi[0].imported_at).toISOString().slice(0, 10)} (${mapi[0].package_title})`
      : "  קובץ מפ״י: טרם יובא (scripts/import-mapi-addresses.ts)");
    const pairs = await prisma.$queryRawUnsafe<Array<{ city_name: string; street: string; house_num: string | null; n: number }>>(
      `SELECT city_name, street, house_num, COUNT(*) n FROM nadlan_transactions
        WHERE street IS NOT NULL AND street != '' AND COALESCE(excluded,0) = 0 ${onlyCity ? "AND city_name = ?" : ""}
        GROUP BY city_name, street, house_num`, ...args);
    const geos = await prisma.$queryRawUnsafe<Array<{ city_name: string; street_norm: string; house_norm: string; level: string }>>(
      `SELECT city_name, street_norm, house_norm, level FROM address_geocodes WHERE level IN ('house','street') ${onlyCity ? "AND city_name = ?" : ""}`, ...args);
    const have = new Set(geos.map((g) => `${g.city_name}|${g.street_norm}|${g.house_norm}`));
    // Does the city have a drawn map at all? Without city_map_meta there is
    // nothing to put a pin on, however well its addresses are geocoded.
    const mapped = new Set((await prisma.$queryRawUnsafe<Array<{ city_name: string }>>(
      `SELECT city_name FROM city_map_meta`).catch(() => [])).map((r) => r.city_name));
    // The pins default to the last few years, and that is where the address
    // campaign reached — so the recent share is the one the caption under
    // the map will actually show. RECENT_FROM is the first year the nadlan
    // campaign's 60-month window covers in full.
    const RECENT_FROM = 2022;
    const recentDeals = new Map((await prisma.$queryRawUnsafe<Array<{ city_name: string; n: number }>>(
      `SELECT city_name, COUNT(*) n FROM nadlan_transactions WHERE deal_year >= ? AND COALESCE(excluded,0) = 0 ${onlyCity ? "AND city_name = ?" : ""} GROUP BY city_name`,
      RECENT_FROM, ...args)).map((r) => [r.city_name, Number(r.n)]));
    const recentPairs = await prisma.$queryRawUnsafe<Array<{ city_name: string; street: string; house_num: string | null; n: number }>>(
      `SELECT city_name, street, house_num, COUNT(*) n FROM nadlan_transactions
        WHERE deal_year >= ? AND street IS NOT NULL AND street != '' AND COALESCE(excluded,0) = 0 ${onlyCity ? "AND city_name = ?" : ""}
        GROUP BY city_name, street, house_num`, RECENT_FROM, ...args);
    const placeableOf = (p: { city_name: string; street: string; house_num: string | null; n: number }): "house" | "street" | null => {
      const k = addressKey(p.city_name, p.street, p.house_num);
      if (!k) return null;
      if (k.houseNorm && have.has(`${p.city_name}|${k.streetNorm}|${k.houseNorm}`)) return "house";
      if (have.has(`${p.city_name}|${k.streetNorm}|`)) return "street";
      return null;
    };
    const perCity = new Map<string, { deals: number; withStreet: number; addresses: Set<string>; houseLevel: number; streetLevel: number; recentPlaceable: number }>();
    for (const [city, c] of byCity) perCity.set(city, { deals: c.n, withStreet: c.with_street, addresses: new Set(), houseLevel: 0, streetLevel: 0, recentPlaceable: 0 });
    for (const p of pairs) {
      const k = addressKey(p.city_name, p.street, p.house_num);
      const c = perCity.get(p.city_name);
      if (!k || !c) continue;
      c.addresses.add(addressKeyString(k));
      const lvl = placeableOf(p);
      if (lvl === "house") c.houseLevel += Number(p.n);
      else if (lvl === "street") c.streetLevel += Number(p.n);
    }
    for (const p of recentPairs) {
      const c = perCity.get(p.city_name);
      if (c && placeableOf(p)) c.recentPlaceable += Number(p.n);
    }
    for (const [city, c] of perCity) {
      geoSummary.push({ city, deals: c.deals, withStreet: c.withStreet, addresses: c.addresses.size, houseLevel: c.houseLevel, streetLevel: c.streetLevel, placeable: c.houseLevel + c.streetLevel, recentDeals: recentDeals.get(city) ?? 0, recentPlaceable: c.recentPlaceable, hasMap: mapped.has(city) });
    }
    geoSummary.sort((a, b) => b.deals - a.deals);
    for (const g of geoSummary.slice(0, 30)) {
      console.log(`  ${g.city.padEnd(18)} מפה ${g.hasMap ? "✓" : "—"} · עסקאות ${String(g.deals).padStart(7)} · ברמת בית ${pct(g.houseLevel, g.deals).padStart(4)} · ברמת רחוב ${pct(g.streetLevel, g.deals).padStart(4)} · ניתנות למיקום ${pct(g.placeable, g.deals).padStart(4)} · מ-${RECENT_FROM}: ${pct(g.recentPlaceable, g.recentDeals).padStart(4)} מתוך ${String(g.recentDeals).padStart(6)}`);
    }
    if (geoSummary.length > 30) console.log(`  … ועוד ${geoSummary.length - 30} ערים`);
    const gs = geoSummary.reduce((s, g) => ({ deals: s.deals + g.deals, placeable: s.placeable + g.placeable, house: s.house + g.houseLevel, recent: s.recent + g.recentDeals, recentPlaceable: s.recentPlaceable + g.recentPlaceable }), { deals: 0, placeable: 0, house: 0, recent: 0, recentPlaceable: 0 });
    console.log(`  סה״כ: ברמת בית ${pct(gs.house, gs.deals)} · ניתנות למיקום ${pct(gs.placeable, gs.deals)} מכלל העסקאות · ${pct(gs.recentPlaceable, gs.recent)} מהעסקאות מ-${RECENT_FROM}`);
    const withMap = geoSummary.filter((g) => g.hasMap);
    const noMap = geoSummary.filter((g) => !g.hasMap);
    console.log(`  ערים עם מפה: ${withMap.length} מתוך ${geoSummary.length}${noMap.length ? ` · הגדולות בלי מפה: ${noMap.slice(0, 8).map((g) => g.city).join(", ")}` : ""}`);
    const noPins = withMap.filter((g) => g.recentDeals >= 200 && g.recentPlaceable / Math.max(1, g.recentDeals) < 0.3);
    if (noPins.length) console.log(`  מפה בלי מספיק נעצים (פחות מ-30% מהעסקאות מ-${RECENT_FROM} ניתנות למיקום): ${noPins.slice(0, 12).map((g) => `${g.city} ${pct(g.recentPlaceable, g.recentDeals)}`).join(" · ")}${noPins.length > 12 ? ` … ועוד ${noPins.length - 12}` : ""}`);
    const bySource = await prisma.$queryRawUnsafe<Array<{ source: string; level: string; c: number }>>(
      `SELECT source, level, COUNT(*) c FROM address_geocodes GROUP BY source, level ORDER BY source, level`).catch(() => []);
    if (bySource.length) console.log(`  שורות לפי מקור: ${bySource.map((r) => `${r.source}/${r.level} ${Number(r.c).toLocaleString("he-IL")}`).join(" · ")}`);
    const geoStatus = await prisma.$queryRawUnsafe<Array<{ status: string; c: number; house: number }>>(
      `SELECT status, COUNT(*) c, SUM(house_level) house FROM govmap_geocode_status GROUP BY status`).catch(() => []);
    if (geoStatus.length) console.log(`  שארית govmap: ${geoStatus.map((r) => `${r.status} ${r.c} ערים (${Number(r.house).toLocaleString("he-IL")} בתים)`).join(" · ")}`);
    // The nadlan address campaign (scripts/push-nadlan-addresses.sh): the
    // source of streets for the rows govmap never had.
    // `inserted` exists only once the --insert-new step ran somewhere; before that, fall back to the older shape
    const nadlanCampaign = await prisma.$queryRawUnsafe<Array<{ c: number; street: number; parcel: number; not_in_db: number; inserted: number | null; v2: number | null }>>(
      `SELECT COUNT(*) c, SUM(filled_street) street, SUM(filled_parcel) parcel, SUM(not_in_db) not_in_db,
              SUM(inserted) inserted, SUM(method_version = 'nadlan-addr-v2') v2
         FROM nadlan_address_backfill_status WHERE status = 'ok'`)
      .catch(() => prisma.$queryRawUnsafe<Array<{ c: number; street: number; parcel: number; not_in_db: number; inserted: number | null; v2: number | null }>>(
        `SELECT COUNT(*) c, SUM(filled_street) street, SUM(filled_parcel) parcel, SUM(not_in_db) not_in_db, NULL inserted, NULL v2
           FROM nadlan_address_backfill_status WHERE status = 'ok'`).catch(() => []));
    const nc = nadlanCampaign[0];
    console.log(nc && Number(nc.c) > 0
      ? `  קמפיין nadlan: ${nc.c} ערים · +${Number(nc.street).toLocaleString("he-IL")} רחובות · +${Number(nc.parcel).toLocaleString("he-IL")} גוש-חלקה · ${Number(nc.not_in_db).toLocaleString("he-IL")} עסקאות באתר שאינן במאגר${nc.v2 != null && Number(nc.v2) > 0 ? ` · +${Number(nc.inserted ?? 0).toLocaleString("he-IL")} הוכנסו (${nc.v2} ערים)` : " · הכנסה טרם רצה"}`
      : "  קמפיין nadlan: טרם רץ (scripts/push-nadlan-addresses.sh מהמק)");
  } catch (e) {
    console.log(`  (אין טבלת גיאוקוד עדיין — ${e instanceof Error ? e.message.split("\n")[0] : e})`);
  }
  if (process.argv.includes("--json")) {
    const out = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "geocode-coverage.json");
    fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), cities: geoSummary }, null, 1));
    console.log(`  → ${out}`);
  }

  const totalN = [...byCity.values()].reduce((s, c) => s + c.n, 0);
  const totalNb = [...byCity.values()].reduce((s, c) => s + c.with_nb, 0);
  const totalSt = [...byCity.values()].reduce((s, c) => s + c.with_street, 0);
  console.log(`\nסה״כ מאגר: ${totalN.toLocaleString("he-IL")} עסקאות · שכונה ${pct(totalNb, totalN)} · רחוב ${pct(totalSt, totalN)}`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
