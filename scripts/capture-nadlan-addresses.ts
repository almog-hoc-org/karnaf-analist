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
 * HOW THE WINDOW IS WALKED (lib/nadlanCapture.ts). An anonymous session
 * sees ≤500 items per fetch_number, two fetches per query. Each query is
 * one window shaped by the page's own filters: a period (`deal_date`,
 * months back — a FIXED MENU the run probes first, see HORIZON_CANDIDATES),
 * ascending or descending, and a room count. Every horizon starts with one
 * ascending unfiltered window (its oldest deals); only a horizon that fills
 * both fetches gets the seven expansion windows. A stopped run resumes from
 * the file's `slicesDone`. Neighbourhood pages are TRIED: if a page yields
 * its own token, every neighbourhood becomes its own base. The file records
 * what was measured.
 *
 * MANNERS. The page's own token, the page's own query shapes, 0.7–1.4 s
 * between requests, a hard stop on 401 / the user-limit modal. Nothing
 * here mints a token or exceeds what the page grants a visitor.
 *
 * Usage (needs the debuggable Chrome on :9222 — scripts/bootstrap_nadlan_chrome.sh):
 *   npx tsx scripts/capture-nadlan-addresses.ts "תל אביב-יפו" --out=data/nadlan_addr
 *   [--horizons 6,12,24,36,60] [--budget-min 30] [--no-hoods] [--force]
 *   npx tsx scripts/capture-nadlan-addresses.ts "תל אביב-יפו" --probe
 *     (one request per candidate period: which `deal_date` values the site
 *      accepts, and which years each one reaches — run this before a night)
 */
