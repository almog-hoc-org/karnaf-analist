#!/usr/bin/env tsx
/**
 * Building starts by city from the CBS press releases — collector.
 *
 *   npx tsx scripts/collect-cbs-starts.ts [--count=25] [--dry-run] [--all]
 *
 * Lists the releases "התחלות וגמר בנייה" through the CBS site's own SharePoint
 * list API (the subject page is a JavaScript shell over the same call), takes
 * the newest --count, downloads each release document (DocLib/{YYYY}/{NNN}/
 * 04_{YY}_{NNN}b.docx) and stores its city table in cbs_starts_release, one
 * row per (release, city, period) exactly as published. lib/cbsStarts.ts
 * parses; the page reads the newest vintage of each period.
 *
 * Nightly it downloads only releases it has not stored (--all re-reads them).
 * FAILS SOFT: a release without a recognisable city table is logged and
 * skipped; if fewer than MIN_OK of the releases asked for parse, nothing is
 * written and the run exits 1, leaving what is stored untouched.
 */
import Database from "better-sqlite3";
import path from "path";
import { docxTables, findCityTable, isStartsReleaseTitle, NATIONAL_TOTAL, parseStartsTable, type StartsRow } from "../lib/cbsStarts";

const DB_PATH = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db");
const BASE = "https://www.cbs.gov.il/he/mediarelease";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const PAUSE_MS = 1500;

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const flag = (k: string) => process.argv.includes(`--${k}`);
const COUNT = Number(arg("count") ?? 25);
const DRY = flag("dry-run");
const ALL = flag("all");
const MIN_OK = Math.max(1, Math.floor(COUNT * 0.8));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** cbs.gov.il resets connections now and then under consecutive requests; a retry a few seconds later works. */
async function get(url: string, accept: string): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept }, signal: AbortSignal.timeout(60_000) });
      if (res.ok) return res;
      last = new Error(`HTTP ${res.status}`);
      if (res.status === 404) break;
    } catch (e) {
      last = e;
    }
    await sleep(3000 * (i + 1));
  }
  throw new Error(`${url}: ${last instanceof Error ? last.message : String(last)}`);
}

interface Release { no: string; date: string; title: string; year: string; num: string }

async function listReleases(): Promise<Release[]> {
  const q = new URLSearchParams({
    $select: "Title,CbsDataPublishDate,CbsPubNumber,CbsPublishingFolderLevel1,CbsPublishingFolderLevel2",
    $filter: "substringof('גמר',Title) and substringof('בני',Title)",
    $orderby: "CbsDataPublishDate desc",
    $top: "200",
  });
  const url = `${BASE}/_api/web/lists/GetByTitle('${encodeURIComponent("דפים")}')/items?${q}`;
  const body = (await (await get(url, "application/json;odata=nometadata")).json()) as {
    value: Array<{ Title: string; CbsDataPublishDate: string; CbsPubNumber: string; CbsPublishingFolderLevel1: string; CbsPublishingFolderLevel2: string }>;
  };
  return body.value
    .filter((v) => isStartsReleaseTitle(v.Title) && v.CbsPublishingFolderLevel1 && v.CbsPublishingFolderLevel2)
    .map((v) => ({
      no: v.CbsPubNumber,
      date: v.CbsDataPublishDate.slice(0, 10),
      title: v.Title.trim(),
      year: String(v.CbsPublishingFolderLevel1),
      num: String(v.CbsPublishingFolderLevel2).padStart(3, "0"),
    }));
}

/** The release document; its name is predictable, the folder listing is the fallback. */
async function releaseDoc(r: Release): Promise<{ url: string; buf: Buffer }> {
  const folder = `/he/mediarelease/DocLib/${r.year}/${r.num}`;
  const guess = `https://www.cbs.gov.il${folder}/04_${r.year.slice(2)}_${r.num}b.docx`;
  try {
    return { url: guess, buf: Buffer.from(await (await get(guess, "*/*")).arrayBuffer()) };
  } catch {
    const list = (await (await get(
      `${BASE}/_api/web/GetFolderByServerRelativeUrl('${folder}')/Files?$select=Name,ServerRelativeUrl`,
      "application/json;odata=nometadata",
    )).json()) as { value: Array<{ Name: string; ServerRelativeUrl: string }> };
    const doc = list.value.find((f) => /b\.docx$/i.test(f.Name)) ?? list.value.find((f) => /\.docx$/i.test(f.Name));
    if (!doc) throw new Error(`no .docx in ${folder}`);
    const url = `https://www.cbs.gov.il${doc.ServerRelativeUrl}`;
    return { url, buf: Buffer.from(await (await get(url, "*/*")).arrayBuffer()) };
  }
}

