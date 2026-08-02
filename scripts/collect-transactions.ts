#!/usr/bin/env tsx
/**
 * ONE manifest-driven, resumable, robust transaction collector (the "10× pipeline").
 *
 * For every city it decides FROM the manifest (nadlan_collection_status) whether each source
 * needs collecting — so each city is touched at most once, zero duplicate work, fully
 * resumable after any crash:
 *   - skip if manifest.method_version == CURRENT && status == 'ok'
 *   - else collect and upsert the manifest row (n_deals, year span, second-hand n, status).
 *
 * Sources:
 *   - govmap (רשות המסים): broad 2015→now individual deals (no build year) → the "all" series.
 *     Hardened: multi-candidate coords + adaptive backoff on throttling.
 *   - nadlan: build-year deals via PER-ROOM queries (room_num=3/4/5) that spread the 500-cap
 *     across many years → real multi-year second-hand (the יבנה method). Auto-reconnects to the
 *     debuggable Chrome on disconnect (the crash that killed 144 cities).
 *
 * Usage:
 *   npx tsx scripts/collect-transactions.ts                       # all cities, both sources, only-missing
 *   npx tsx scripts/collect-transactions.ts --source nadlan
 *   npx tsx scripts/collect-transactions.ts --source govmap --force "לוד" "יבנה"
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import puppeteerCore from "puppeteer-core";
import type { Browser } from "puppeteer-core";
import { prisma } from "../lib/db";

const NADLAN_METHOD = "v9-saleflags"; // bumped: now stores hokHamecher + prevDeals, the
// authority's OWN developer-vs-resale signals. They are present on every row, while
// yearBuilt comes back as 0 on 14-46% of deals depending on the city — which left
// those cities with no new/second-hand split, and a price series that tracked the
// sale mix instead of the market.
// Changing this re-collects EVERY city once (see needsCollection) so the wider
// matrix reaches deals the old sweep missed — even cities that already met target.
const GOVMAP_METHOD = "v2-multicand";
const GOVMAP_BASE = "https://www.govmap.gov.il/api";
const SECONDHAND_MIN_AGE = 4;
const MIN_SQM = 2_000, MAX_SQM = 200_000, MIN_AREA = 20, MAX_AREA = 500;
const SECRET = "90c3e620192348f1bd46fcd9138c3c68";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const b64url = (s: string | Buffer) => Buffer.from(s as never).toString("base64url");
const unrev = (s: string) => s.split("").reverse().join("");
function b64json(s: string): Record<string, unknown> | null { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); } catch { return null; } }
function signBody(p: Record<string, unknown>): string { const h = b64url(JSON.stringify({ alg: "HS256" })), b = b64url(JSON.stringify(p)); const sig = crypto.createHmac("sha256", Buffer.from(SECRET, "utf8")).update(`${h}.${b}`).digest("base64url"); return unrev(`${h}.${b}.${sig}`); }
function decode(txt: string): unknown { const t = txt.trim(); if (t.startsWith("{")) return JSON.parse(t); try { return JSON.parse(zlib.gunzipSync(Buffer.from(t, "base64")).toString("utf8")); } catch { return null; } }
function normalizeCity(n: string | null | undefined): string { return !n ? "" : n.replace(/["'`]/g, "").replace(/[-–]/g, " ").replace(/יי/g, "י").replace(/וו/g, "ו").replace(/\s+/g, " ").trim(); }
function roomBucket(rn: number | null | undefined): string { if (rn == null || isNaN(rn)) return "other"; if (rn >= 2.5 && rn < 3.5) return "3"; if (rn >= 3.5 && rn < 4.5) return "4"; if (rn >= 4.5) return "5"; return "other"; }
function isResidential(n: string | null | undefined): boolean { if (!n) return false; if (/קבוצת רכישה|קרקע|מסחרי|משרד|חנות|חניה|מחסן|תעשיה|ללא תיכנון|מלון|דיור מוגן/.test(n)) return false; return ["דירה", "דירת גן", "דירת גג", "פנטהאוז", "קוטג'", "בית בודד", "דו משפחתי", "מיני פנטהאוז"].some((p) => n.includes(p)); }

interface DealRow { deal_date: string; deal_year: number; rooms: number | null; area: number | null; price: number | null; price_sqm: number | null; year_built: number | null; is_secondhand: number; neighborhood: string | null; cbs_code: string | null; hok_hamecher: number | null; prev_deals: number | null; }

// ── manifest ─────────────────────────────────────────────────────
async function getStatus(city: string, source: string): Promise<{ method_version: string | null; status: string; year_min: number | null; distinct_years: number | null; attempts: number | null } | null> {
  const rows = await prisma.$queryRawUnsafe<{ method_version: string | null; status: string; year_min: number | null; distinct_years: number | null; attempts: number | null }[]>(
    "SELECT method_version, status, year_min, distinct_years, attempts FROM nadlan_collection_status WHERE city_name=? AND source=?", city, source);
  return rows[0] ?? null;
}
async function upsertStatus(city: string, source: string, method: string, rows: DealRow[], status: string, note = "") {
  const years = [...new Set(rows.map((r) => r.deal_year))].sort();
  const sh = rows.filter((r) => r.is_secondhand === 1).length;
  await prisma.$executeRawUnsafe(
    `INSERT INTO nadlan_collection_status (city_name,source,n_deals,year_min,year_max,distinct_years,secondhand_n,status,method_version,attempts,last_collected,note)
     VALUES (?,?,?,?,?,?,?,?,?,1,datetime('now'),?)
     ON CONFLICT(city_name,source) DO UPDATE SET n_deals=excluded.n_deals,year_min=excluded.year_min,year_max=excluded.year_max,distinct_years=excluded.distinct_years,secondhand_n=excluded.secondhand_n,status=excluded.status,method_version=excluded.method_version,attempts=nadlan_collection_status.attempts+1,last_collected=datetime('now'),note=excluded.note`,
    city, source, rows.length, years[0] ?? null, years[years.length - 1] ?? null, years.length, sh, status, method, note);
}
async function needsCollection(city: string, source: string, method: string, force: boolean): Promise<boolean> {
  if (force) return true;
  const s = await getStatus(city, source);
  if (source === "nadlan") {
    // A wider matrix (new method version) reaches deals the old sweep couldn't —
    // so re-collect EVERY city exactly once when the method changes, even if it
    // already met the coverage target. After that pass method_version matches and
    // the normal target-met skip resumes. (Union-by-natural-key means this only
    // ADDS the newly-reachable deals; it never duplicates or loses existing ones.)
    if (s && s.method_version !== method) return true;
    // Campaign target (user rule): second-hand coverage for EVERY year 2016–2025
    // (n≥10 each). The nightly loop keeps retrying a gap city until the target is
    // met, capped at 6 total attempts per method so anonymously-unreachable
    // cities stop consuming the night after diminishing returns.
    const covered = await prisma.$queryRawUnsafe<{ c: number }[]>(
      `SELECT COUNT(*) c FROM (
         SELECT deal_year FROM nadlan_transactions
         WHERE city_name=? AND is_secondhand=1 AND deal_year BETWEEN 2016 AND 2025
         GROUP BY deal_year HAVING COUNT(*) >= 10)`, city);
    if (Number(covered[0]?.c ?? 0) >= 10) return false; // target met — full 10 years
    if (s && s.method_version === method && (s.attempts ?? 0) >= 6) return false; // exhausted
    return true;
  }
  return !(s && s.method_version === method && s.status === "ok");
}
async function saveRows(city: string, source: string, rows: DealRow[]) {
  await prisma.$executeRawUnsafe("DELETE FROM nadlan_transactions WHERE city_name=? AND source=?", city, source);
  const COLS = "city_name,cbs_code,deal_date,deal_year,rooms,room_bucket,area,price,price_sqm,year_built,is_secondhand,neighborhood,source,hok_hamecher,prev_deals";
  const CHUNK = 60;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    // placeholders are derived from COLS — hand-counted tuples silently desync
    // the moment a column is added (that is exactly how the v9 run failed)
    const ph = `(${COLS.split(",").map(() => "?").join(",")})`;
    const vs = slice.map(() => ph).join(",");
    const params: unknown[] = [];
    for (const r of slice) params.push(city, r.cbs_code, r.deal_date, r.deal_year, r.rooms, roomBucket(r.rooms), r.area, r.price, r.price_sqm, r.year_built, r.is_secondhand, r.neighborhood, source, r.hok_hamecher, r.prev_deals);
    await prisma.$executeRawUnsafe(`INSERT INTO nadlan_transactions (${COLS}) VALUES ${vs}`, ...params);
  }
}

// ── govmap (adaptive backoff, multi-candidate) ───────────────────
let govDelay = 350;
async function gf(url: string, options?: RequestInit): Promise<Response> {
  for (let a = 0; a < 4; a++) {
    try { const res = await fetch(url, { ...options, headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "RealEstateDashboard/1.0", ...(options?.headers || {}) } }); if (!res.ok) throw new Error(`Govmap ${res.status}`); govDelay = Math.max(300, govDelay - 40); return res; }
    catch (e) { govDelay = Math.min(4000, govDelay + 600); await sleep(govDelay * (a + 1)); if (a === 3) throw e; }
  }
  throw new Error("unreachable");
}
async function govmapCity(cityName: string): Promise<DealRow[]> {
  const cityKey = normalizeCity(cityName);
  const s = await (await gf(`${GOVMAP_BASE}/search-service/autocomplete`, { method: "POST", body: JSON.stringify({ searchText: cityName, language: "he", isAccurate: false, maxResults: 10 }) })).json();
  const cands = (s.results ?? []).filter((r: { type: string }) => r.type === "settlement");
  const centers: { x: number; y: number }[] = [];
  for (const r of (cands.length ? cands : (s.results ?? []).slice(0, 2))) { const m = r?.shape?.match(/POINT\(([^ ]+) ([^ ]+)\)/); if (m) centers.push({ x: Math.round(+m[1]), y: Math.round(+m[2]) }); }
  if (!centers.length) return [];
  await sleep(govDelay);
  const sweep: { x: number; y: number }[] = [];
  for (const c of centers) { sweep.push(c); for (const rr of [2000, 4000, 6000]) for (let a = 0; a < 360; a += 45) { const rad = (a * Math.PI) / 180; sweep.push({ x: Math.round(c.x + rr * Math.cos(rad)), y: Math.round(c.y + rr * Math.sin(rad)) }); } }
  const polys = new Map<string, number>();
  for (const pt of sweep) { try { const arr: { polygon_id: string; dealscount: string; settlementNameHeb: string }[] = await (await gf(`${GOVMAP_BASE}/real-estate/deals/${pt.x},${pt.y}/2500`)).json(); for (const p of arr ?? []) if (+p.dealscount > 0 && normalizeCity(p.settlementNameHeb) === cityKey && !polys.has(p.polygon_id)) polys.set(p.polygon_id, +p.dealscount); } catch { /* */ } await sleep(govDelay); }
  const picked = [...polys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 45).map((e) => e[0]);
  const seen = new Set<string>(); const out: DealRow[] = [];
  for (const pid of picked) for (const [s0, e0] of [["2015-01", "2020-06"], ["2020-06", "2026-12"]] as const) {
    try { const d: { data?: Record<string, unknown>[] } = await (await gf(`${GOVMAP_BASE}/real-estate/neighborhood-deals/${pid}?limit=2000&startDate=${s0}&endDate=${e0}`)).json();
      for (const deal of d.data ?? []) { if (normalizeCity(deal.settlementNameHeb as string) !== cityKey || !isResidential(deal.dealNatureDescription as string)) continue; const key = String(deal.dealId ?? `${deal.dealDate}-${deal.dealAmount}`); if (seen.has(key)) continue; seen.add(key); const area = (deal.assetArea as number) ?? 0, price = (deal.dealAmount as number) ?? 0, sqm = area > 0 ? price / area : 0, dy = Number(String(deal.dealDate).slice(0, 4)); if (dy > 1990 && area >= MIN_AREA && area <= MAX_AREA && sqm >= MIN_SQM && sqm <= MAX_SQM) out.push({ deal_date: String(deal.dealDate).slice(0, 10), deal_year: dy, rooms: (deal.assetRoomNum as number) ?? null, area, price, price_sqm: Math.round(sqm), year_built: null, is_secondhand: 0, neighborhood: (deal.neighborhood as string) ?? null, cbs_code: deal.settlementId ? String(deal.settlementId) : null, hok_hamecher: null, prev_deals: null }); }
    } catch { /* */ } await sleep(govDelay);
  }
  return out;
}

