#!/usr/bin/env tsx
/**
 * The govmap deals mirror on over.org.il → addresses and neighbourhoods.
 *
 *   npx tsx scripts/import-govmap-mirror.ts [--dry-run] [--force] [--file=layer.gpkg] [--city=חיפה]
 *
 * govmap is geo-blocked from the server, and the per-city campaign that used
 * to donate its addresses (backfill-govmap-addresses.ts) has not run since
 * 3.8.2026. over.org.il republishes the same layer (2.5M deals, monthly) as a
 * GeoPackage — a SQLite file, which better-sqlite3 opens as it is. Each deal
 * carries gush-helka-sub, street, house, floor and the Tax Authority's
 * neighbourhood.
 *
 * What it writes:
 *  1. parcel_addresses — one address per sub-parcel (one flat) and per
 *     gush-helka (sub 0, one building in most cities), only where every deal
 *     reported there agrees on street and house; the neighbourhood when they
 *     agree on that too. The nightly promoter and the `addresses` pipeline
 *     stage read it (lib/parcelAddresses.ts).
 *  2. Per-deal donations onto nadlan_transactions, the never-guess rules of
 *     lib/addressBackfill.ts:
 *       R — rows with a parcel (tax-register deals, and rows matched to it):
 *           the same parcel, date (±1 day) and amount in the mirror is the
 *           same sale;
 *       K — rows without a parcel: the same city, date (or the +1 day shift),
 *           amount, area within 2 m² and rooms;
 *     when the candidates agree on street and house. A row's existing value
 *     is never replaced: a missing street, house, floor, neighbourhood or
 *     parcel is filled, and a neighbourhood or floor is taken only from a
 *     candidate on the row's own street.
 *
 * Runs only when a new version is published (status table), unless --force.
 * The download (~710MB) goes to the data directory and is deleted at the end.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { GOVMAP_MIRROR_DATASET, OVER_API, latestResource } from "../lib/parcelAddresses";
import { cityResolver, gushHelkaOf } from "../lib/mekarkein";
import { normStreet } from "../lib/addressKey";
import { NADLAN_DATE_SHIFT_DAYS, SOFT_AREA_TOLERANCE_SQM, shiftDate } from "../lib/addressBackfill";

const DATA_DIR = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data");
const DB_PATH = path.join(DATA_DIR, "realestate.db");
const UA = "karnaf-analist/1.0 (+https://analyst.karnafnadlan.com; monthly govmap-mirror import)";
const args = process.argv.slice(2);
const flag = (k: string) => args.includes(`--${k}`);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const DRY = flag("dry-run");
const FORCE = flag("force");
const FILE = arg("file");
const ONLY_CITY = arg("city");
/** below this many building-level addresses the build is not trusted, and the old table stays */
const MIN_GH_ROWS = 150_000;
const MIN_FREE_BYTES = 2.5 * 1024 ** 3;

const blank = (v: unknown) => v == null || String(v).trim() === "";

async function latest(): Promise<{ version: number; url: string; modified: string | null }> {
  const meta = (await (await fetch(`${OVER_API}/datasets/${GOVMAP_MIRROR_DATASET}`, { headers: { "User-Agent": UA } })).json()) as { last_modified?: string };
  const versions = (await (await fetch(`${OVER_API}/datasets/${GOVMAP_MIRROR_DATASET}/versions`, { headers: { "User-Agent": UA } })).json()) as never[];
  const r = latestResource(versions, ".gpkg");
  if (!r) throw new Error("no .gpkg resource in the dataset's versions");
  return { ...r, modified: meta.last_modified ?? null };
}

async function download(url: string, to: string) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(to));
}

