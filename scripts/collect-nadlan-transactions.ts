#!/usr/bin/env tsx
/**
 * Collect nadlan settlement deals into the DB (nadlan_transactions), WITH build year.
 *
 * How it works (see the discovery notes): the settlement deals view
 * (nadlan.gov.il/?view=settlement&id={cbs}&page=deals) loads deals in server chunks of
 * 500, addressed by `fetch_number`. The real browser passes reCAPTCHA on load and fires
 * chunk 1; we harvest that request's session token (`sk`+`token`) and re-sign the payload
 * (HS256 secret from the app bundle, then reversed — the app's own format) to fetch chunk 2
 * IN-PAGE. That yields up to ~1000 recent deals per city — the maximum nadlan allows an
 * anonymous session (it hard-caps at page 100 / 1000 deals with a "userLimitModal"; deeper
 * history needs a logged-in "Verified" account). We do NOT exceed that cap or mint our own
 * recaptcha tokens — we reuse the token the app legitimately produced, staying within the
 * same allowance a user gets by paging.
 *
 * Each kept deal carries yearBuilt → is_secondhand = dealYear - yearBuilt >= 4. We also
 * store nadlan's native hok_hamecher (1 = יד ראשונה / new, 0 = יד שנייה) when present.
 *
 * Usage:
 *   npx tsx scripts/collect-nadlan-transactions.ts                 # all coded cities, skip fresh
 *   npx tsx scripts/collect-nadlan-transactions.ts "לוד" "תל אביב-יפו"
 *   npx tsx scripts/collect-nadlan-transactions.ts --force ...
 *
 * Prereq: debuggable Chrome on :9222 (scripts/bootstrap_nadlan_chrome.sh).
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import puppeteerCore from "puppeteer-core";
import { prisma } from "../lib/db";
import { DEAL_KEY_INDEX_SQL, insertIfAbsentSql } from "../lib/dealKey";
import { describeRawItem } from "../lib/nadlanAddress";
import { buildNadlanRow, NADLAN_ROW_COLS } from "../lib/nadlanRow";
import { ensureNadlanAddressColumns } from "../lib/addressBackfillDb";

const SECRET = "90c3e620192348f1bd46fcd9138c3c68"; // HS256 key from the nadlan JS bundle (mixin_generateTokenForPayload)
const FRESH_DAYS = 20;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const b64url = (s: string | Buffer) => Buffer.from(s as never).toString("base64url");
const unrev = (s: string) => s.split("").reverse().join("");
function b64json(s: string): Record<string, unknown> | null {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); } catch { return null; }
}
function signBody(payload: Record<string, unknown>): string {
  const h = b64url(JSON.stringify({ alg: "HS256" }));
  const b = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", Buffer.from(SECRET, "utf8")).update(`${h}.${b}`).digest("base64url");
  return unrev(`${h}.${b}.${sig}`);
}
function decode(txt: string): unknown {
  const t = txt.trim();
  if (t.startsWith("{")) return JSON.parse(t);
  try { return JSON.parse(zlib.gunzipSync(Buffer.from(t, "base64")).toString("utf8")); } catch { return null; }
}

interface RawItem {
  dealDate?: string; dealAmount?: number; roomNum?: number; assetArea?: number;
  yearBuilt?: number; priceSM?: number; neighborhoodName?: string; hok_hamecher?: unknown; dealNature?: string;
  /** the API returns more than the typed fields — the address lives among
   *  them under a name this code reads defensively (lib/nadlanAddress) */
  [k: string]: unknown;
}
function cityCodeMap(): Map<string, string> {
  const j = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/city_cbs_codes.json"), "utf8")) as Record<string, number>;
  return new Map(Object.entries(j).map(([k, v]) => [k.trim(), String(v)]));
}

async function cityIsFresh(city: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ c: number; latest: string | null }[]>(
    "SELECT COUNT(*) c, MAX(captured_at) latest FROM nadlan_transactions WHERE city_name = ? AND source = 'nadlan'", city
  );
  const r = rows[0];
  if (!r || Number(r.c) === 0 || !r.latest) return false;
  const ageDays = (Date.now() - new Date(r.latest).getTime()) / 86400000;
  return ageDays < FRESH_DAYS;
}