// ── nadlan (per-room, build year) ────────────────────────────────
interface RawItem { dealDate?: string; dealAmount?: number; roomNum?: number; assetArea?: number; yearBuilt?: number; priceSM?: number; neighborhoodName?: string; hokHamecher?: number; prevDeals?: unknown[]; }
/**
 * Balanced per-year collection (the user's algorithm): for each room (3/4/5) × second-hand
 * filter × BOTH sort directions (newest-first + oldest-first), pull the 2 allowed chunks.
 * dealDate_up reaches the OLD years, dealDate_down the recent ones — so every year fills toward
 * ~100 up to nadlan's 1,000/query cap. Fresh token every ~6 queries (page reload). Deduped by
 * date|amount|area|rooms. (Big cities keep an unavoidable middle-year gap = the API limit.)
 */
async function nadlanCity(browser: Browser, city: string, code: string, missingYears: number[] = []): Promise<DealRow[]> {
  const all = new Map<string, RawItem>();
  const addItems = (items: RawItem[]) => { for (const d of items) { if (!d.dealDate || !d.dealAmount) continue; const k = `${d.dealDate}|${d.dealAmount}|${d.assetArea}|${d.roomNum}`; if (!all.has(k)) all.set(k, d); } };
  let page: import("puppeteer-core").Page | null = null;
  let p1: Record<string, unknown> | null = null;
  let lastPost = ""; // rolling: most recent deal-data POST body (SPA view swaps mint fresh tokens — v5 harvests them)
  let qOnToken = 0;
  const parsePost = (s: string): Record<string, unknown> | null => { try { return s ? b64json(unrev(JSON.parse(s)["##"]).split(".")[1]) : null; } catch { return null; } };
  const waitPost = async (): Promise<string> => { for (let w = 0; w < 12 && !lastPost; w++) await sleep(1800); return lastPost; };
  const openFreshToken = async (): Promise<boolean> => {
    if (page) await page.close().catch(() => {});
    page = await browser.newPage();
    page.on("request", (rq) => { if (/\/deal-data/.test(rq.url()) && rq.method() === "POST") lastPost = rq.postData() || lastPost; });
    page.on("response", async (r) => { if (!/\/deal-data/.test(r.url())) return; try { const d = decode(await r.text()) as { data?: { items?: RawItem[] } }; if (d?.data?.items?.length) addItems(d.data.items); } catch { /* */ } });
    lastPost = "";
    await page.goto(`https://www.nadlan.gov.il/?view=settlement&id=${code}&page=deals`, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
    p1 = parsePost(await waitPost());
    qOnToken = 0;
    return !!(p1?.sk && p1?.token);
  };
  /** sign + POST one query on an arbitrary harvested token; returns counts + year span for skip/saturation logic. */
  const runQ = async (tok: Record<string, unknown>, extra: Record<string, unknown>): Promise<{ n: number; added: number; minY: number; maxY: number }> => {
    const before = all.size;
    const now = Math.floor(Date.now() / 1000);
    const body = signBody({ base_id: tok.base_id, base_name: tok.base_name, sk: tok.sk, token: tok.token, exp: now + 110, domain: "www.nadlan.gov.il", ...extra });
    const res = await page!.evaluate(async (bs) => { const r = await fetch("https://api.nadlan.gov.il/deal-data", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ "##": bs }), redirect: "follow" }).catch(() => null); return r ? await r.text() : ""; }, body).catch(() => "");
    let n = 0, minY = 9999, maxY = 0;
    try {
      const d = decode(String(res)) as { data?: { items?: RawItem[] } } | null;
      const its = d?.data?.items ?? [];
      n = its.length; addItems(its);
      for (const it of its) { const y = Number(String(it.dealDate).slice(0, 4)); if (y > 1990) { if (y < minY) minY = y; if (y > maxY) maxY = y; } }
    } catch { /* */ }
    await sleep(rnd(350, 1100));
    return { n, added: all.size - before, minY, maxY };
  };
  const fetchQ = async (extra: Record<string, unknown>) => {
    if (!p1 || qOnToken >= 6) { if (!(await openFreshToken())) return; }
    qOnToken++;
    await runQ(p1!, extra);
  };
  // ── v5 neighborhoods machinery ─────────────────────────────────
  const MAX_NEIGH = 50; // visit ALL neighborhoods of even the biggest cities — each
                        // neighborhood view is its own ≤1,000 window, so more
                        // neighborhoods = far more distinct deals (TLV has ~146k at
                        // source vs the ~10k a capped sweep reached).
  const clickNeigh = async (name: string): Promise<Record<string, unknown> | null> => {
    lastPost = "";
    const clicked = await page!.evaluate((nm) => {
      const btn = [...document.querySelectorAll(".otherNeighborhoods button.nav-button1")].find((b) => (b.textContent || "").trim() === nm) as HTMLElement | undefined;
      if (!btn) return false; btn.click(); return true;
    }, name).catch(() => false);
    if (!clicked) return null;
    for (let w = 0; w < 12; w++) { // poll the rolling buffer until the NEIGHBORHOOD's own token shows up
      await sleep(1800);
      const pN = parsePost(lastPost);
      if (pN?.sk && pN.base_name === "neighborhoodId") return pN;
    }
    return null;
  };
  const backToSettlement = async (): Promise<boolean> => {
    await page!.goBack({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
    await sleep(rnd(1500, 2500));
    if (/view=settlement/.test(page!.url())) return true;
    return openFreshToken(); // SPA back failed → full settlement reload (fresh strip)
  };
  /** one direction on one token: fetch 1, and fetch 2 only when the window is full (n=500). */
  const runDirection = async (tok: Record<string, unknown>, base: Record<string, unknown>, order: string) => {
    const r1 = await runQ(tok, { ...base, type_order: order, fetch_number: 1 });
    let r2 = { n: 0, added: 0, minY: 9999, maxY: 0 };
    if (r1.n === 500) r2 = await runQ(tok, { ...base, type_order: order, fetch_number: 2 });
    return { full: r1.n === 500 && r2.n === 500, minY: Math.min(r1.minY, r2.minY), maxY: Math.max(r1.maxY, r2.maxY) };
  };
  const visitNeighborhood = async (name: string): Promise<void> => {
    const pN = await clickNeigh(name);
    if (!pN) { await backToSettlement(); return; }
    // base pass: hok_hamecher=0 (second-hand pool), both directions × ≤2 chunks = ≤4 queries on this token.
    const down = await runDirection(pN, { hok_hamecher: "0" }, "dealDate_down");
    const up = await runDirection(pN, { hok_hamecher: "0" }, "dealDate_up");
    // mega-neighborhood still saturated with a middle gap → per-room refinement (fresh token per direction re-entry).
    if (down.full && up.full && down.minY > up.maxY) {
      for (const order of ["dealDate_down", "dealDate_up"]) {
        if (!(await backToSettlement())) return;
        const pR = await clickNeigh(name);
        if (!pR) break;
        for (const room of ["3", "4", "5"]) await runDirection(pR, { hok_hamecher: "0", room_num: room }, order); // ≤6 q/token
      }
    }
    await backToSettlement();
  };
  const neighborhoodsPass = async (): Promise<void> => {
    if (!(await openFreshToken())) return; // fresh settlement view — the neighborhoods strip lives there
    const names: string[] = await page!.evaluate(() =>
      [...document.querySelectorAll(".otherNeighborhoods button.nav-button1")].map((b) => (b.textContent || "").trim()).filter((t) => t.length > 0)
    ).catch(() => []);
    if (!names.length) return;
    // rank by deal counts already harvested this run (v4 passes fill `all` with neighborhoodName) — biggest pools first.
    const counts = new Map<string, number>();
    for (const it of all.values()) { const nm = (it.neighborhoodName || "").trim(); if (nm) counts.set(nm, (counts.get(nm) ?? 0) + 1); }
    const ranked = [...new Set(names)].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0)).slice(0, MAX_NEIGH);
    const before = all.size;
    for (const name of ranked) {
      try { await visitNeighborhood(name); } catch { /* next neighborhood */ }
      if (!/view=settlement/.test(page!.url()) && !(await openFreshToken())) return; // need the strip for the next click
    }
    console.log(`   ↳ v5 neighborhoods: visited=${ranked.length} uniq+=${all.size - before}`);
  };
  try {
    if (await openFreshToken()) {
      // ALL room buckets (was 3/4/5 only — 1/2/6 apartments were entirely missing)
      // × BOTH sort directions × 2 chunks. Each room_num filter is its own window.
      for (const room of ["1", "2", "3", "4", "5", "6"]) for (const order of ["dealDate_down", "dealDate_up"]) {
        await fetchQ({ room_num: room, type_order: order, fetch_number: 1 });
        await fetchQ({ room_num: room, type_order: order, fetch_number: 2 });
      }
      // v4: secondhand-targeted combos — hok_hamecher=0 spreads the 500-window over
      // second-hand deals only, and deal_date=60 anchors a 5-year window so
      // dealDate_up starts ~5y back (reaches 2021–2023, unreachable otherwise).
      for (const room of ["3", "4", "5"]) {
        for (const extra of [
          { hok_hamecher: "0", room_num: room, type_order: "dealDate_down" },
          { hok_hamecher: "0", room_num: room, type_order: "dealDate_up" },
          { hok_hamecher: "0", room_num: room, type_order: "dealDate_up", deal_date: "60" },
        ] as Record<string, unknown>[]) {
          await fetchQ({ ...extra, fetch_number: 1 });
          await fetchQ({ ...extra, fetch_number: 2 });
        }
      }
      // v7: DEEP-YEARS pass — deal_date=N is a months-back horizon; pairing long horizons
      // with the ASCENDING sort makes each 500-window start at the OLDEST deals inside the
      // horizon, reaching 2016–2020 in cities whose default windows only surface 2023+.
      // (Dedup by natural key absorbs the overlap in already-deep cities.)
      for (const months of ["120", "96", "72"]) {
        for (const extra of [
          { type_order: "dealDate_up", deal_date: months },
          { hok_hamecher: "0", type_order: "dealDate_up", deal_date: months },
        ] as Record<string, unknown>[]) {
          await fetchQ({ ...extra, fetch_number: 1 });
          await fetchQ({ ...extra, fetch_number: 2 });
        }
      }
      // v8: YEAR-FILL pass — a DEDICATED horizon per missing year. In big cities every
      // generic window saturates with 500 deals of one recent year, so mid-years
      // (2018-2021) stay under the display threshold. deal_date=(now−Y)·12+6 months
      // with the ASCENDING sort starts the 500-window at year Y itself.
      if (missingYears.length) {
        const nowY = new Date().getFullYear();
        for (const y of missingYears) {
          const H = String((nowY - y) * 12 + 6);
          for (const extra of [
            { type_order: "dealDate_up", deal_date: H },
            { hok_hamecher: "0", type_order: "dealDate_up", deal_date: H },
          ] as Record<string, unknown>[]) {
            await fetchQ({ ...extra, fetch_number: 1 });
            await fetchQ({ ...extra, fetch_number: 2 });
          }
        }
        console.log(`   ↳ v8 year-fill: targeted ${missingYears.join(",")}`);
      }
      // v5: NEIGHBORHOOD pass — per-neighborhood pools beat the anonymous ~1,000-deal window,
      // reaching 15–20+ year second-hand history (each neighborhood view mints its own token).
      await neighborhoodsPass();
    }
  } finally { if (page) await page.close().catch(() => {}); }
  const out: DealRow[] = [];
  for (const d of all.values()) { const dy = Number(String(d.dealDate).slice(0, 4)); if (dy <= 1990) continue; const yb = Number(d.yearBuilt) || null; out.push({ deal_date: String(d.dealDate).slice(0, 10), deal_year: dy, rooms: d.roomNum ?? null, area: d.assetArea ?? null, price: d.dealAmount ?? null, price_sqm: d.priceSM ?? null, year_built: yb, is_secondhand: yb && dy - yb >= SECONDHAND_MIN_AGE ? 1 : 0, neighborhood: d.neighborhoodName ?? null, cbs_code: code,
    // The authority publishes yearBuilt as 0 for a real share of deals (30% in
    // Tirat Karmel, 46% in Akko), which left those cities with no new/second-hand
    // split at all — and a price trend without that split just tracks the mix.
    // These two fields are present on EVERY row and carry the same information:
    // hokHamecher = the Sale Law, which only governs a purchase from a developer;
    // prevDeals = the asset's earlier sales, so a non-empty list means it changed
    // hands before. Stored raw here; the classification itself is derived later.
    hok_hamecher: d.hokHamecher == null ? null : Number(d.hokHamecher),
    prev_deals: Array.isArray(d.prevDeals) ? d.prevDeals.length : null }); }
  return out;
}

