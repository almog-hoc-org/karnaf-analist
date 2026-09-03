#!/usr/bin/env tsx
/**
 * THE NATIONAL ADDRESS FILE → address_geocodes. The bulk, free, surveyed
 * source of building coordinates: the Survey of Israel's register on
 * data.gov.il, ~half a million numbered addresses with coordinates.
 *
 * WHY THIS BEFORE ANY API. One download geocodes most of the country at
 * once, from the register itself, with nothing to rate-limit and nothing to
 * pay; the govmap residue pass (scripts/geocode-govmap-residue.ts) then only
 * has to ask about the addresses this file does not carry.
 *
 * DISCOVERED, NOT HARD-CODED. The resource id rots when the file is
 * re-uploaded, so the dataset is found at run time through CKAN
 * package_search (lib/collect-urban-renewal.ts precedent), every candidate
 * is PRINTED, and KARNAF_MAPI_RESOURCE_ID / KARNAF_MAPI_CSV_URL override
 * the choice when discovery picks wrong. The columns and the coordinate
 * system are recognised from the file (lib/mapiAddresses.ts), confirmed from
 * the values, and refused loudly when they disagree.
 *
 * NEVER DEGRADES A GEOCODE. Writes go through chooseGeocode: a house-level
 * row from this file replaces a street-level guess, never the reverse, and
 * an existing house-level row from a more trusted source stays.
 *
 * FAILS SOFT. An unreachable portal, an unrecognised file or a suspiciously
 * small one leaves address_geocodes untouched and exits 0 with a loud skip —
 * the collectors' contract. Skips entirely when the last import is younger
 * than KARNAF_MAPI_FRESH_DAYS (30), unless --force.
 *
 *   npx tsx scripts/import-mapi-addresses.ts [--dry-run] [--force] [--file=path.csv]
 *
 * --file reads a CSV already on disk instead of the portal — for a manual
 * download when discovery misfires, and for the offline test against the
 * fixture database.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { normalizeCity, canonicalCityName } from "../lib/cityAliases";
import { ensureGeocodeTablesSync } from "../lib/geocodeDb";
import { chooseGeocode, type Geocode } from "../lib/geocode";
import { addressKeyString } from "../lib/addressKey";
import {
  detectColumns, detectCrs, parseCsvLine, recordToGeocode, sniffSeparator, streetCentroid,
  type ColumnMap, type MapiGeocode, type Rec,
} from "../lib/mapiAddresses";

const CKAN = "https://data.gov.il/api/3/action";
const DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db");
const MIN_SANE_ROWS = Number(process.env.KARNAF_MAPI_MIN_ROWS ?? 100_000);
const FRESH_DAYS = Number(process.env.KARNAF_MAPI_FRESH_DAYS ?? 30);
const PAGE = 5000;
const MAX_ROWS = 1_500_000;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json, text/csv;q=0.9, */*;q=0.8",
};

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const FORCE = argv.includes("--force");
const LOCAL_FILE = argv.find((a) => a.startsWith("--file="))?.slice("--file=".length) ?? null;

interface CkanResource { id: string; name?: string; format?: string; url?: string; datastore_active?: boolean; last_modified?: string | null; size?: number | null }
interface CkanPackage { id: string; title?: string; name?: string; organization?: { title?: string } | null; resources?: CkanResource[]; metadata_modified?: string }

