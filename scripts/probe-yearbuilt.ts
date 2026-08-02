#!/usr/bin/env tsx
/**
 * Does the tax authority actually publish a build year for these deals, or is our
 * collector losing it?
 *
 * 44% of the nadlan rows in Tirat Karmel carry no year_built, which makes the
 * second-hand / new split impossible there — and without that split a price
 * trend is meaningless: a year that happened to sell mostly new flats after a
 * year that sold mostly old ones shows a "jump" that never happened in the market.
 *
 * This dumps the RAW API items so the question is settled by evidence: every key
 * the response carries, and how many items have a usable yearBuilt, split by the
 * asset type and by the query that fetched them.
 *
 * Read-only — writes nothing to the database.
 * Run: npx tsx scripts/probe-yearbuilt.ts "טירת כרמל" [more cities…]
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import puppeteerCore from "puppeteer-core";

const SECRET = "90c3e620192348f1bd46fcd9138c3c68";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const b64url = (s: string | Buffer) => Buffer.from(s as never).toString("base64url");
const unrev = (s: string) => s.split("").reverse().join("");
function b64json(s: string): Record<string, unknown> | null {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); } catch { return null; }
}
function signBody(p: Record<string, unknown>): string {
  const h = b64url(JSON.stringify({ alg: "HS256" })), b = b64url(JSON.stringify(p));
  const sig = crypto.createHmac("sha256", Buffer.from(SECRET, "utf8")).update(`${h}.${b}`).digest("base64url");
  return unrev(`${h}.${b}.${sig}`);
}
function decode(txt: string): unknown {
  const t = txt.trim();
  if (t.startsWith("{")) return JSON.parse(t);
  try { return JSON.parse(zlib.gunzipSync(Buffer.from(t, "base64")).toString("utf8")); } catch { return null; }
}

type Item = Record<string, unknown>;

async function probeCity(browser: any, city: string, code: string) {
  const page = await browser.newPage();
  let lastPost = "";
  const captured: Item[] = [];
  page.on("request", (rq: any) => { if (/\/deal-data/.test(rq.url()) && rq.method() === "POST") lastPost = rq.postData() || lastPost; });
  page.on("response", async (r: any) => {
    if (!/\/deal-data/.test(r.url())) return;
    try {
      const d = decode(await r.text()) as { data?: { items?: Item[] } };
      if (d?.data?.items?.length) captured.push(...d.data.items);
    } catch { /* */ }
  });

  await page.goto(`https://www.nadlan.gov.il/?view=settlement&id=${code}&page=deals`, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
  for (let w = 0; w < 12 && !lastPost; w++) await sleep(1800);
  const tok = (() => { try { return b64json(unrev(JSON.parse(lastPost)["##"]).split(".")[1]); } catch { return null; } })();
  if (!tok?.sk || !tok?.token) { console.log(`${city}: no token — is the debuggable Chrome up on :9222?`); await page.close(); return; }

  // a few different windows, so we see whether the gap tracks a particular query
  const queries: Array<[string, Record<string, unknown>]> = [
    ["default (newest first)", { type_order: "dealDate_down", fetch_number: 1 }],
    ["oldest first, 10y horizon", { type_order: "dealDate_up", deal_date: "120", fetch_number: 1 }],
    ["second-hand pool only", { hok_hamecher: "0", type_order: "dealDate_down", fetch_number: 1 }],
  ];
  const perQuery: Array<{ label: string; n: number; withYb: number }> = [];
  for (const [label, extra] of queries) {
    const before = captured.length;
    const now = Math.floor(Date.now() / 1000);
    const body = signBody({ base_id: tok.base_id, base_name: tok.base_name, sk: tok.sk, token: tok.token, exp: now + 110, domain: "www.nadlan.gov.il", ...extra });
    const res = await page.evaluate(async (bs: string) => {
      const r = await fetch("https://api.nadlan.gov.il/deal-data", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ "##": bs }), redirect: "follow" }).catch(() => null);
      return r ? await r.text() : "";
    }, body).catch(() => "");
    try {
      const d = decode(String(res)) as { data?: { items?: Item[] } } | null;
      const its = d?.data?.items ?? [];
      captured.push(...its);
      perQuery.push({ label, n: its.length, withYb: its.filter((i) => Number(i.yearBuilt) > 0).length });
    } catch { perQuery.push({ label, n: 0, withYb: 0 }); }
    await sleep(900);
    void before;
  }

  // dedupe by natural key
  const uniq = new Map<string, Item>();
  for (const i of captured) uniq.set(`${i.dealDate}|${i.dealAmount}|${i.assetArea}|${i.roomNum}`, i);
  const items = [...uniq.values()];

  console.log(`\n══ ${city} (code ${code}) — ${items.length} פריטים גולמיים ══`);
  for (const q of perQuery) console.log(`   ${q.label.padEnd(28)} ${String(q.n).padStart(4)} פריטים · עם yearBuilt: ${q.withYb}`);

  if (!items.length) { await page.close(); return; }
  console.log(`   כל השדות שהתשובה מכילה: ${[...new Set(items.flatMap((i) => Object.keys(i)))].sort().join(", ")}`);

  const withYb = items.filter((i) => Number(i.yearBuilt) > 0);
  console.log(`   עם yearBuilt תקין: ${withYb.length}/${items.length} (${(withYb.length / items.length * 100).toFixed(0)}%)`);

  // what do the ones WITHOUT a build year look like?
  const byNature = new Map<string, { n: number; yb: number }>();
  for (const i of items) {
    const k = String(i.dealNatureDescription ?? i.assetType ?? "(ללא סוג)");
    const e = byNature.get(k) ?? { n: 0, yb: 0 };
    e.n++; if (Number(i.yearBuilt) > 0) e.yb++;
    byNature.set(k, e);
  }
  console.log(`   לפי סוג נכס:`);
  for (const [k, v] of [...byNature.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8))
    console.log(`     ${k.padEnd(26)} ${String(v.n).padStart(4)} · עם שנת בנייה ${String(v.yb).padStart(4)} (${(v.yb / v.n * 100).toFixed(0)}%)`);

  const missing = items.filter((i) => !(Number(i.yearBuilt) > 0));
  if (missing.length) {
    console.log(`   דוגמאות ללא שנת בנייה (JSON גולמי):`);
    for (const m of missing.slice(0, 2)) console.log(`     ${JSON.stringify(m)}`.slice(0, 400));
  }

  // ── can hokHamecher / prevDeals replace the missing build year? ──────
  // Validate against the deals where the build year IS known, so the substitute
  // classifier is measured, not assumed.
  const AGE = 4;
  const known = withYb.filter((i) => Number(String(i.dealDate).slice(0, 4)) > 1990);
  const truth = (i: Item) => Number(String(i.dealDate).slice(0, 4)) - Number(i.yearBuilt) >= AGE; // true = second-hand
  const hok = (i: Item) => Number(i.hokHamecher) === 1;                                          // Sale Law ⇒ new from developer
  const prev = (i: Item) => Array.isArray(i.prevDeals) && (i.prevDeals as unknown[]).length > 0; // sold before ⇒ second-hand

  const tab = (name: string, predicate: (i: Item) => boolean, meansSecondHand: boolean) => {
    let tp = 0, fp = 0, tn = 0, fn = 0;
    for (const i of known) {
      const says = meansSecondHand ? predicate(i) : !predicate(i);
      const is = truth(i);
      if (says && is) tp++; else if (says && !is) fp++; else if (!says && !is) tn++; else fn++;
    }
    const acc = known.length ? ((tp + tn) / known.length * 100).toFixed(1) : "—";
    const prec = tp + fp ? (tp / (tp + fp) * 100).toFixed(1) : "—";
    console.log(`     ${name.padEnd(34)} דיוק ${acc}% · דיוק-חיובי ${prec}% · (יד2 נכון ${tp} · שגוי ${fp} · חדשה נכון ${tn} · שגוי ${fn})`);
  };
  console.log(`   האם אפשר לסווג בלי שנת בנייה? (מאומת מול ${known.length} עסקאות שיש בהן שנת בנייה)`);
  tab("hokHamecher=0 ⇒ יד שנייה", hok, false);
  tab("prevDeals לא ריק ⇒ יד שנייה", prev, true);
  const both = known.filter((i) => prev(i) || !hok(i));
  console.log(`     כיסוי משולב (אחד מהשניים חל): ${both.length}/${known.length} (${(both.length / Math.max(1, known.length) * 100).toFixed(0)}%)`);

  // and how much of the GAP would the substitutes close?
  const rescued = missing.filter((i) => prev(i) || Number(i.hokHamecher) === 1 || Number(i.hokHamecher) === 0);
  const byPrev = missing.filter(prev).length;
  const byHok = missing.filter((i) => i.hokHamecher != null).length;
  console.log(`   מתוך ${missing.length} ללא שנת בנייה: ${byPrev} עם עסקאות קודמות · ${byHok} עם שדה חוק-מכר · ${rescued.length} ניתנות לסיווג`);
  await page.close();
}

async function main() {
  const cities = process.argv.slice(2);
  if (!cities.length) { console.log('usage: probe-yearbuilt.ts "טירת כרמל" …'); return; }
  const codes = new Map(Object.entries(
    JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/city_cbs_codes.json"), "utf8")) as Record<string, number>
  ).map(([k, v]) => [k.trim(), String(v)]));

  const browser = await puppeteerCore.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
  try {
    for (const city of cities) {
      const code = codes.get(city.trim());
      if (!code) { console.log(`${city}: no CBS code`); continue; }
      await probeCity(browser, city, code);
    }
  } finally { await browser.disconnect().catch(() => {}); }
}
main().catch((e) => { console.error(e); process.exit(1); });
