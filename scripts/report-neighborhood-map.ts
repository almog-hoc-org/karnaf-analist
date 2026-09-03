#!/usr/bin/env tsx
/**
 * Does the neighbourhood map actually cover the city it claims to?
 *
 * THE NUMBER THAT MATTERS IS THE JOIN RATE. Shapes come from OpenStreetMap,
 * keyed by its `name`; prices come from the Tax Authority, keyed by its own
 * spelling of the same place. A collector that "succeeded" and a map that shows
 * four of a city's twenty neighbourhoods are the same run. This prints both
 * sides of the join and, crucially, the names that did NOT match — because
 * those are the actionable output: each one is either an alias to add or a
 * neighbourhood OSM does not have.
 *
 * For תל אביב-יפו it also measures against a real expectation list: the ~40
 * neighbourhood names curated by hand in lib/city-subareas.ts. No other city
 * has one, which is why Tel Aviv is the pilot.
 *
 *   npx tsx scripts/report-neighborhood-map.ts [--city "תל אביב-יפו"]
 */
import { prisma } from "../lib/db";
import { normHoodKey } from "../lib/hoodKey";
import { neighborhoodSummary } from "../lib/neighborhoods";
import { buildCityMap, mapMinNeighborhoods, mapMinMatchRatio } from "../lib/cityMap";
import { getSubareas } from "../lib/city-subareas";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function citiesWithShapes(): Promise<string[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ city_name: string }>>(
      `SELECT DISTINCT city_name FROM neighborhood_shapes ORDER BY city_name`
    );
    return rows.map((r) => r.city_name);
  } catch {
    return [];
  }
}

async function reportCity(city: string): Promise<void> {
  const [shapesRows, summary] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ neighborhood: string; norm_name: string; path_d: string; cx: number; cy: number; source: string | null }>>(
      `SELECT neighborhood, norm_name, path_d, cx, cy, source FROM neighborhood_shapes WHERE city_name = ?`, city
    ).catch(() => []),
    neighborhoodSummary(city, { scope: "secondhand", years: 3 }),
  ]);
  const lines = await prisma.$queryRawUnsafe<Array<{ kind: string; rank: number; name: string | null; path_d: string; length: number }>>(
    `SELECT kind, rank, name, path_d, length FROM city_map_lines WHERE city_name = ?`, city
  ).catch(() => []);

  const geometry = {
    shapes: shapesRows.map((r) => ({
      neighborhood: r.neighborhood, normName: r.norm_name, path: r.path_d,
      cx: Number(r.cx ?? 0), cy: Number(r.cy ?? 0),
    })),
    lines: lines.map((l) => ({
      kind: l.kind as "road" | "water" | "coast", rank: Number(l.rank),
      name: l.name, path: l.path_d, length: Number(l.length ?? 0),
    })),
    bbox: null,
  };

  const view = buildCityMap(geometry, summary.rows);
  const bytes = Buffer.byteLength(
    JSON.stringify([geometry.shapes.map((s) => s.path), geometry.lines.map((l) => l.path)]), "utf8"
  );
  const fixture = shapesRows.some((r) => r.source === "fixture");

  console.log(`\n── ${city} ──${fixture ? "  ⚠ פיקסצ׳ר פיתוח, לא נתוני OSM" : ""}`);
  console.log(`  צורות: ${geometry.shapes.length} · קווים: ${geometry.lines.length} (${geometry.lines.filter((l) => l.kind === "road").length} כבישים)`);
  console.log(`  שכונות מתומחרות: ${summary.rows.length}`);
  console.log(`  משקל הגיאומטריה: ${(bytes / 1024).toFixed(0)}KB${bytes > 150 * 1024 ? "  ⚠ מעל היעד" : ""}`);

  if (!view) {
    console.log(`  ✗ המפה לא תוצג — סף: ${mapMinNeighborhoods()} שכונות ו-${Math.round(mapMinMatchRatio() * 100)}% התאמה`);
  } else {
    const pct = summary.rows.length ? Math.round((view.matched / summary.rows.length) * 100) : 0;
    console.log(`  ✓ המפה תוצג · הותאמו ${view.matched}/${summary.rows.length} (${pct}%)`);
    const shapeOnly = view.neighborhoods.filter((n) => !n.summary).map((n) => n.neighborhood);
    if (shapeOnly.length) console.log(`  צורה בלי מחיר (${shapeOnly.length}): ${shapeOnly.slice(0, 15).join(" · ")}`);
    if (view.unmatchedPriced.length) console.log(`  מחיר בלי צורה (${view.unmatchedPriced.length}): ${view.unmatchedPriced.slice(0, 15).join(" · ")}`);
  }

  // The curated expectation list, where one exists.
  const curated = getSubareas(city).flatMap((a) => a.patterns);
  if (curated.length) {
    const haveKeys = new Set(geometry.shapes.map((s) => s.normName));
    const missing = curated.filter((p) => ![...haveKeys].some((k) => k.includes(normHoodKey(p)) || normHoodKey(p).includes(k)));
    console.log(`  מול הרשימה המתוחזקת ידנית: ${curated.length - missing.length}/${curated.length} נמצאו`);
    if (missing.length) console.log(`  חסרות ב-OSM: ${missing.slice(0, 20).join(" · ")}`);
  }
}

async function main(): Promise<number> {
  const only = arg("city");
  const cities = only ? [only] : await citiesWithShapes();
  if (cities.length === 0) {
    console.log("אין ערים עם גיאומטריה שנאספה — הרץ scripts/collect-city-map.ts");
    return 0;
  }
  for (const c of cities) await reportCity(c);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });

export {};
