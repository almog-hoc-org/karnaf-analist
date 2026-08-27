#!/usr/bin/env tsx
/**
 * ROUND-ROBIN year-fill for a single city (user spec):
 * collect up to TARGET_PER_YEAR deals for a year, then move to the NEXT year,
 * and loop back for another round until every year is filled (or rounds run out).
 *
 * Why: the anonymous nadlan deal-data window returns ≤500 rows per query and the
 * generic passes saturate on recent years, leaving mid-years (e.g. Lod 2020-2023 = 0)
 * empty. Anchoring each query to ONE year (deal_date = months-back horizon, ascending
 * sort) makes that year the start of its own window.
 *
 * Requires the debuggable Chrome on 127.0.0.1:9222 (reCAPTCHA-blessed session), the
 * same one the nightly job launches hidden in the corner.
 *
 * Usage: npx tsx scripts/fill-city-years.ts "לוד" [--years 2020,2021,2022,2023] [--target 100] [--rounds 3]
 */
import crypto from "crypto";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import puppeteerCore from "puppeteer-core";
import type { Browser, Page } from "puppeteer-core";
import { prisma } from "../lib/db";
import { extractAddress } from "../lib/nadlanAddress";

const SECRET = "90c3e620192348f1bd46fcd9138c3c68";
const SECONDHAND_MIN_AGE = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => Math.floor(a + Math.random() * (b - a));
const unrev = (s: string) => s.split("").reverse().join("");
const b64url = (s: string | Buffer) => Buffer.from(s as never).toString("base64url");
function signBody(p: Record<string, unknown>): string {
  const h = b64url(JSON.stringify({ alg: "HS256" })), b = b64url(JSON.stringify(p));
  const sig = crypto.createHmac("sha256", Buffer.from(SECRET, "utf8")).update(`${h}.${b}`).digest("base64url");
  return unrev(`${h}.${b}.${sig}`);
}
function b64json(s: string): Record<string, unknown> | null {
  s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); } catch { return null; }
}
function decode(txt: string): unknown {
  const t = txt.trim(); if (t.startsWith("{")) return JSON.parse(t);
  try { return JSON.parse(zlib.gunzipSync(Buffer.from(t, "base64")).toString("utf8")); } catch { return null; }
}
interface RawItem { dealDate?: string; dealAmount?: number; roomNum?: number; assetArea?: number; priceSM?: number; yearBuilt?: number; neighborhoodName?: string; [k: string]: unknown }

