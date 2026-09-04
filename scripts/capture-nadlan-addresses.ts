#!/usr/bin/env tsx
/**
 * THE NADLAN ADDRESS CAMPAIGN — Mac half: capture one city's deals, with
 * their addresses, from nadlan.gov.il into a JSON file.
 *
 * WHY. Measured 4.9.2026: 807k rows in nadlan_transactions have no street,
 * every one of them from the nadlan channel, and the site's own deal-data
 * response carries `address`, `parcelNum` (gush-helka), `floor`,
 * `buildingFloors` for every deal. The history was collected before the
 * collector read those fields. This re-walks the feed and the server half
 * (scripts/backfill-nadlan-addresses.ts) donates the fields onto the rows
 * that exist — UPDATE only, never insert.
 *
 * HOW THE WINDOW IS WALKED (lib/nadlanCapture.ts sliceQueries). An
 * anonymous session sees ≤500 items per fetch_number, two fetches per
 * query. Each query is one window shaped by the page's own filters: a
 * date horizon in months back, ascending or descending, and a room count.
 * Year × direction × rooms gives ~8 windows per year per base; a stopped
 * run resumes from the file's `slicesDone`. Neighbourhood pages are TRIED
 * first: if a neighbourhood's page yields its own token, every
 * neighbourhood becomes its own base and the same slices reach ~10× more
 * deals in a big city. The file records what was measured.
 *
 * MANNERS. The page's own token, the page's own query shapes, 0.7–1.4 s
 * between requests, a hard stop on 401 / the user-limit modal. Nothing
 * here mints a token or exceeds what the page grants a visitor.
 *
 * Usage (needs the debuggable Chrome on :9222 — scripts/bootstrap_nadlan_chrome.sh):
 *   npx tsx scripts/capture-nadlan-addresses.ts "תל אביב-יפו" --out=data/nadlan_addr
 *   [--years 2010,2011] [--from-year 2000] [--budget-min 30] [--no-hoods] [--force]
 */
import fs from "fs";
import path from "path";
import puppeteerCore from "puppeteer-core";
import type { Browser, Page } from "puppeteer-core";
import { buildFetchBody, buildQueryPayload, DEAL_DATA_HEADERS, decodeDealData, parseHarvestedPost, responseItems, responseMeta, signBody, type NadlanToken } from "../lib/nadlanSession";
import { mergeItems, sliceQueries, yearSpan, type CaptureFile, type RawItem } from "../lib/nadlanCapture";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => Math.floor(a + Math.random() * (b - a));

export function cityFileName(city: string): string {
  return city.replace(/[^֐-׿A-Za-z0-9-]+/g, "_");
}