async function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 60000");
  db.exec(`CREATE TABLE IF NOT EXISTS govmap_mirror_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_at TEXT DEFAULT (datetime('now')), version INTEGER, modified TEXT,
      deals INTEGER, sub_addresses INTEGER, gh_addresses INTEGER,
      filled_street INTEGER, filled_hood INTEGER, filled_floor INTEGER, filled_parcel INTEGER, ambiguous INTEGER, dry INTEGER)`);

  let gpkg = FILE ?? "";
  let version = 0, modified: string | null = null;
  const tmp = path.join(DATA_DIR, "tmp", "govmap-mirror.gpkg");
  if (!FILE) {
    const l = await latest();
    version = l.version; modified = l.modified;
    const last = db.prepare("SELECT version FROM govmap_mirror_status WHERE dry = 0 ORDER BY id DESC LIMIT 1").get() as { version: number } | undefined;
    if (!FORCE && last && last.version >= version) {
      console.log(`↷ מראת govmap לא התעדכנה (גרסה ${version}) — אין מה לייבא`);
      return;
    }
    const st = fs.statfsSync(DATA_DIR);
    if (st.bavail * st.bsize < MIN_FREE_BYTES) {
      console.error(`✗ פחות מ-${(MIN_FREE_BYTES / 1024 ** 3).toFixed(1)}GB פנויים בדיסק — לא מורידים`);
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    console.log(`▸ מוריד את מראת govmap, גרסה ${version}…`);
    await download(l.url, tmp);
    gpkg = tmp;
  }

  try {
    run(db, gpkg, version, modified);
  } finally {
    if (gpkg === tmp) fs.rmSync(tmp, { force: true });
  }
}