function openDb() {
  const db = new Database(DB_PATH);
  db.pragma("busy_timeout = 30000");
  db.exec(`CREATE TABLE IF NOT EXISTS cbs_starts_release (
    release_no   TEXT NOT NULL,
    release_date TEXT NOT NULL,
    release_title TEXT,
    source_url   TEXT,
    period_end   TEXT NOT NULL,
    period_kind  TEXT NOT NULL,
    period_label TEXT NOT NULL,
    city_raw     TEXT NOT NULL,
    city_name    TEXT NOT NULL,
    starts       INTEGER NOT NULL,
    fetched_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (release_no, city_name, period_end)
  )`);
  return db;
}

async function main() {
  const releases = (await listReleases()).slice(0, COUNT);
  console.log(`התחלות בנייה: ${releases.length} הודעות (${releases.at(-1)?.date} – ${releases[0]?.date})`);
  if (!releases.length) { console.log("⚠ רשימת ההודעות ריקה — לא נכתב דבר"); process.exit(1); }

  const db = DRY ? null : openDb();
  const have = new Set(
    db ? (db.prepare("SELECT DISTINCT release_no r FROM cbs_starts_release").all() as Array<{ r: string }>).map((x) => x.r) : [],
  );
  const todo = ALL ? releases : releases.filter((r) => !have.has(r.no));
  if (!todo.length) { console.log("  אין הודעות חדשות"); return; }

  const parsed: Array<{ r: Release; url: string; rows: StartsRow[] }> = [];
  const failed: string[] = [];
  for (const r of todo) {
    try {
      const { url, buf } = await releaseDoc(r);
      const table = findCityTable(docxTables(buf));
      if (!table) throw new Error("no city table (first header cell 'יישוב')");
      const rows = parseStartsTable(table, { no: r.no, date: r.date });
      const cities = new Set(rows.map((x) => x.city));
      if (!cities.has(NATIONAL_TOTAL)) throw new Error("no national-total row");
      if (cities.size < 10) throw new Error(`only ${cities.size} rows`);
      const periods = [...new Set(rows.map((x) => x.periodLabel))];
      console.log(`  ✓ ${r.no} ${r.date}: ${cities.size - 1} ערים · ${periods.join(" / ")}`);
      parsed.push({ r, url, rows });
    } catch (e) {
      failed.push(r.no);
      console.log(`  ✗ ${r.no} ${r.date}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(PAUSE_MS);
  }

  const needed = ALL || !have.size ? MIN_OK : 1;
  if (parsed.length < Math.min(needed, todo.length)) {
    console.log(`⚠ נקראו ${parsed.length} מתוך ${todo.length} — לא נכתב דבר`);
    process.exit(1);
  }
  if (!db) { console.log(`(dry run) ${parsed.reduce((a, p) => a + p.rows.length, 0)} שורות היו נכתבות`); return; }

  const del = db.prepare("DELETE FROM cbs_starts_release WHERE release_no = ?");
  const ins = db.prepare(`INSERT OR REPLACE INTO cbs_starts_release
    (release_no, release_date, release_title, source_url, period_end, period_kind, period_label, city_raw, city_name, starts)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    for (const { r, url, rows } of parsed) {
      del.run(r.no);
      for (const x of rows) ins.run(r.no, r.date, r.title, url, x.periodEnd, x.periodKind, x.periodLabel, x.cityRaw, x.city, x.starts);
    }
  })();
  const n = db.prepare("SELECT COUNT(DISTINCT release_no) r, COUNT(*) c FROM cbs_starts_release").get() as { r: number; c: number };
  console.log(`  נכתבו ${parsed.length} הודעות${failed.length ? ` · נכשלו ${failed.join(", ")}` : ""} · בטבלה: ${n.r} הודעות, ${n.c} שורות`);
}

main().catch((e) => { console.error(e); process.exit(1); });