async function ckan<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${CKAN}/${pathAndQuery}`, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`data.gov.il HTTP ${res.status} for ${pathAndQuery}`);
  const body = (await res.json()) as { success?: boolean; result?: T };
  if (!body.success || body.result === undefined) throw new Error(`CKAN success=false for ${pathAndQuery}`);
  return body.result;
}

/** Print every candidate; pick the best; let the env override. */
async function discover(): Promise<{ res: CkanResource; title: string }> {
  if (LOCAL_FILE) return { res: { id: "file", url: LOCAL_FILE, format: "CSV" }, title: `local file ${path.basename(LOCAL_FILE)}` };
  const forcedId = process.env.KARNAF_MAPI_RESOURCE_ID;
  const forcedUrl = process.env.KARNAF_MAPI_CSV_URL;
  if (forcedUrl) return { res: { id: "env", url: forcedUrl, format: "CSV" }, title: `KARNAF_MAPI_CSV_URL` };
  if (forcedId) {
    const r = await ckan<CkanResource>(`resource_show?id=${encodeURIComponent(forcedId)}`);
    return { res: r, title: `KARNAF_MAPI_RESOURCE_ID ${forcedId}` };
  }
  const queries = ["מאגר כתובות ארצי", "כתובות מפי", "כתובות קואורדינטות", "כתובות", "addresses"];
  const seen = new Map<string, CkanPackage>();
  for (const q of queries) {
    const r = await ckan<{ results?: CkanPackage[] }>(`package_search?q=${encodeURIComponent(q)}&rows=30`);
    for (const p of r.results ?? []) seen.set(p.id, p);
  }
  console.log(`   ${seen.size} מאגרים מועמדים:`);
  const cands: Array<{ pkg: CkanPackage; res: CkanResource; score: number }> = [];
  for (const pkg of seen.values()) {
    const title = `${pkg.title ?? ""} ${pkg.name ?? ""}`;
    const org = pkg.organization?.title ?? "";
    for (const res of pkg.resources ?? []) {
      const fmt = (res.format ?? "").toUpperCase();
      const usable = res.datastore_active || /CSV|JSON/.test(fmt) || /\.csv(\?|$)/i.test(res.url ?? "");
      let score = 0;
      if (/כתובות|address/i.test(title)) score += 3;
      if (/ארצי|לאומי|national/i.test(title)) score += 2;
      if (/מיפוי|מפ.?י|survey of israel/i.test(org)) score += 3;
      if (/קואורדינט|coord|x.?y|geo/i.test(`${title} ${res.name ?? ""}`)) score += 1;
      if (res.datastore_active) score += 1;
      if ((res.size ?? 0) > 20_000_000) score += 1;
      console.log(`     [${String(score).padStart(2)}] ${title.trim()} · ${org} · ${res.name ?? res.id} · ${fmt}${res.datastore_active ? " · datastore" : ""}${usable ? "" : " · לא שמיש"}`);
      if (usable) cands.push({ pkg, res, score });
    }
  }
  cands.sort((a, b) => b.score - a.score || (b.res.last_modified ?? "").localeCompare(a.res.last_modified ?? ""));
  const best = cands[0];
  if (!best || best.score < 4) {
    throw new Error("לא נמצא מאגר כתובות ארצי משכנע ב-data.gov.il — הגדר KARNAF_MAPI_RESOURCE_ID או KARNAF_MAPI_CSV_URL");
  }
  return { res: best.res, title: best.pkg.title ?? best.pkg.name ?? best.res.id };
}

/** Pull every record: datastore paging when active, else the CSV itself. */
async function* records(res: CkanResource): AsyncGenerator<Rec[]> {
  if (res.datastore_active && res.id !== "env") {
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
      const r = await ckan<{ records?: Rec[] }>(`datastore_search?resource_id=${res.id}&limit=${PAGE}&offset=${offset}`);
      const page = r.records ?? [];
      if (!page.length) return;
      yield page;
      if (page.length < PAGE) return;
    }
    return;
  }
  if (!res.url) throw new Error("למשאב אין datastore וגם אין URL להורדה");
  let tmp = res.url;
  if (res.id !== "file") {
    tmp = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "mapi_addresses.download");
    const resp = await fetch(res.url, { headers: HEADERS, signal: AbortSignal.timeout(20 * 60_000) });
    if (!resp.ok) throw new Error(`הורדת הקובץ נכשלה: HTTP ${resp.status}`);
    fs.writeFileSync(tmp, Buffer.from(await resp.arrayBuffer()));
    console.log(`   הורד ${(fs.statSync(tmp).size / 1e6).toFixed(1)}MB → ${tmp}`);
  }
  let text = fs.readFileSync(tmp, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  const sep = sniffSeparator(lines[0]);
  const header = parseCsvLine(lines[0], sep);
  let batch: Rec[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = parseCsvLine(lines[i], sep);
    const rec: Rec = {};
    header.forEach((h, j) => { rec[h] = cells[j]; });
    batch.push(rec);
    if (batch.length >= PAGE) { yield batch; batch = []; }
  }
  if (batch.length) yield batch;
  if (res.id !== "file") fs.unlinkSync(tmp);
}

async function main(): Promise<number> {
  console.log("🗺  מאגר הכתובות הלאומי (מפ״י, data.gov.il) → address_geocodes");
  const db = new Database(DB);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 60000");
  ensureGeocodeTablesSync(db);

  const last = db.prepare("SELECT imported_at, rows_kept, resource_id FROM mapi_import_status WHERE id=1").get() as
    { imported_at: string | null; rows_kept: number | null; resource_id: string | null } | undefined;
  if (last?.imported_at && !FORCE && !DRY) {
    const ageDays = (Date.now() - new Date(last.imported_at).getTime()) / 86_400_000;
    if (ageDays < FRESH_DAYS) {
      console.log(`⏭  דילוג — יובא לפני ${ageDays.toFixed(0)} ימים (${last.rows_kept} כתובות מ-${last.resource_id}); --force כדי לייבא שוב`);
      return 0;
    }
  }

  // our spelling of every city, for folding the file's settlement names
  const byNorm = new Map<string, string>();
  for (const c of db.prepare("SELECT city_name FROM cities").all() as Array<{ city_name: string }>) byNorm.set(normalizeCity(c.city_name), c.city_name);
  const cityFold = (raw: string): string | null => byNorm.get(normalizeCity(canonicalCityName(raw))) ?? null;

  let found: { res: CkanResource; title: string };
  try {
    found = await discover();
    console.log(`   נבחר: ${found.title} (${found.res.id}${found.res.format ? ` · ${found.res.format}` : ""})`);
  } catch (e) {
    console.log(`⏭  דילוג — ${e instanceof Error ? e.message : e}`);
    return 0;
  }

  let cols: ColumnMap | null = null;
  const kept: MapiGeocode[] = [];
  const byStreet = new Map<string, Array<{ lon: number; lat: number }>>();
  let rowsIn = 0, outsideCities = 0, unusable = 0;
  const unknownCities = new Map<string, number>();
  try {
    for await (const page of records(found.res)) {
      if (!cols) {
        const keys = Object.keys(page[0]).filter((k) => k !== "_id");
        const det = detectColumns(keys);
        if ("error" in det) throw new Error(det.error);
        const sample = page.slice(0, 200).map((r) => [Number(String(r[det.x]).replace(/,/g, "")), Number(String(r[det.y]).replace(/,/g, ""))] as [number, number]);
        const crs = detectCrs(sample);
        if (typeof crs !== "string") throw new Error(crs.error);
        cols = { ...det, crs };
        console.log(`   עמודות: יישוב=${cols.city} רחוב=${cols.street} בית=${cols.house} ${cols.crs === "itm" ? `X=${cols.x} Y=${cols.y} (ITM)` : `lon=${cols.x} lat=${cols.y} (WGS84)`}`);
        if (DRY) { console.log("   --dry-run: עמודות זוהו, לא נכתב דבר."); return 0; }
      }
      for (const r of page) {
        rowsIn++;
        const g = recordToGeocode(r, cols, cityFold);
        if (!g) {
          const raw = String(r[cols.city] ?? "").trim();
          if (raw && !cityFold(raw)) { outsideCities++; unknownCities.set(raw, (unknownCities.get(raw) ?? 0) + 1); }
          else unusable++;
          continue;
        }
        kept.push(g);
        const sk = `${g.key.cityName}|${g.key.streetNorm}`;
        byStreet.set(sk, [...(byStreet.get(sk) ?? []), { lon: g.lon, lat: g.lat }]);
      }
      if (rowsIn % 50_000 < PAGE) console.log(`   … ${rowsIn.toLocaleString("en")} שורות נקראו, ${kept.length.toLocaleString("en")} כתובות בערים שלנו`);
    }
  } catch (e) {
    console.log(`⏭  דילוג — ${e instanceof Error ? e.message : e}`);
    return 0;
  }
  console.log(`   נקראו ${rowsIn.toLocaleString("en")} · בערים שלנו ${kept.length.toLocaleString("en")} · מחוץ לערים ${outsideCities.toLocaleString("en")} · לא שמישות ${unusable.toLocaleString("en")}`);
  const topUnknown = [...unknownCities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (topUnknown.length) console.log(`   יישובים שאינם במאגר (הגדולים): ${topUnknown.map(([c, n]) => `${c} (${n})`).join(", ")}`);
  if (kept.length < MIN_SANE_ROWS) {
    console.log(`⏭  דילוג — רק ${kept.length} כתובות שמישות (סף ${MIN_SANE_ROWS}); address_geocodes נשארת כפי שהיא.`);
    return 0;
  }

  // write: chooseGeocode precedence per row, streets as centroids
  const existing = db.prepare("SELECT lon, lat, itm_x, itm_y, level, source FROM address_geocodes WHERE city_name=? AND street_norm=? AND house_norm=?");
  const upsert = db.prepare(`INSERT INTO address_geocodes (city_name, street_norm, house_norm, lon, lat, itm_x, itm_y, level, source, raw_label, geocoded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'))
    ON CONFLICT(city_name, street_norm, house_norm) DO UPDATE SET
      lon=excluded.lon, lat=excluded.lat, itm_x=excluded.itm_x, itm_y=excluded.itm_y,
      level=excluded.level, source=excluded.source, raw_label=excluded.raw_label, geocoded_at=excluded.geocoded_at`);
  let written = 0, keptExisting = 0, streets = 0;
  const write = db.transaction(() => {
    const seen = new Set<string>();
    for (const g of kept) {
      const k = `${g.key.cityName}|${addressKeyString(g.key)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const incoming: Geocode = { lon: g.lon, lat: g.lat, itmX: g.itmX, itmY: g.itmY, level: "house", source: "mapi", rawLabel: found.title };
      const cur = existing.get(g.key.cityName, g.key.streetNorm, g.key.houseNorm) as
        { lon: number; lat: number; itm_x: number; itm_y: number; level: Geocode["level"]; source: Geocode["source"] } | undefined;
      const chosen = chooseGeocode(cur ? { lon: cur.lon, lat: cur.lat, itmX: cur.itm_x, itmY: cur.itm_y, level: cur.level, source: cur.source } : null, incoming);
      if (chosen !== incoming) { keptExisting++; continue; }
      upsert.run(g.key.cityName, g.key.streetNorm, g.key.houseNorm, g.lon, g.lat, g.itmX, g.itmY, "house", "mapi", found.title);
      written++;
    }
    for (const [sk, pts] of byStreet) {
      const [city, street] = sk.split("|");
      const c = streetCentroid(pts);
      if (!c) continue;
      const cur = existing.get(city, street, "") as { level: Geocode["level"]; source: Geocode["source"]; lon: number; lat: number; itm_x: number; itm_y: number } | undefined;
      const incoming: Geocode = { lon: c.lon, lat: c.lat, itmX: null, itmY: null, level: "street", source: "mapi", rawLabel: `centroid of ${pts.length}` };
      const chosen = chooseGeocode(cur ? { lon: cur.lon, lat: cur.lat, itmX: cur.itm_x, itmY: cur.itm_y, level: cur.level, source: cur.source } : null, incoming);
      if (chosen !== incoming) continue;
      upsert.run(city, street, "", c.lon, c.lat, null, null, "street", "mapi", `centroid of ${pts.length}`);
      streets++;
    }
    db.prepare(`INSERT INTO mapi_import_status (id, resource_id, package_title, rows_in, rows_kept, crs, imported_at)
      VALUES (1, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET resource_id=excluded.resource_id, package_title=excluded.package_title,
        rows_in=excluded.rows_in, rows_kept=excluded.rows_kept, crs=excluded.crs, imported_at=excluded.imported_at`)
      .run(found.res.id, found.title, rowsIn, kept.length, cols!.crs);
  });
  write();
  console.log(`✅ נכתבו ${written.toLocaleString("en")} כתובות ברמת בית (${keptExisting.toLocaleString("en")} נשארו ממקור עדיף) + ${streets.toLocaleString("en")} מרכזי רחוב`);
  console.log("   הצינור הלילי יפיץ; לתוצאה מיידית: POST /api/revalidate");
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error("FATAL", e); process.exit(1); });