import fs from "fs";
import path from "path";
import puppeteerCore from "puppeteer-core";
import type { Browser, Page } from "puppeteer-core";
import { buildFetchBody, buildQueryPayload, DEAL_DATA_HEADERS, decodeDealData, parseHarvestedPost, responseError, responseItems, responseMeta, signBody, type NadlanToken } from "../lib/nadlanSession";
import { expansionSlices, HORIZON_CANDIDATES, mergeItems, orderHorizons, primarySlice, saturated, yearSpan, type CaptureFile, type RawItem, type SliceQuery } from "../lib/nadlanCapture";

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
  const VALUE_FLAGS = new Set(["--out", "--horizons", "--budget-min"]);
  const cityName = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && VALUE_FLAGS.has(argv[i - 1])));
  if (!cityName) { console.error('usage: capture-nadlan-addresses.ts "עיר" --out=data/nadlan_addr [--years 2010,2011] [--budget-min 30]'); return 1; }
  const outDir = arg("out") ?? "data/nadlan_addr";
  const budgetMin = Number(arg("budget-min") ?? process.env.KARNAF_NADLAN_BUDGET_MIN ?? 0);
  const noHoods = argv.includes("--no-hoods");
  const force = argv.includes("--force");
  const probe = argv.includes("--probe");
  const givenHorizons = arg("horizons")?.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);

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

  /**
   * Open a page and take the token its first deal request carries.
   * MEASURED 4–5.9.2026: one page load with three clicks was not enough —
   * from city 41 onwards the SPA stopped firing its deal request, first
   * intermittently, then for 100 cities in a row. So: up to three FULL page
   * loads, each given ~12 s to fire, with about:blank between them so the
   * SPA is torn down rather than re-clicked.
   */
  const HARVEST_LOADS = 3;
  const harvest = async (url: string): Promise<NadlanToken | null> => {
    for (let load = 1; load <= HARVEST_LOADS; load++) {
      lastPost = "";
      if (load > 1) { await page.goto("about:blank").catch(() => {}); await sleep(1500); }
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
      await sleep(2500);
      for (let attempt = 0; attempt < 3 && !lastPost; attempt++) {
        await page.evaluate(() => {
          const hit = [...document.querySelectorAll("button,a,div,span")]
            .find((el) => /^\s*עסקאות\s*$/.test((el.textContent || "").trim()) && (el as HTMLElement).offsetParent !== null);
          (hit as HTMLElement | undefined)?.click();
        }).catch(() => {});
        for (let i = 0; i < 10 && !lastPost; i++) await sleep(400);
      }
      if (lastPost) {
        const tok = parseHarvestedPost(lastPost);
        if (tok) { if (load > 1) console.log(`   טוקן אחרי ניסיון ${load}`); return tok; }
      }
    }
    return null;
  };
  /** The one message every dead-session exit carries — the operator's fix is the same in all cases. */
  const DEAD_SESSION = "הכרום הפסיק לענות (אין טוקן גם אחרי 3 טעינות) — לסגור את הכרום, להפעיל מחדש דרך bootstrap_nadlan_chrome.sh ולהריץ שוב";

  let firstAnswerShown = false;
  let emptyStreak = 0;
  const runQ = async (tok: NadlanToken, extra: Record<string, unknown>): Promise<{ items: RawItem[]; totalRows: number | null; error: string | null }> => {
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
    const error = responseError(d);
    if (!firstAnswerShown) {
      // a failure must explain itself on the first answer, not after the budget
      firstAnswerShown = true;
      const raw = txt.length > 160 ? `${txt.slice(0, 160)}…` : txt;
      console.log(`   תשובה ראשונה: ${items.length} פריטים · total_rows=${meta.totalRows ?? "—"} · גולמי: ${JSON.stringify(raw)}`);
    }
    emptyStreak = items.length ? 0 : emptyStreak + 1;
    if (emptyStreak >= 20 && cap.items.length === 0) {
      throw new Error(`20 תשובות ריקות ברצף ואף פריט — ה-API לא מחזיר עסקאות לבקשות שלנו${error ? ` (אחרונה: ${error})` : ""}; לבדוק את 'תשובה ראשונה' למעלה`);
    }
    return { items, totalRows: meta.totalRows, error };
  };

  const settlementUrl = `https://www.nadlan.gov.il/?view=settlement&id=${code}&page=deals`;
  let stopped: string | null = null;
  let requests = 0;

  /** One window: fetch 1, then 2 while full; returns the page counts and the raw items. */
  const runSlice = async (tok: NadlanToken, s: SliceQuery, freshen: () => Promise<boolean>): Promise<{ pages: number[]; items: RawItem[] }> => {
    const pages: number[] = [];
    const items: RawItem[] = [];
    for (const fetch_number of [1, 2]) {
      let r = await runQ(tok, { ...s.extra, fetch_number });
      requests++;
      await sleep(rnd(700, 1400));
      if (r.items.length === 0 && fetch_number === 1 && (await freshen())) {
        r = await runQ(tok, { ...s.extra, fetch_number }); requests++; await sleep(rnd(700, 1400));
      }
      pages.push(r.items.length);
      items.push(...r.items);
      if (r.items.length < 500) break; // window exhausted
    }
    return { pages, items };
  };

  /**
   * Which periods the site accepts, measured: one ascending fetch per
   * candidate. A candidate is accepted when the API does not refuse it;
   * an accepted-but-empty window is still accepted (a small town can have
   * no deals in the last month). Prints the menu with the years each
   * period reaches, so the log answers "how far back" by itself.
   */
  const probeHorizons = async (tok: NadlanToken, verbose: boolean): Promise<number[]> => {
    const ok: number[] = [];
    for (const h of HORIZON_CANDIDATES) {
      const r = await runQ(tok, { ...primarySlice(h).extra, fetch_number: 1 });
      requests++;
      await sleep(rnd(500, 900));
      const sp = yearSpan(r.items);
      if (verbose || r.error == null) {
        console.log(`   deal_date=${String(h).padStart(3)}: ${r.error ? `נדחה (${r.error})` : `${r.items.length} פריטים · total_rows=${r.totalRows ?? "—"} · שנים ${sp ? `${sp.min}–${sp.max}` : "ריק"}`}`);
      }
      if (r.error == null) ok.push(h);
    }
    emptyStreak = 0; // the refusals above are the menu being measured, not a dead session
    return orderHorizons(ok);
  };

  /**
   * Walk one base (the city, or one neighbourhood) horizon by horizon,
   * largest first. Each horizon starts with its unfiltered ascending window
   * (the oldest deals it can see); only a horizon that fills both fetches
   * gets the seven expansion windows.
   */
  const walkBase = async (baseLabel: string, horizons: number[], getToken: () => Promise<NadlanToken | null>): Promise<boolean> => {
    // a base the file already finished needs no page load at all (resume is free)
    if (orderHorizons(horizons).every((h) => done.has(`${baseLabel}|h${h}:done`))) return true;
    let tok = await getToken();
    let tokAt = Date.now();
    if (!tok) { console.log(`   ${baseLabel}: אין טוקן — מדלג`); return false; }
    // an empty answer from a token younger than a minute is an empty window,
    // not an expired token — refreshing costs a full page navigation
    const freshen = async () => {
      if (Date.now() - tokAt < 60_000) return false;
      const t2 = await getToken();
      if (!t2) return false;
      tok = t2; tokAt = Date.now();
      return true;
    };
    const key = (s: SliceQuery) => `${baseLabel}|${s.label}`;
    let added = 0;
    const lines: string[] = [];
    // MEASURED (4.9.2026, Tel Aviv, 69 neighbourhoods): the 12/6/3-month
    // windows added 0 deals every single time — a larger window that did not
    // saturate already held everything the smaller ones can show. So the
    // smaller horizons run only when the larger one filled up.
    let needSmaller = true;
    for (const h of orderHorizons(horizons)) {
      if (overBudget()) { stopped = "תקציב הזמן"; break; }
      const primary = primarySlice(h);
      const doneKey = `${baseLabel}|h${h}:done`;
      if (done.has(doneKey)) continue;
      if (!needSmaller) { done.add(doneKey); lines.push(`${h} חוד': דולג (הגדול הכיל הכול)`); continue; }
      let hAdded = 0;
      const seen: RawItem[] = [];
      let queue: SliceQuery[] = done.has(key(primary)) ? expansionSlices(h) : [primary];
      let expanded = done.has(key(primary));
      while (queue.length) {
        if (overBudget()) { stopped = "תקציב הזמן"; break; }
        const s = queue.shift()!;
        if (done.has(key(s))) continue;
        const r = await runSlice(tok!, s, freshen);
        hAdded += mergeItems(cap, r.items);
        seen.push(...r.items);
        done.add(key(s));
        if (!expanded && s.label === primary.label && saturated(r.pages)) { expanded = true; queue = expansionSlices(h); }
      }
      if (stopped) break;
      done.add(doneKey);
      added += hAdded;
      needSmaller = expanded;
      const sp = yearSpan(seen);
      lines.push(`${h} חוד': +${hAdded}${expanded ? " (רווי, הורחב)" : ""} · ${sp ? `${sp.min}–${sp.max}` : "ריק"}`);
      if (done.size % 10 === 0) save();
    }
    const span = yearSpan(cap.items);
    console.log(`   ${baseLabel}: +${added.toLocaleString("en")} · סה״כ ${cap.items.length.toLocaleString("en")} · שנים ${span ? `${span.min}–${span.max}` : "—"}`);
    if (lines.length) console.log(`     ${lines.join(" · ")}`);
    return true;
  };

  let horizons: number[] = [];
  try {
    if (probe) {
      console.log(`🔎 ${cityName}: אילו תקופות (deal_date) האתר מקבל, ועד איזו שנה כל אחת מגיעה`);
      const tok = await harvest(settlementUrl);
      if (!tok) { console.log("   אין טוקן — הכרום פתוח? נפתחו 'עסקאות' פעם אחת?"); return 1; }
      horizons = await probeHorizons(tok, true);
      console.log(`   מתקבלות: ${horizons.length ? horizons.join(", ") : "אף אחת"}`);
      return 0;
    }
    console.log(`🏙  ${cityName} (למ"ס ${code}) · תקציב ${budgetMin || "∞"} דק' · קובץ ${file}${cap.items.length ? ` (המשך: ${cap.items.length.toLocaleString("en")} פריטים, ${done.size} חלונות)` : ""}`);

    // 0. the period menu — from the flag, from the file's last probe, else measured now
    const cityTok = await harvest(settlementUrl);
    // no token from the city page after three loads = the session is dead, not
    // "this city has no deals": stop with exit 2 so the push script stops too
    if (!cityTok) throw new BlockedError(`אין טוקן מעמוד העיר — ${DEAD_SESSION}`);
    if (givenHorizons?.length) horizons = orderHorizons(givenHorizons);
    else if (cap.horizons?.length) horizons = orderHorizons(cap.horizons);
    else { horizons = await probeHorizons(cityTok, false); cap.horizons = horizons; }
    if (!horizons.length) throw new Error("האתר לא קיבל אף ערך deal_date — ראו 'תשובה ראשונה' למעלה");
    console.log(`   תקופות: ${horizons.join(", ")} חודשים אחורה`);

    // 1. the city itself — also the source of neighbourhood ids
    await walkBase("city", horizons, () => harvest(settlementUrl));
    save();

    // 2. neighbourhoods, if their pages carry a token of their own (measured once, recorded)
    if (!stopped && !noHoods) {
      const hoodIds = new Map<string, string>();
      for (const it of cap.items) {
        const id = it.neighborhoodId != null ? String(it.neighborhoodId) : "";
        const name = typeof it.neighborhoodName === "string" ? it.neighborhoodName : id;
        // id 0 = the site's "no neighbourhood" bucket; it has no page of its own
        if (id && id !== "0" && !hoodIds.has(id)) hoodIds.set(id, name);
      }
      console.log(`   ${hoodIds.size} שכונות זוהו מהפריטים`);
      let tried = false;
      // three neighbourhoods in a row without a token = the session died mid-city
      // (measured 4.9.2026 in רמת גן/רעננה: 11–16 hoods "skipped" that way)
      let hoodFails = 0;
      for (const [id, name] of hoodIds) {
        if (stopped) break;
        if (overBudget()) { stopped = "תקציב הזמן"; break; }
        const url = `https://www.nadlan.gov.il/?view=neighborhood&id=${id}&page=deals`;
        if (!tried) {
          const probe = await harvest(url);
          if (!probe) {
            // no answer at all says nothing about neighbourhood windows — measure on the next one
            hoodFails++;
            console.log(`   hood:${id}: אין טוקן — מדלג`);
            if (hoodFails >= 3) throw new BlockedError(`${hoodFails} שכונות רצופות בלי טוקן — ${DEAD_SESSION}`);
            continue;
          }
          tried = true;
          const own = String(probe.base_id) !== String(code) && String(probe.base_id) !== "";
          cap.neighborhoodWindow = own;
          console.log(`   חלון שכונה: ${own ? "כן — כל שכונה היא חלון משלה" : "לא — נשארים בפיצול עירוני"}`);
          if (!own) break;
        }
        const hadToken = await walkBase(`hood:${id}`, horizons, () => harvest(url));
        if (!hadToken) {
          hoodFails++;
          if (hoodFails >= 3) throw new BlockedError(`${hoodFails} שכונות רצופות בלי טוקן — ${DEAD_SESSION}`);
          continue;
        }
        hoodFails = 0;
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
  if (blocked) { console.error(`⛔ ${stopped} (הקובץ נשמר, הריצה תמשיך מאותה נקודה).`); return 2; }
  return 0;
}

main().then((c) => { process.exitCode = c; }).catch((e) => { console.error("FATAL", e instanceof Error ? e.message : e); process.exitCode = 1; });
