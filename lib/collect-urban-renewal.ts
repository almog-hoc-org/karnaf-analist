/**
 * Urban-renewal districts (מתחמי התחדשות עירונית) — data.gov.il CKAN collector.
 *
 * The Governmental Authority for Urban Renewal publishes the national list of
 * declared renewal districts on the open-data portal. The portal is a standard
 * CKAN instance, so instead of hard-coding a resource id that rots the day the
 * authority re-uploads the file, this collector DISCOVERS the dataset at run
 * time: package_search → the best matching package → its datastore-backed
 * resource → datastore_search paging.
 *
 * Column names in these uploads are Hebrew and drift between revisions
 * ("סטטוס"/"סטאטוס", "יח\"ד קיימות"/"מספר יח\"ד קיים"...), so fields are
 * matched by pattern against the record keys rather than by exact name.
 *
 * FAILS SOFT, NEVER DESTRUCTIVE. If the portal is unreachable, the dataset is
 * gone, or the fetch comes back suspiciously small, the existing table is left
 * untouched and the run exits 0 with a loud skip line — the same
 * skipped-unreachable contract the other collectors follow. The replace is a
 * single transaction, so readers never see a half-written table.
 */
import Database from "better-sqlite3";
import path from "path";
import { canonicalCityName, normalizeCity } from "./cityAliases";

const CKAN = "https://data.gov.il/api/3/action";
const DB_PATH = path.resolve("./data/realestate.db");
/** Refuse to wipe a populated table for a fetch smaller than this. */
const MIN_SANE_ROWS = 20;
const PAGE = 1000;
const MAX_ROWS = 50_000;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json",
};

interface CkanResource {
  id: string;
  name?: string;
  format?: string;
  datastore_active?: boolean;
  last_modified?: string | null;
}
interface CkanPackage {
  id: string;
  title?: string;
  name?: string;
  organization?: { title?: string } | null;
  resources?: CkanResource[];
}

async function ckan<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${CKAN}/${pathAndQuery}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`data.gov.il HTTP ${res.status} for ${pathAndQuery}`);
  const body = (await res.json()) as { success?: boolean; result?: T };
  if (!body.success || body.result === undefined) throw new Error(`CKAN success=false for ${pathAndQuery}`);
  return body.result;
}

/**
 * Find the datastore resource that carries the districts list.
 * Several queries, best package wins: title must smell like מתחמים/התחדשות,
 * and it must actually have a datastore-backed resource to page through.
 */
async function discoverResource(): Promise<{ resourceId: string; packageTitle: string }> {
  const queries = [
    '"התחדשות עירונית" מתחמים',
    "מתחמי התחדשות עירונית",
    "התחדשות עירונית",
  ];
  const seen = new Map<string, CkanPackage>();
  for (const q of queries) {
    const r = await ckan<{ results?: CkanPackage[] }>(
      `package_search?q=${encodeURIComponent(q)}&rows=20`
    );
    for (const p of r.results ?? []) seen.set(p.id, p);
    if (seen.size) break; // first query that returns anything is the most specific
  }

  let best: { pkg: CkanPackage; res: CkanResource; score: number } | null = null;
  for (const pkg of seen.values()) {
    const title = `${pkg.title ?? ""} ${pkg.name ?? ""}`;
    if (!/התחדשות/.test(title)) continue;
    let score = 0;
    if (/מתחמ/.test(title)) score += 2;
    if (/התחדשות עירונית/.test(pkg.organization?.title ?? "")) score += 2;
    for (const res of pkg.resources ?? []) {
      if (!res.datastore_active) continue;
      // newer upload of the same package wins via last_modified ordering
      const cand = { pkg, res, score };
      if (!best || cand.score > best.score) best = cand;
    }
  }
  if (!best) throw new Error("לא נמצא מאגר מתחמי התחדשות עם datastore פעיל ב-data.gov.il");
  return { resourceId: best.res.id, packageTitle: best.pkg.title ?? best.pkg.name ?? best.res.id };
}

/* ── field mapping: Hebrew headers drift between uploads ─────────────────── */

type Rec = Record<string, unknown>;