class BlockedError extends Error {}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  // positional = not a flag and not the value of a preceding "--flag value"
  const VALUE_FLAGS = new Set(["--out", "--years", "--from-year", "--budget-min"]);
  const cityName = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && VALUE_FLAGS.has(argv[i - 1])));
  if (!cityName) { console.error('usage: capture-nadlan-addresses.ts "עיר" --out=data/nadlan_addr [--years 2010,2011] [--budget-min 30]'); return 1; }
  const outDir = arg("out") ?? "data/nadlan_addr";
  const budgetMin = Number(arg("budget-min") ?? process.env.KARNAF_NADLAN_BUDGET_MIN ?? 0);
  const noHoods = argv.includes("--no-hoods");
  const force = argv.includes("--force");
  const nowY = new Date().getFullYear();
  const fromYear = Number(arg("from-year") ?? 2000);
  const years = arg("years")?.split(",").map((s) => Number(s.trim())).filter(Boolean)
    ?? Array.from({ length: nowY - fromYear + 1 }, (_, i) => fromYear + i);

  const codes = JSON.parse(fs.readFileSync(path.resolve("data/city_cbs_codes.json"), "utf8")) as Record<string, number>;
  const code = String(codes[cityName.trim()] ?? "");
  if (!code) { console.error(`אין קוד למ"ס ל-${cityName} ב-data/city_cbs_codes.json`); return 1; }

  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${cityFileName(cityName)}.json`);
  let cap: CaptureFile = { city: cityName, cbsCode: code, capturedAt: new Date().toISOString(), neighborhoodWindow: null, slicesDone: [], items: [] };
  if (!force && fs.existsSync(file)) {
    try { cap = JSON.parse(fs.readFileSync(file, "utf8")) as CaptureFile; } catch { /* start over */ }
    if (!Array.isArray(cap.slicesDone)) cap.slicesDone = [];
    if (!Array.isArray(cap.items)) cap.items = [];
    // a file with windows "done" but nothing in them is a failed run, not progress
    if (cap.items.length === 0) cap.slicesDone = [];
  }
  const done = new Set(cap.slicesDone);
  const save = () => {
    cap.capturedAt = new Date().toISOString();
    cap.slicesDone = [...done];
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(cap));
    fs.renameSync(`${file}.tmp`, file);
  };

  const t0 = Date.now();
  const overBudget = () => budgetMin > 0 && (Date.now() - t0) / 60000 >= budgetMin;

  const browser: Browser = await puppeteerCore.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
  const page: Page = await browser.newPage();
  let lastPost = "";
  let blocked = false;
  page.on("request", (r) => {
    if (r.method() !== "POST" || !r.url().includes("api.nadlan.gov.il")) return;
    if (!/deal-(data|info|list)/.test(r.url())) return;
    const d = r.postData(); if (d) lastPost = d;
  });
  page.on("response", (r) => { if (r.url().includes("api.nadlan.gov.il") && r.status() === 401) blocked = true; });

  /** Open a page and take the token its first deal request carries. */
  const harvest = async (url: string): Promise<NadlanToken | null> => {
    lastPost = "";
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
    await sleep(2500);
    for (let attempt = 0; attempt < 3 && !lastPost; attempt++) {
      await page.evaluate(() => {
        const hit = [...document.querySelectorAll("button,a,div,span")]
          .find((el) => /^\s*עסקאות\s*$/.test((el.textContent || "").trim()) && (el as HTMLElement).offsetParent !== null);
        (hit as HTMLElement | undefined)?.click();
      }).catch(() => {});
      for (let i = 0; i < 20 && !lastPost; i++) await sleep(400);
    }
    return lastPost ? parseHarvestedPost(lastPost) : null;
  };

  let firstAnswerShown = false;
  let emptyStreak = 0;
  const runQ = async (tok: NadlanToken, extra: Record<string, unknown>): Promise<{ items: RawItem[]; totalRows: number | null }> => {
    // the page's own body shape ({"##": signed}, text/plain) — see lib/nadlanSession.buildFetchBody
    const body = buildFetchBody(signBody(buildQueryPayload(tok, extra)));
    const txt: string = await page.evaluate(async (b: string, headers: Record<string, string>) => {
      const r = await fetch("https://api.nadlan.gov.il/deal-data", { method: "POST", headers, body: b, redirect: "follow" });
      if (r.status === 401) return "__401__";
      return await r.text();
    }, body, DEAL_DATA_HEADERS).catch(() => "");
    if (txt === "__401__") throw new BlockedError("401 מ-deal-data — הסשן נחסם או פג; להתחיל כרום מחדש");
    const d = decodeDealData(txt);
    const items = responseItems(d);
    const meta = responseMeta(d);
    if (!firstAnswerShown) {
      // a failure must explain itself on the first answer, not after the budget
      firstAnswerShown = true;
      const raw = txt.length > 160 ? `${txt.slice(0, 160)}…` : txt;
      console.log(`   תשובה ראשונה: ${items.length} פריטים · total_rows=${meta.totalRows ?? "—"} · גולמי: ${JSON.stringify(raw)}`);
    }
    emptyStreak = items.length ? 0 : emptyStreak + 1;
    if (emptyStreak >= 20 && cap.items.length === 0) {
      throw new Error("20 תשובות ריקות ברצף ואף פריט — ה-API לא מחזיר עסקאות לבקשות שלנו; לבדוק את 'תשובה ראשונה' למעלה");
    }
    return { items, totalRows: meta.totalRows };
  };

  const settlementUrl = `https://www.nadlan.gov.il/?view=settlement&id=${code}&page=deals`;
  let stopped: string | null = null;
  let requests = 0;

  /** Walk every slice for one base (city or neighbourhood) with one token. */
  const walkBase = async (baseLabel: string, getToken: () => Promise<NadlanToken | null>): Promise<void> => {
    let tok = await getToken();
    let tokAt = Date.now();
    if (!tok) { console.log(`   ${baseLabel}: אין טוקן — מדלג`); return; }
    // an empty answer from a token younger than a minute is an empty window,
    // not an expired token — refreshing costs a full page navigation
    const freshen = async () => {
      if (Date.now() - tokAt < 60_000) return false;
      const t2 = await getToken();
      if (!t2) return false;
      tok = t2; tokAt = Date.now();
      return true;
    };
    const slices = sliceQueries(years, nowY).filter((s) => !done.has(`${baseLabel}|${s.label}`));
    let added = 0;
    for (const s of slices) {
      if (overBudget()) { stopped = "תקציב הזמן"; return; }
      for (const fetch_number of [1, 2]) {
        let r = await runQ(tok, { ...s.extra, fetch_number });
        requests++;
        await sleep(rnd(700, 1400));
        if (r.items.length === 0 && fetch_number === 1 && (await freshen())) {
          r = await runQ(tok, { ...s.extra, fetch_number }); requests++; await sleep(rnd(700, 1400));
        }
        if (r.items.length === 0) break;
        added += mergeItems(cap, r.items);
        if (r.items.length < 500) break; // window exhausted
      }
      done.add(`${baseLabel}|${s.label}`);
      if (done.size % 10 === 0) save();
    }
    const span = yearSpan(cap.items);
    console.log(`   ${baseLabel}: +${added.toLocaleString("en")} · סה״כ ${cap.items.length.toLocaleString("en")} · שנים ${span ? `${span.min}–${span.max}` : "—"}`);
  };

  try {
    console.log(`🏙  ${cityName} (למ"ס ${code}) · ${years.length} שנים · תקציב ${budgetMin || "∞"} דק' · קובץ ${file}${cap.items.length ? ` (המשך: ${cap.items.length.toLocaleString("en")} פריטים, ${done.size} חלונות)` : ""}`);

    // 1. the city itself — also the source of neighbourhood ids
    await walkBase("city", () => harvest(settlementUrl));
    save();

    // 2. neighbourhoods, if their pages carry a token of their own (measured once, recorded)
    if (!stopped && !noHoods) {
      const hoodIds = new Map<string, string>();
      for (const it of cap.items) {
        const id = it.neighborhoodId != null ? String(it.neighborhoodId) : "";
        const name = typeof it.neighborhoodName === "string" ? it.neighborhoodName : id;
        if (id && !hoodIds.has(id)) hoodIds.set(id, name);
      }
      console.log(`   ${hoodIds.size} שכונות זוהו מהפריטים`);
      let tried = false;
      for (const [id, name] of hoodIds) {
        if (stopped) break;
        if (overBudget()) { stopped = "תקציב הזמן"; break; }
        const url = `https://www.nadlan.gov.il/?view=neighborhood&id=${id}&page=deals`;
        if (!tried) {
          tried = true;
          const probe = await harvest(url);
          const own = !!probe && String(probe.base_id) !== String(code) && String(probe.base_id) !== "";
          cap.neighborhoodWindow = own;
          console.log(`   חלון שכונה: ${own ? "כן — כל שכונה היא חלון משלה" : "לא — נשארים בפיצול עירוני"}`);
          if (!own) break;
        }
        await walkBase(`hood:${id}`, () => harvest(url));
        console.log(`     ↳ ${name}`);
        save();
      }
    }
  } catch (e) {
    if (e instanceof BlockedError) { stopped = e.message; blocked = true; }
    else { console.error("run aborted:", e instanceof Error ? e.message : e); process.exitCode = 1; }
  } finally {
    save();
    await page.close().catch(() => {});
    try { browser.disconnect(); } catch { /* gone */ }
  }

  const span = yearSpan(cap.items);
  const withAddr = cap.items.filter((i) => typeof i.address === "string" && i.address).length;
  console.log(`\n${stopped ? `⏹ נעצר: ${stopped} · ` : "✓ "}${cap.items.length.toLocaleString("en")} עסקאות בקובץ · ${withAddr.toLocaleString("en")} עם כתובת · שנים ${span ? `${span.min}–${span.max}` : "—"} · ${requests} בקשות · ${((Date.now() - t0) / 60000).toFixed(1)} דק'`);
  if (blocked) { console.error("⛔ nadlan חסם את הסשן — לסגור את הכרום, להפעיל מחדש דרך bootstrap_nadlan_chrome.sh ולהריץ שוב (הקובץ נשמר, הריצה תמשיך מאותה נקודה)."); return 2; }
  return 0;
}

main().then((c) => { process.exitCode = c; }).catch((e) => { console.error("FATAL", e instanceof Error ? e.message : e); process.exitCode = 1; });