async function main() {
  const argv = process.argv.slice(2);
  const city = argv.find((a) => !a.startsWith("--"));
  if (!city) { console.error('usage: fill-city-years.ts "עיר" [--years 2020,2021] [--target 100] [--rounds 3]'); process.exit(1); }
  const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const target = Number(arg("--target") ?? 100);
  const rounds = Number(arg("--rounds") ?? 3);
  const codes = JSON.parse(fs.readFileSync(path.resolve("data/city_cbs_codes.json"), "utf8")) as Record<string, number>;
  const code = String(codes[city.trim()] ?? "");
  if (!code) { console.error(`no CBS code for ${city}`); process.exit(1); }

  const nowY = new Date().getFullYear();
  const explicit = arg("--years")?.split(",").map((s) => Number(s.trim())).filter(Boolean);
  const have = await prisma.$queryRawUnsafe<{ deal_year: number; n: bigint }[]>(
    `SELECT deal_year, COUNT(*) n FROM nadlan_transactions
     WHERE city_name=? AND source='nadlan' AND COALESCE(excluded,0)=0 AND deal_year BETWEEN ? AND ?
     GROUP BY deal_year`, city, nowY - 10, nowY - 1);
  const countBy = new Map(have.map((r) => [Number(r.deal_year), Number(r.n)]));
  const years = explicit ?? Array.from({ length: 10 }, (_, i) => nowY - 10 + i).filter((y) => (countBy.get(y) ?? 0) < target);
  if (!years.length) { console.log(`${city}: all years already ≥ ${target} deals — nothing to fill.`); await prisma.$disconnect(); return; }
  console.log(`fill-city-years: ${city} (code ${code}) · years ${years.join(",")} · target ${target}/year · ${rounds} rounds`);

  const browser: Browser = await puppeteerCore.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
  const page: Page = await browser.newPage();
  // NEVER leave a gov-login window on the user's screen: the tab we opened is
  // closed in `finally` even when a quota error aborts mid-run, and
  // --close-chrome (or KARNAF_CLOSE_CHROME=1) also quits the :9222 Chrome
  // (for wrappers that launched it just for this run).
  const closeChrome = argv.includes("--close-chrome") || process.env.KARNAF_CLOSE_CHROME === "1";
  const cleanup = () => {
    if (closeChrome) {
      try { execSync('pkill -f -- "--remote-debugging-port=9222"'); } catch { /* not running */ }
    }
  };
  const all = new Map<string, RawItem>();
  let lastPost = "";
  // the SPA signs deal-info / deal-data / deal-list with the SAME session token — any of them works
  page.on("request", (r) => {
    if (r.method() !== "POST" || !r.url().includes("api.nadlan.gov.il")) return;
    if (!/deal-(data|info|list)/.test(r.url())) return;
    const d = r.postData(); if (d) lastPost = d;
  });

  const harvest = async (): Promise<Record<string, unknown> | null> => {
    lastPost = "";
    await page.goto(`https://www.nadlan.gov.il/?view=settlement&id=${code}&page=deals`, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
    await sleep(2500);
    // the SPA only fires /deal-data once the "עסקאות" tab is actually opened
    for (let attempt = 0; attempt < 3 && !lastPost; attempt++) {
      await page.evaluate(() => {
        const hit = [...document.querySelectorAll("button,a,div,span")]
          .find((el) => /^\s*עסקאות\s*$/.test((el.textContent || "").trim()) && (el as HTMLElement).offsetParent !== null);
        (hit as HTMLElement | undefined)?.click();
      }).catch(() => {});
      for (let i = 0; i < 20 && !lastPost; i++) await sleep(400);
    }
    if (!lastPost) return null;
    const raw = lastPost.replace(/^"|"$/g, "");
    const parts = unrev(raw).split(".");
    const p = parts.length >= 2 ? b64json(parts[1]) : null;
    return p?.sk && p?.token ? p : null;
  };

  const runQ = async (tok: Record<string, unknown>, extra: Record<string, unknown>): Promise<{ n: number; added: number }> => {
    const now = Math.floor(Date.now() / 1000);
    const body = signBody({ base_id: tok.base_id, base_name: tok.base_name, sk: tok.sk, token: tok.token, exp: now + 110, domain: "www.nadlan.gov.il", ...extra });
    const txt: string = await page.evaluate(async (b: string) => {
      const r = await fetch("https://api.nadlan.gov.il/deal-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
      return await r.text();
    }, body).catch(() => "");
    const data = decode(txt) as { AllResults?: RawItem[]; allResults?: RawItem[] } | null;
    const items = data?.AllResults ?? data?.allResults ?? [];
    let added = 0;
    for (const it of items) {
      const k = `${it.dealDate}|${it.dealAmount}|${it.assetArea}|${it.roomNum}`;
      if (!all.has(k)) { all.set(k, it); added++; }
    }
    return { n: items.length, added };
  };

  const yearCount = (y: number) => [...all.values()].filter((it) => Number(String(it.dealDate).slice(0, 4)) === y).length + (countBy.get(y) ?? 0);

  try {
    let tok = await harvest();
    if (!tok) throw new Error("could not harvest a session token — is the debuggable Chrome open on :9222?");

    for (let round = 1; round <= rounds; round++) {
      let progressed = false;
      for (const y of years) {
        if (yearCount(y) >= target) continue;
        // deal_date = months-back horizon anchoring THIS year; ascending sort starts the window at it
        const H = String((nowY - y) * 12 + 6);
        const before = all.size;
        for (const extra of [
          { type_order: "dealDate_up", deal_date: H },
          { hok_hamecher: "0", type_order: "dealDate_up", deal_date: H },
          { type_order: "dealDate_down", deal_date: String((nowY - y) * 12) },
        ] as Record<string, unknown>[]) {
          for (const fetch_number of [1, 2]) {
            const r = await runQ(tok!, { ...extra, fetch_number });
            await sleep(rnd(700, 1400));
            if (r.n === 0) { tok = (await harvest()) ?? tok; break; } // token expired → refresh
            if (r.n < 500) break; // window exhausted
          }
          if (yearCount(y) >= target) break;
        }
        const gained = all.size - before;
        if (gained > 0) progressed = true;
        console.log(`  round ${round} · ${y}: +${gained} (year total ≈ ${yearCount(y)})`);
        tok = (await harvest()) ?? tok; // fresh token between years
      }
      if (!progressed) { console.log(`  round ${round}: no new deals — stopping early.`); break; }
    }
  } catch (e) {
    // don't lose what was already gathered — persist below, then report failure
    console.error("run aborted:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    // runs on success AND on any mid-run error (quota, token, navigation)
    await page.close().catch(() => {});
    try { browser.disconnect(); } catch { /* already gone */ }
    cleanup();
  }

  // persist (union with existing, natural-key dedup)
  const rows = [...all.values()].map((d) => {
    const dy = Number(String(d.dealDate).slice(0, 4));
    const yb = Number(d.yearBuilt) || null;
    return { deal_date: String(d.dealDate).slice(0, 10), deal_year: dy, rooms: d.roomNum ?? null, area: d.assetArea ?? null,
      price: d.dealAmount ?? null, price_sqm: d.priceSM ?? null, year_built: yb,
      is_secondhand: yb && dy - yb >= SECONDHAND_MIN_AGE ? 1 : 0, neighborhood: d.neighborhoodName ?? null,
      // Defensive, same as the nightly collector: the address field's real
      // name is confirmed by the raw-keys log, absent fields store NULL.
      ...extractAddress(d as Record<string, unknown>, city) };
  }).filter((r) => r.deal_year > 1990 && r.price && r.area);

  const existing = await prisma.$queryRawUnsafe<{ k: string }[]>(
    "SELECT deal_date || '|' || price || '|' || area || '|' || COALESCE(rooms,'') k FROM nadlan_transactions WHERE city_name=? AND source='nadlan'", city);
  const seen = new Set(existing.map((r) => r.k));
  const fresh = rows.filter((r) => !seen.has(`${r.deal_date}|${r.price}|${r.area}|${r.rooms ?? ""}`));
  const CH = 60;
  for (let i = 0; i < fresh.length; i += CH) {
    const slice = fresh.slice(i, i + CH);
    const vs = slice.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
    const params: unknown[] = [];
    for (const r of slice) params.push(city, code, r.deal_date, r.deal_year, r.rooms,
      r.rooms == null ? "other" : r.rooms >= 5 ? "5" : r.rooms >= 3.5 ? "4" : r.rooms >= 2.5 ? "3" : "other",
      r.area, r.price, r.price_sqm, r.year_built, r.is_secondhand, r.neighborhood, r.street, r.houseNum, "nadlan");
    await prisma.$executeRawUnsafe(
      `INSERT INTO nadlan_transactions (city_name,cbs_code,deal_date,deal_year,rooms,room_bucket,area,price,price_sqm,year_built,is_secondhand,neighborhood,street,house_num,source) VALUES ${vs}`, ...params);
  }
  const per = new Map<number, number>();
  for (const r of fresh) per.set(r.deal_year, (per.get(r.deal_year) ?? 0) + 1);
  console.log(`  saved ${fresh.length} NEW deals: ${[...per.entries()].sort((a, b) => a[0] - b[0]).map(([y, n]) => `${y}:+${n}`).join(" ")}`);
  await prisma.$disconnect();
}
// exitCode (not process.exit) so the finally-cleanup above always finishes first
main().catch((e) => { console.error("FATAL", e instanceof Error ? e.message : e); process.exitCode = 1; });