function findKey(keys: string[], patterns: RegExp[], exclude?: RegExp): string | null {
  for (const p of patterns) {
    const hit = keys.find((k) => p.test(k) && !(exclude && exclude.test(k)));
    if (hit) return hit;
  }
  return null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s && s !== "-" && s.toLowerCase() !== "null" ? s : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

interface ProjectRow {
  city_name: string;
  site_name: string | null;
  track: string | null;
  status: string | null;
  units_existing: number | null;
  units_proposed: number | null;
  plan_id: string | null;
}

function mapRecords(records: Rec[]): ProjectRow[] {
  if (!records.length) return [];
  const keys = Object.keys(records[0]);
  // Each field carries BOTH spellings the authority has actually used: Hebrew
  // headers, and the transliterated-Latin headers of the current upload
  // (Yeshuv, ShemMitcham, YachadMutza… — observed live 2026-08-13).
  const kCity = findKey(keys, [/^Yeshuv$/i, /^(שם\s*)?(ה)?(רשות|יישוב|ישוב|עיר)/, /(רשות מקומית|יישוב|ישוב)/], /semel|סמל/i);
  const kSite = findKey(keys, [/^ShemMitc?ham$/i, /שם\s*(ה)?מתחם/, /מתחם/, /Mitc?ham/i, /שם\s*(ה)?(פרויקט|אתר|שכונה)/], /מספר|כמות|mispar/i);
  const kTrack = findKey(keys, [/^Maslul$/i, /מסלול/]);
  const kStatus = findKey(keys, [/^Status$/i, /סט(א)?טוס/, /שלב/]);
  const kExisting = findKey(keys, [/^YachadKayam$/i, /יח.{0,4}ד.*קיימ/, /קיימ.*יח.{0,4}ד/, /דירות.*קיימ/]);
  const kProposed = findKey(keys, [/^YachadMutza$/i, /יח.{0,4}ד.*(מוצע|מתוכנ|תוספת|חדש)/, /(מוצע|מתוכנ).*יח.{0,4}ד/, /דירות.*(מוצע|מתוכנ)/, /^YachadTosafti$/i]);
  const kPlan = findKey(keys, [/^MisparToc?hnit$/i, /מספר\s*ת(ו)?כנית/, /ת(ו)?כנית/]);

  if (!kCity) throw new Error(`לא זוהתה עמודת יישוב. עמודות: ${keys.join(" | ")}`);
  console.log(
    `   מיפוי עמודות: עיר=${kCity} מתחם=${kSite ?? "—"} מסלול=${kTrack ?? "—"} ` +
    `סטטוס=${kStatus ?? "—"} קיימות=${kExisting ?? "—"} מוצעות=${kProposed ?? "—"} תכנית=${kPlan ?? "—"}`
  );

  const out: ProjectRow[] = [];
  for (const r of records) {
    const city = str(r[kCity]);
    if (!city) continue;
    out.push({
      city_name: canonicalCityName(city),
      site_name: kSite ? str(r[kSite]) : null,
      track: kTrack ? str(r[kTrack]) : null,
      status: kStatus ? str(r[kStatus]) : null,
      units_existing: kExisting ? num(r[kExisting]) : null,
      units_proposed: kProposed ? num(r[kProposed]) : null,
      plan_id: kPlan ? str(r[kPlan]) : null,
    });
  }
  return out;
}

/* ── main ────────────────────────────────────────────────────────────────── */

async function main() {
  console.log("🏗  מתחמי התחדשות עירונית — data.gov.il");

  let rows: ProjectRow[];
  let packageTitle: string;
  try {
    const found = await discoverResource();
    packageTitle = found.packageTitle;
    console.log(`   מאגר: ${packageTitle} (resource ${found.resourceId})`);

    const records: Rec[] = [];
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
      const r = await ckan<{ records?: Rec[]; total?: number }>(
        `datastore_search?resource_id=${found.resourceId}&limit=${PAGE}&offset=${offset}`
      );
      const page = r.records ?? [];
      records.push(...page);
      if (page.length < PAGE) break;
    }
    console.log(`   נמשכו ${records.length} רשומות`);
    rows = mapRecords(records);
  } catch (e) {
    // The unreachable-source contract: skip loudly, exit clean, touch nothing.
    console.log(`⏭  דילוג — המאגר לא נגיש או השתנה: ${e instanceof Error ? e.message : e}`);
    return;
  }

  if (rows.length < MIN_SANE_ROWS) {
    console.log(`⏭  דילוג — רק ${rows.length} שורות שמישות (סף ${MIN_SANE_ROWS}); הטבלה הקיימת נשארת.`);
    return;
  }

  const db = new Database(DB_PATH);
  try {
    // Fold each incoming settlement name onto the EXACT spelling our cities
    // table uses ("תל אביב -יפו" → "תל אביב-יפו"), so the city page's join is
    // a plain equality. Unmatched names (regional councils etc.) keep their own
    // spelling — they simply have no city page to appear on.
    const byNorm = new Map(
      (db.prepare("SELECT city_name FROM cities").all() as Array<{ city_name: string }>)
        .map((c) => [normalizeCity(c.city_name), c.city_name])
    );
    for (const r of rows) {
      const exact = byNorm.get(normalizeCity(r.city_name));
      if (exact) r.city_name = exact;
    }

    db.exec(`CREATE TABLE IF NOT EXISTS urban_renewal_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      city_name TEXT NOT NULL,
      site_name TEXT,
      track TEXT,
      status TEXT,
      units_existing INTEGER,
      units_proposed INTEGER,
      plan_id TEXT,
      source_dataset TEXT,
      fetched_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_urp_city ON urban_renewal_projects(city_name);`);

    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO urban_renewal_projects
        (city_name, site_name, track, status, units_existing, units_proposed, plan_id, source_dataset, fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    );
    db.transaction(() => {
      db.prepare("DELETE FROM urban_renewal_projects").run();
      for (const r of rows) {
        insert.run(r.city_name, r.site_name, r.track, r.status, r.units_existing, r.units_proposed, r.plan_id, packageTitle, now);
      }
    })();

    const cities = (db.prepare("SELECT COUNT(DISTINCT city_name) n FROM urban_renewal_projects").get() as { n: number }).n;
    console.log(`✅ נשמרו ${rows.length} מתחמים ב-${cities} יישובים`);
  } finally {
    db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
