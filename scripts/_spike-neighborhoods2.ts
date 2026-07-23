#!/usr/bin/env tsx
/** SPIKE probe 5: the actual v5 loop — settlement page, click neighborhood buttons, harvest per-neighborhood token from the SPA's own deal-data POST, run hok0 queries, measure year spans. */
import crypto from "crypto";
import zlib from "zlib";
import puppeteerCore from "puppeteer-core";

const SECRET = "90c3e620192348f1bd46fcd9138c3c68";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const b64url = (s: string | Buffer) => Buffer.from(s as never).toString("base64url");
const unrev = (s: string) => s.split("").reverse().join("");
function b64json(s: string): Record<string, unknown> | null { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); } catch { return null; } }
function signBody(p: Record<string, unknown>): string { const h = b64url(JSON.stringify({ alg: "HS256" })), b = b64url(JSON.stringify(p)); const sig = crypto.createHmac("sha256", Buffer.from(SECRET, "utf8")).update(`${h}.${b}`).digest("base64url"); return unrev(`${h}.${b}.${sig}`); }
function decode(txt: string): unknown { const t = txt.trim(); if (t.startsWith("{")) return JSON.parse(t); try { return JSON.parse(zlib.gunzipSync(Buffer.from(t, "base64")).toString("utf8")); } catch { return null; } }

interface RawItem { dealDate?: string; dealAmount?: number; roomNum?: number; assetArea?: number; yearBuilt?: number; neighborhoodName?: string; }

async function main() {
  const browser = await puppeteerCore.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
  const page = await browser.newPage();
  const all = new Map<string, RawItem>();
  let lastPost = ""; // most recent deal-data POST body seen
  page.on("request", (rq) => { if (/\/deal-data/.test(rq.url()) && rq.method() === "POST") lastPost = rq.postData() || lastPost; });
  page.on("response", async (r) => { if (!/\/deal-data/.test(r.url())) return; try { const d = decode(await r.text()) as { data?: { items?: RawItem[] } }; for (const it of d?.data?.items ?? []) { if (!it.dealDate || !it.dealAmount) continue; const k = `${it.dealDate}|${it.dealAmount}|${it.assetArea}|${it.roomNum}`; if (!all.has(k)) all.set(k, it); } } catch { /* */ } });

  const gotoSettlement = async () => {
    lastPost = "";
    await page.goto("https://www.nadlan.gov.il/?view=settlement&id=7000&page=deals", { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
    for (let w = 0; w < 10 && !lastPost; w++) await sleep(2000);
  };
  await gotoSettlement();
  console.log("settlement loaded, uniq so far:", all.size);

  const targets = ["גני אביב", "רמת אשכול", "בן גוריון"];
  for (const target of targets) {
    // click the neighborhood button (strip exists on settlement view)
    lastPost = "";
    const clicked = await page.evaluate((nm) => {
      const btn = [...document.querySelectorAll(".otherNeighborhoods button.nav-button1")].find((b) => (b.textContent || "").trim() === nm) as HTMLElement | undefined;
      if (!btn) return false; btn.click(); return true;
    }, target).catch(() => false);
    if (!clicked) { console.log(`[${target}] BUTTON NOT FOUND (strip present? re-goto)`); await gotoSettlement(); continue; }
    for (let w = 0; w < 12 && !lastPost; w++) await sleep(1500);
    const url = page.url();
    const nid = (url.match(/[?&]id=(\d+)/) || [])[1] ?? "?";
    const p1 = lastPost ? b64json(unrev(JSON.parse(lastPost)["##"]).split(".")[1]) : null;
    console.log(`\n[${target}] url-id=${nid} payload: ${JSON.stringify(p1 && { base_id: p1.base_id, base_name: p1.base_name })}`);
    if (!p1?.sk) { console.log(`[${target}] NO TOKEN`); continue; }
    const startSize = all.size;
    const q = async (extra: Record<string, unknown>) => {
      const before = all.size;
      const now = Math.floor(Date.now() / 1000);
      const body = signBody({ base_id: p1.base_id, base_name: p1.base_name, sk: p1.sk, token: p1.token, exp: now + 110, domain: "www.nadlan.gov.il", ...extra });
      const res = await page.evaluate(async (bs) => { const r = await fetch("https://api.nadlan.gov.il/deal-data", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ "##": bs }), redirect: "follow" }).catch(() => null); return r ? await r.text() : "FETCH_FAIL"; }, body).catch(() => "EVAL_FAIL");
      const d = decode(String(res)) as { data?: { items?: RawItem[] } } | null;
      const its = d?.data?.items ?? [];
      for (const it of its) { if (!it.dealDate || !it.dealAmount) continue; const k = `${it.dealDate}|${it.dealAmount}|${it.assetArea}|${it.roomNum}`; if (!all.has(k)) all.set(k, it); }
      const years = [...new Set(its.map((i) => String(i.dealDate).slice(0, 4)))].sort();
      console.log(`[${target}] ${JSON.stringify(extra)} → n=${its.length} span=${years[0] ?? "-"}–${years[years.length - 1] ?? "-"} (+${all.size - before})`);
      await sleep(rnd(350, 1100));
      return its.length;
    };
    await q({ hok_hamecher: "0", type_order: "dealDate_down", fetch_number: 1 });
    await q({ hok_hamecher: "0", type_order: "dealDate_down", fetch_number: 2 });
    await q({ hok_hamecher: "0", type_order: "dealDate_up", fetch_number: 1 });
    await q({ hok_hamecher: "0", type_order: "dealDate_up", fetch_number: 2 });
    const hist = new Map<number, number>();
    for (const it of all.values()) { const dy = Number(String(it.dealDate).slice(0, 4)); const yb = Number(it.yearBuilt) || null; if (yb && dy - yb >= 3) hist.set(dy, (hist.get(dy) ?? 0) + 1); }
    console.log(`[${target}] neighborhood added ${all.size - startSize} uniq. CUM SH hist: ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([y, n]) => `${y}:${n}`).join(" ")}`);
    // back to settlement via SPA history
    lastPost = "";
    await page.goBack({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
    await sleep(2500);
    const backOk = /view=settlement/.test(page.url());
    console.log(`[${target}] goBack → ${page.url().slice(0, 80)} (settlement=${backOk})`);
    if (!backOk) await gotoSettlement();
  }
  console.log(`\nTOTAL uniq collected in spike: ${all.size}`);
  await page.close().catch(() => {});
  await browser.disconnect();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