// ── main ─────────────────────────────────────────────────────────
function cityCodeMap(): Map<string, string> { const j = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/city_cbs_codes.json"), "utf8")) as Record<string, number>; return new Map(Object.entries(j).map(([k, v]) => [k.trim(), String(v)])); }

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const srcArg = (argv[argv.indexOf("--source") + 1] && argv.includes("--source")) ? argv[argv.indexOf("--source") + 1] : "all";
  const doNadlan = srcArg === "all" || srcArg === "nadlan";
  const doGovmap = srcArg === "all" || srcArg === "govmap";
  const names = argv.filter((a) => !a.startsWith("--") && a !== srcArg);
  const codes = cityCodeMap();
  let cities = names.length ? names : (await prisma.city.findMany({ select: { city_name: true }, orderBy: { population_2026: "desc" } })).map((c) => c.city_name);
  // per-city MISSING years (2016..lastFullYear with <10 active nadlan deals) — these
  // drive the v8 year-fill pass and force re-collection even when method matches.
  const nowY = new Date().getFullYear();
  const minTargetY = nowY - 10, maxTargetY = nowY - 1;
  const covered = await prisma.$queryRawUnsafe<{ city_name: string; deal_year: number }[]>(
    `SELECT city_name, deal_year FROM nadlan_transactions
     WHERE COALESCE(excluded,0)=0 AND source='nadlan' AND deal_year BETWEEN ${minTargetY} AND ${maxTargetY}
     GROUP BY city_name, deal_year HAVING COUNT(*)>=10`);
  const coveredBy = new Map<string, Set<number>>();
  for (const r of covered) { let s = coveredBy.get(r.city_name); if (!s) { s = new Set(); coveredBy.set(r.city_name, s); } s.add(Number(r.deal_year)); }
  const missingOf = (city: string): number[] => {
    const have = coveredBy.get(city);
    if (!have) return []; // no nadlan data at all → the base+v7 passes handle it, no point targeting
    const miss: number[] = [];
    for (let y = minTargetY; y <= maxTargetY; y++) if (!have.has(y)) miss.push(y);
    return miss;
  };
  if (!names.length && doNadlan) {
    // gap cities FIRST — cities missing years get the nightly time budget first.
    cities = [...cities].sort((a, b) => missingOf(b).length - missingOf(a).length);
  }

  console.log(`\n=== collect-transactions — ${cities.length} cities · source=${srcArg}${force ? " --force" : ""} ===`);
  let browser: Browser | null = null;
  const ensureBrowser = async (): Promise<Browser> => {
    if (browser && browser.connected) return browser;
    browser = await puppeteerCore.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
    return browser;
  };

  const stats = { gvOk: 0, gvSkip: 0, gvEmpty: 0, ndOk: 0, ndSkip: 0, ndEmpty: 0, err: 0 };
  // Nightly time budget: stop STARTING new cities after this many minutes so a full
  // re-collect (all 168 cities on a method bump) never spills into the user's workday.
  // Resumable — cities left with the old method_version are picked up the next night.
  // Override with MAX_RUNTIME_MIN; 0/unset on a manual/explicit-city run = no limit.
  const budgetMin = Number(process.env.MAX_RUNTIME_MIN ?? (names.length ? 0 : 240));
  const startedAt = Date.now();
  for (let i = 0; i < cities.length; i++) {
    if (budgetMin > 0 && (Date.now() - startedAt) / 60000 > budgetMin) {
      console.log(`⏳ time budget (${budgetMin}m) reached — stopping after ${i}/${cities.length}. Rest resume next run.`);
      break;
    }
    const city = cities[i]; const code = codes.get(city);
    const tag = `[${i + 1}/${cities.length}] ${city}`;
    // govmap
    if (doGovmap) {
      if (!(await needsCollection(city, "govmap", GOVMAP_METHOD, force))) { stats.gvSkip++; }
      else try { const rows = await govmapCity(city); if (rows.length) { await saveRows(city, "govmap", rows); await upsertStatus(city, "govmap", GOVMAP_METHOD, rows, "ok"); const ys = [...new Set(rows.map((r) => r.deal_year))].sort(); console.log(`${tag} govmap: ${rows.length} deals ${ys[0]}–${ys[ys.length - 1]}`); stats.gvOk++; } else { await upsertStatus(city, "govmap", GOVMAP_METHOD, [], "empty"); console.log(`${tag} govmap: EMPTY`); stats.gvEmpty++; } }
      catch (e) { await upsertStatus(city, "govmap", GOVMAP_METHOD, [], "error", String(e instanceof Error ? e.message : e)); console.log(`${tag} govmap: ERROR`); stats.err++; }
    }
    // nadlan (needs a CBS code + Chrome)
    if (doNadlan && code) {
      const missing = missingOf(city);
      // a city with missing years is ALWAYS re-collected (year-fill), even if its
      // method_version matches — that's the whole "10 years in every city" goal.
      if (!missing.length && !(await needsCollection(city, "nadlan", NADLAN_METHOD, force))) { stats.ndSkip++; }
      else {
        if (missing.length) console.log(`${tag} nadlan: year-fill for ${missing.join(",")}`);
        for (let attempt = 0; attempt < 2; attempt++) {
          try { const b = await ensureBrowser(); const collected = await nadlanCity(b, city, code, missing);
            // v4 merges with existing nadlan rows (never lose prior years) — union by natural key.
            const existing = await prisma.$queryRawUnsafe<DealRow[]>(
              "SELECT deal_date, deal_year, rooms, area, price, price_sqm, year_built, is_secondhand, neighborhood, cbs_code FROM nadlan_transactions WHERE city_name=? AND source='nadlan'", city);
            const seenK = new Set(existing.map((r) => `${r.deal_date}|${r.price}|${r.area}|${r.rooms}`));
            const fresh = collected.filter((r) => !seenK.has(`${r.deal_date}|${r.price}|${r.area}|${r.rooms}`));
            const rows = [...existing, ...fresh];
            if (rows.length) { await saveRows(city, "nadlan", rows); await upsertStatus(city, "nadlan", NADLAN_METHOD, rows, "ok"); const ys = [...new Set(rows.map((r) => r.deal_year))].sort(); console.log(`${tag} nadlan: +${fresh.length} new → ${rows.length} total ${ys[0]}–${ys[ys.length - 1]} (${rows.filter((r) => r.is_secondhand).length} 2nd)`); stats.ndOk++; } else { await upsertStatus(city, "nadlan", NADLAN_METHOD, [], "empty"); stats.ndEmpty++; } break; }
          catch (e) { const msg = String(e instanceof Error ? e.message : e); if (/Connection closed|Target closed|disconnected/i.test(msg) && attempt === 0) { browser = null; await sleep(1500); continue; } await upsertStatus(city, "nadlan", NADLAN_METHOD, [], "error", msg); console.log(`${tag} nadlan: ERROR — ${msg.slice(0, 40)}`); stats.err++; break; }
        }
      }
      await sleep(rnd(2500, 5000));
    }
  }
  if (browser?.connected) await browser.disconnect().catch(() => {});
  console.log(`\n--- Done. govmap ok=${stats.gvOk} skip=${stats.gvSkip} empty=${stats.gvEmpty} | nadlan ok=${stats.ndOk} skip=${stats.ndSkip} empty=${stats.ndEmpty} | err=${stats.err} ---`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
