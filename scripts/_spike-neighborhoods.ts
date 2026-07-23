#!/usr/bin/env tsx
/** SPIKE probe 3: find the API response carrying the neighborhoods list, and click a list item to learn the URL pattern. */
import zlib from "zlib";
import puppeteerCore from "puppeteer-core";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function decode(txt: string): unknown { const t = txt.trim(); if (t.startsWith("{") || t.startsWith("[")) { try { return JSON.parse(t); } catch { return null; } } try { return JSON.parse(zlib.gunzipSync(Buffer.from(t, "base64")).toString("utf8")); } catch { return null; } }

async function main() {
  const browser = await puppeteerCore.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
  const page = await browser.newPage();
  const hits: string[] = [];
  page.on("response", async (r) => {
    const u = r.url();
    if (!/api\.nadlan\.gov\.il/.test(u) || /recaptcha/.test(u)) return;
    try {
      const txt = await r.text();
      const d = decode(txt);
      const s = d ? JSON.stringify(d) : txt.slice(0, 100);
      if (/גינתון|אחיסמך|שכונ|neigh/i.test(s)) hits.push(`HIT ${u.slice(0, 90)} => ${s.slice(0, 1500)}`);
    } catch { /* */ }
  });
  await page.goto("https://www.nadlan.gov.il/?view=settlement&id=7000&page=deals", { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
  await sleep(6000);
  console.log(`API HITS carrying neighborhood names: ${hits.length}`);
  for (const h of hits.slice(0, 5)) console.log(h.slice(0, 1800), "\n---");

  // enumerate the DOM neighborhoods section: items after the H2 "מעבר אל שכונות"
  const domInfo = await page.evaluate(() => {
    const h2 = [...document.querySelectorAll("h2")].find((e) => /מעבר אל שכונות/.test(e.textContent || ""));
    if (!h2) return { err: "no h2" };
    const section = h2.closest("section,div");
    const items = section ? [...section.querySelectorAll("li,a,button,[role=button],[class*=card],[class*=item]")] : [];
    return {
      sectionTag: section?.tagName,
      sectionClass: (section as HTMLElement | null)?.className?.slice(0, 100),
      itemCount: items.length,
      items: items.slice(0, 50).map((e) => ({ tag: e.tagName, cls: (e as HTMLElement).className?.slice?.(0, 60), txt: (e.textContent || "").trim().slice(0, 40) })),
    };
  }).catch((e) => ({ err: String(e) }));
  console.log("NEIGH SECTION:", JSON.stringify(domInfo, null, 1).slice(0, 2500));

  // click the FIRST neighborhood item and see where the router goes
  const before = page.url();
  const clickRes = await page.evaluate(() => {
    const h2 = [...document.querySelectorAll("h2")].find((e) => /מעבר אל שכונות/.test(e.textContent || ""));
    const section = h2?.closest("section,div");
    if (!section) return "no section";
    const cand = [...section.querySelectorAll("li,a,button,[role=button]")].find((e) => (e.textContent || "").trim().length > 1 && !/מעבר אל/.test(e.textContent || ""));
    if (!cand) return "no item";
    (cand as HTMLElement).click();
    return "clicked: " + (cand.textContent || "").trim().slice(0, 30);
  }).catch((e) => "ERR " + String(e));
  await sleep(4000);
  console.log("ITEM CLICK:", clickRes, "| URL:", before, "→", page.url());
  await page.close().catch(() => {});
  await browser.disconnect();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