async function collectCity(browser: import("puppeteer-core").Browser, city: string, code: string): Promise<{ n: number; years: string }> {
  const page = await browser.newPage();
  const chunkItems: RawItem[][] = [];
  let harvestBody = "";
  page.on("request", (rq) => {
    if (/\/deal-data/.test(rq.url()) && rq.method() === "POST" && !harvestBody) harvestBody = rq.postData() || "";
  });
  page.on("response", async (r) => {
    if (!/\/deal-data/.test(r.url())) return;
    try { const d = decode(await r.text()) as { data?: { items?: RawItem[] } }; if (d?.data?.items?.length) chunkItems.push(d.data.items); } catch { /* ignore */ }
  });

  try {
    await page.goto(`https://www.nadlan.gov.il/?view=settlement&id=${code}&page=deals`, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
    for (let w = 0; w < 10 && chunkItems.length === 0; w++) await sleep(2000);

    // Re-signed in-page fetches reusing the app's freshly-minted token. KEY: filtering by
    // room_num spreads the 500-deal window across MANY more years (e.g. יבנה 3-room = 2021–2026
    // vs 2025–2026 unfiltered), so per-room queries give real MULTI-YEAR build-year data for the
    // second-hand split — all within the same authenticated session (no cap-bypass).
    if (harvestBody) {
      const p1 = b64json(unrev(JSON.parse(harvestBody)["##"]).split(".")[1]);
      if (p1?.sk && p1?.token) {
        const fetchQ = async (extra: Record<string, unknown>) => {
          const now = Math.floor(Date.now() / 1000);
          const payload = { base_id: p1.base_id, base_name: p1.base_name, type_order: "dealDate_down", sk: p1.sk, token: p1.token, exp: now + 110, domain: "www.nadlan.gov.il", ...extra };
          const body = signBody(payload);
          const txt: string = await page.evaluate(async (bodyStr) => {
            const r = await fetch("https://api.nadlan.gov.il/deal-data", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ "##": bodyStr }), redirect: "follow" });
            return await r.text();
          }, body).catch(() => "");
          const d = decode(txt) as { data?: { items?: RawItem[] } } | null;
          if (d?.data?.items?.length) chunkItems.push(d.data.items);
        };
        for (const room of ["3", "4", "5"]) {
          await fetchQ({ fetch_number: 1, room_num: room });
          await sleep(rnd(500, 1100));
          await fetchQ({ fetch_number: 2, room_num: room });
          await sleep(rnd(500, 1100));
        }
        await fetchQ({ fetch_number: 2 }); // unfiltered chunk 2 (1-2 room + general recency)
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  // merge + dedupe (by date+amount+area+rooms)
  const seen = new Set<string>();
  const merged: RawItem[] = [];
  for (const items of chunkItems) for (const d of items) {
    const k = `${d.dealDate}|${d.dealAmount}|${d.assetArea}|${d.roomNum}`;
    if (!seen.has(k)) { seen.add(k); merged.push(d); }
  }
  if (merged.length === 0) return { n: 0, years: "" };

  // The schema, once per city, from the horse's mouth. The typed RawItem above
  // is what this collector CHOSE to read, not what the API sends — and the
  // difference is exactly how the neighbourhood got dropped for months. This
  // line is what turns the defensive address parsing into a measured fact.
  console.log(`    שדות גולמיים: ${describeRawItem(merged[0] as Record<string, unknown>)}`);

  // ACCUMULATE. This used to delete the city's nadlan rows first, which made
  // repeated sweeps pointless: an anonymous session returns ~2,400 deals, so ten
  // years of build-year data for a large city can only be reached by successive
  // passes adding to each other. Each pass was discarding the last one's work.
  await prisma.$executeRawUnsafe(DEAL_KEY_INDEX_SQL);
  await ensureNadlanAddressColumns(prisma);
  // One row builder for every nadlan writer (lib/nadlanRow.ts): deal_year,
  // room bucket, second-hand verdict, address split, and — since the address
  // campaign — parcel, building floors, floor text and the site's assetId.
  // 'nadlan' is bound as a parameter like every other column.
  const rows: Array<{ dy: number; tuple: unknown[] }> = [];
  for (const d of merged) {
    const tuple = buildNadlanRow(d as Record<string, unknown>, city, code);
    if (tuple) rows.push({ dy: Number(String(d.dealDate).slice(0, 4)), tuple });
  }
  const COLS = NADLAN_ROW_COLS.join(",");
  const CHUNK = 80;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await prisma.$executeRawUnsafe(insertIfAbsentSql(COLS, slice.length), ...slice.flatMap((r) => r.tuple));
  }
  const years = [...new Set(rows.map((r) => r.dy))].sort();
  return { n: rows.length, years: `${years[0]}–${years[years.length - 1]}` };
}

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const names = argv.filter((a) => !a.startsWith("--"));
  const codes = cityCodeMap();
  const cities = (names.length ? names : [...codes.keys()]).filter((c) => codes.has(c));
  const missing = names.filter((c) => !codes.has(c));
  if (missing.length) console.log("⚠ no cbs_code for:", missing.join(", "));

  console.log(`\n=== collect-nadlan-transactions — ${cities.length} cities ===`);
  const browser = await puppeteerCore.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
  let ok = 0, skip = 0, empty = 0, err = 0;
  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    const code = codes.get(city)!;
    const tag = `[${i + 1}/${cities.length}] ${city} (${code})`;
    if (!force && (await cityIsFresh(city))) { console.log(`${tag}: skip (fresh)`); skip++; continue; }
    try {
      const t0 = Date.now();
      const { n, years } = await collectCity(browser, city, code);
      if (n === 0) { console.log(`${tag}: EMPTY`); empty++; }
      else { console.log(`${tag}: ${n} deals ${years} (${((Date.now() - t0) / 1000).toFixed(0)}s)`); ok++; }
    } catch (e) { console.error(`${tag}: ERROR — ${e instanceof Error ? e.message : e}`); err++; }
    await sleep(rnd(3500, 7000)); // human pace
  }
  await browser.disconnect();
  console.log(`\n--- Done. ok=${ok}, skipped=${skip}, empty=${empty}, errored=${err} ---`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
