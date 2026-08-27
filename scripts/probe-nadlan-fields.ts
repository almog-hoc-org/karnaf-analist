#!/usr/bin/env tsx
/**
 * One question, answered from the source: what does api.nadlan.gov.il's
 * deal-data endpoint ACTUALLY return per deal?
 *
 * The collector's RawItem type is a list of the fields someone chose to read,
 * and choosing is how neighbourhoodName got parsed-then-dropped for months.
 * This attaches to the same local Chrome the collector uses (reCAPTCHA needs
 * a real browser), opens the city search once, captures the site's own
 * deal-data response, and prints every key with a sample value — so extending
 * the collector becomes transcription, not archaeology.
 *
 *   npx tsx scripts/probe-nadlan-fields.ts [--city "תל אביב-יפו"]
 *   (needs Chrome listening on 127.0.0.1:9222, like the collector)
 */
import puppeteerCore from "puppeteer-core";
import { describeRawItem } from "../lib/nadlanAddress";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const city = arg("city") ?? "תל אביב-יפו";
  const browser = await puppeteerCore.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
  const page = await browser.newPage();
  let raw: Record<string, unknown> | null = null;

  // The site fires its own deal-data request on load; we only listen.
  page.on("response", async (r) => {
    if (!/\/deal-data/.test(r.url()) || raw) return;
    try {
      const t = await r.text();
      const j = t.startsWith("{") ? JSON.parse(t) : null;
      const item = j?.data?.items?.[0];
      if (item && typeof item === "object") raw = item as Record<string, unknown>;
    } catch { /* not the payload we want */ }
  });

  try {
    await page.goto(`https://www.nadlan.gov.il/?search=${encodeURIComponent(city)}`, {
      waitUntil: "networkidle2", timeout: 90_000,
    });
    const until = Date.now() + 30_000;
    while (!raw && Date.now() < until) await new Promise((r) => setTimeout(r, 500));
  } finally {
    await page.close().catch(() => {});
    await browser.disconnect();
  }

  if (!raw) {
    console.error("לא נתפסה תשובת deal-data — reCAPTCHA, שינוי בעמוד, או שהחיפוש לא ירה.");
    return 1;
  }

  console.log(`── כל השדות של פריט עסקה אחד (${city}) ──`);
  console.log(describeRawItem(raw));
  console.log(`\nסה״כ ${Object.keys(raw as object).length} שדות. השוו מול RawItem בקולקטור — כל שדה שאינו שם הוא שדה שנזרק.`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