function run(db: Database.Database, gpkg: string, version: number, modified: string | null) {
  db.prepare("ATTACH DATABASE ? AS m").run(gpkg);
  const layer = (db.prepare("SELECT table_name t FROM m.gpkg_contents LIMIT 1").get() as { t: string }).t;
  const L = `m."${layer.replace(/"/g, "")}"`;

  // the mirror's deals, normalised once, in a temp table with the two lookup indexes
  const t0 = Date.now();
  db.exec(`DROP TABLE IF EXISTS temp.md;
    CREATE TEMP TABLE md AS
      SELECT CAST(gushNum AS INTEGER) g, CAST(parcelNum AS INTEGER) h, CAST(subParcelNum AS INTEGER) s,
             substr(dealDate, 1, 10) day, CAST(ROUND(CAST(dealAmount AS REAL)) AS INTEGER) amount,
             NULLIF(TRIM(streetNameHeb), '') street, NULLIF(TRIM(houseNum), '') house,
             NULLIF(TRIM(floorNo), '') floor, NULLIF(TRIM(neighborhood), '') hood,
             TRIM(settlementNameHeb) settlement, CAST(assetArea AS REAL) area, CAST(assetRoomNum AS REAL) rooms
        FROM ${L}
       WHERE CAST(dealAmount AS REAL) > 0 AND dealDate >= '1990';
    CREATE INDEX temp.md_parcel ON md(g, h, s, amount, day);
    CREATE INDEX temp.md_key ON md(amount, day);`);
  const deals = (db.prepare("SELECT COUNT(*) n FROM md").get() as { n: number }).n;
  console.log(`  ${deals.toLocaleString("he-IL")} עסקאות במראה · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (deals < 1_000_000) throw new Error(`only ${deals} deals in the mirror — refusing to build from it`);

  // ── 1. parcel_addresses ──────────────────────────────────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS parcel_addresses (
      gush INTEGER NOT NULL, helka INTEGER NOT NULL, sub INTEGER NOT NULL,
      street TEXT NOT NULL, house TEXT NOT NULL, hood TEXT, n INTEGER NOT NULL,
      PRIMARY KEY (gush, helka, sub)) WITHOUT ROWID`);
  const agg = (level: "sub" | "gh") => `
    SELECT g, h, ${level === "sub" ? "s" : "0"}, MIN(street), MIN(house),
           CASE WHEN COUNT(DISTINCT hood) = 1 THEN MIN(hood) END, COUNT(*)
      FROM md
     WHERE street IS NOT NULL AND house IS NOT NULL AND g > 0 AND h > 0 ${level === "sub" ? "AND s > 0" : ""}
     GROUP BY g, h${level === "sub" ? ", s" : ""}
    HAVING COUNT(DISTINCT street || '|' || house) = 1`;
  let subN = 0, ghN = 0;
  if (!DRY) {
    db.transaction(() => {
      db.exec("DELETE FROM parcel_addresses");
      subN = db.prepare(`INSERT INTO parcel_addresses ${agg("sub")}`).run().changes;
      ghN = db.prepare(`INSERT INTO parcel_addresses ${agg("gh")}`).run().changes;
      if (ghN < MIN_GH_ROWS) throw new Error(`only ${ghN} building addresses — the old table stays`);
    })();
  } else {
    subN = (db.prepare(`SELECT COUNT(*) n FROM (${agg("sub")})`).get() as { n: number }).n;
    ghN = (db.prepare(`SELECT COUNT(*) n FROM (${agg("gh")})`).get() as { n: number }).n;
  }
  console.log(`  כתובות לפי חלקה: ${subN.toLocaleString("he-IL")} תת-חלקות · ${ghN.toLocaleString("he-IL")} חלקות`);

  // ── 2. per-deal donations ───────────────────────────────────────────
  const ourCities = (db.prepare("SELECT DISTINCT city_name c FROM nadlan_transactions").all() as Array<{ c: string }>).map((r) => r.c);
  const resolve = cityResolver(ourCities);
  const cityOf = new Map<string, string | null>();
  for (const r of db.prepare("SELECT DISTINCT settlement FROM md").all() as Array<{ settlement: string }>) cityOf.set(r.settlement, resolve(r.settlement));

  const byParcel = db.prepare("SELECT street, house, floor, hood FROM md WHERE g = ? AND h = ? AND s = ? AND amount = ? AND day IN (?, ?, ?)");
  const byKey = db.prepare("SELECT street, house, floor, hood, g, h, s, area, rooms, settlement FROM md WHERE amount = ? AND day IN (?, ?)");
  const rowsOf = db.prepare(`SELECT id, parcel_num p, substr(deal_date, 1, 10) day, price, area, rooms, street, house_num house, floor, neighborhood hood
      FROM nadlan_transactions
     WHERE city_name = ? AND price > 0
       AND (street IS NULL OR TRIM(street) = '' OR house_num IS NULL OR TRIM(house_num) = ''
            OR neighborhood IS NULL OR TRIM(neighborhood) = '' OR floor IS NULL OR parcel_num IS NULL)`);
  const update = db.prepare(`UPDATE nadlan_transactions SET
      street = CASE WHEN street IS NULL OR TRIM(street) = '' THEN ? ELSE street END,
      house_num = CASE WHEN house_num IS NULL OR TRIM(house_num) = '' THEN ? ELSE house_num END,
      floor = COALESCE(floor, ?),
      neighborhood = CASE WHEN neighborhood IS NULL OR TRIM(neighborhood) = '' THEN ? ELSE neighborhood END,
      parcel_num = COALESCE(parcel_num, ?)
    WHERE id = ?`);

  type Cand = { street: string | null; house: string | null; floor: string | null; hood: string | null; parcel?: string | null };
  /** the candidates' one address, or null when they disagree (never guess) */
  const settle = (cands: Cand[]) => {
    const withAddr = cands.filter((c) => c.street && c.house);
    const addrs = new Set(withAddr.map((c) => `${normStreet(c.street)}|${c.house}`));
    if (addrs.size !== 1) return null;
    const pick = <K extends keyof Cand>(k: K) => { const v = new Set(withAddr.map((c) => c[k]).filter((x) => x != null)); return v.size === 1 ? ([...v][0] as Cand[K]) : null; };
    return { street: withAddr[0].street!, house: withAddr[0].house!, floor: pick("floor"), hood: pick("hood"), parcel: pick("parcel") ?? null };
  };

  let filledStreet = 0, filledHood = 0, filledFloor = 0, filledParcel = 0, ambiguous = 0;
  const cities = ONLY_CITY ? [ONLY_CITY] : ourCities;
  for (const city of cities) {
    const rows = rowsOf.all(city) as Array<{ id: number; p: string | null; day: string; price: number; area: number | null; rooms: number | null; street: string | null; house: string | null; floor: string | null; hood: string | null }>;
    if (!rows.length) continue;
    const writes: Array<[string | null, string | null, string | null, string | null, string | null, number]> = [];
    let cStreet = 0, cHood = 0;
    for (const r of rows) {
      let cands: Cand[] = [];
      const gh = gushHelkaOf(r.p);
      const sub = r.p ? Number(r.p.split("-")[2] ?? 0) : 0;
      if (gh && sub > 0) {
        const [g, h] = gh.split("-").map(Number);
        cands = byParcel.all(g, h, sub, Math.round(r.price), r.day, shiftDate(r.day, 1), shiftDate(r.day, -1)) as Cand[];
      } else if (!r.p) {
        // K: the merge's soft key, with the nadlan +1 day shift
        const hits = byKey.all(Math.round(r.price), r.day, shiftDate(r.day, -NADLAN_DATE_SHIFT_DAYS)) as Array<Cand & { g: number; h: number; s: number; area: number | null; rooms: number | null; settlement: string }>;
        cands = hits
          .filter((c) => cityOf.get(c.settlement) === city)
          .filter((c) => r.area == null || c.area == null || Math.abs(c.area - r.area) <= SOFT_AREA_TOLERANCE_SQM)
          .filter((c) => r.rooms == null || c.rooms == null || Math.round(c.rooms) === Math.round(r.rooms))
          .map((c) => ({ ...c, parcel: c.g > 0 && c.h > 0 && c.s > 0 ? `${c.g}-${c.h}-${c.s}` : null }));
      }
      if (!cands.length) continue;
      const d = settle(cands);
      if (!d) { ambiguous++; continue; }
      const hasStreet = !blank(r.street);
      // a row that already names a street takes the rest only from a candidate on that street
      const sameStreet = !hasStreet || normStreet(r.street) === normStreet(d.street);
      if (!sameStreet) continue;
      const w: [string | null, string | null, string | null, string | null, string | null, number] = [
        hasStreet ? null : d.street,
        blank(r.house) ? d.house : null,
        r.floor == null ? d.floor : null,
        blank(r.hood) ? d.hood : null,
        r.p == null ? d.parcel ?? null : null,
        r.id,
      ];
      if (w.slice(0, 5).every((x) => x == null)) continue;
      writes.push(w);
      if (w[0]) cStreet++;
      if (w[3]) cHood++;
      if (w[2]) filledFloor++;
      if (w[4]) filledParcel++;
    }
    filledStreet += cStreet; filledHood += cHood;
    if (!DRY && writes.length) db.transaction(() => { for (const w of writes) update.run(...w); })();
    if (cStreet || cHood) console.log(`  ${city}: +${cStreet.toLocaleString("he-IL")} רחובות · +${cHood.toLocaleString("he-IL")} שכונות`);
  }

  db.prepare(`INSERT INTO govmap_mirror_status (version, modified, deals, sub_addresses, gh_addresses, filled_street, filled_hood, filled_floor, filled_parcel, ambiguous, dry)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(version, modified, deals, subN, ghN, filledStreet, filledHood, filledFloor, filledParcel, ambiguous, DRY ? 1 : 0);
  console.log(`\n✓ מראת govmap${DRY ? " (יבש)" : ""}: +${filledStreet.toLocaleString("he-IL")} רחובות · +${filledHood.toLocaleString("he-IL")} שכונות · +${filledFloor.toLocaleString("he-IL")} קומות · +${filledParcel.toLocaleString("he-IL")} גוש-חלקה · ${ambiguous.toLocaleString("he-IL")} דו-משמעיות`);
  db.exec("DROP TABLE IF EXISTS temp.md");
  db.exec("DETACH DATABASE m");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
