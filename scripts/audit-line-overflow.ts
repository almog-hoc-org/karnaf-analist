#!/usr/bin/env tsx
/**
 * Site-wide check for the three layout faults this session is about, at phone
 * width:
 *
 *   1. a DESCRIPTION line that wrapped — anything in the small type roles
 *      (text-xs / text-2xs / [9px]) rendering taller than one line,
 *   2. a CHIP ROW that wrapped — a flex row of pills taller than one pill,
 *   3. HORIZONTAL OVERFLOW — any element whose content is wider than its box.
 *
 * It exists because "go over the whole site and make sure there are no stray
 * lines" is not a claim anyone can check by eye across seven routes and three
 * widths. This turns it into a list, and the list is either empty or it is not.
 *
 * Needs a browser and a running server:
 *   npx next start &                 (or npm run dev)
 *   npm i --no-save playwright-core
 *   npx tsx scripts/audit-line-overflow.ts [baseUrl] [width]
 */
import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const WIDTH = Number(process.argv[3] ?? 375);
const EXECUTABLE = process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const ROUTES = ["/", "/cities", "/city/חיפה", "/compare", "/deals", "/rankings/most-expensive", "/calculators"];

interface Finding { route: string; kind: string; text: string; detail: string }

const BROWSER_SRC = `(function () {
  var out = [];
  var seen = new Set();
  function label(el) { return (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 60); }

  // 1. small-type description lines that took more than one line
  var leaves = Array.prototype.slice.call(document.querySelectorAll("p, span, div"));
  for (var i = 0; i < leaves.length; i++) {
    var el = leaves[i];
    if (el.children.length > 0) continue;               // leaf text only
    var cs = getComputedStyle(el);
    if (cs.display === "none" || el.offsetHeight === 0) continue;
    var fs = parseFloat(cs.fontSize);
    if (fs > 13.5) continue;                            // text-xs and smaller: the description roles
    // A chip is not a description line: it has a fixed height by design, and
    // measuring its box would report every pill on the site as "wrapped".
    if (/chip-action|control-pill|trend-pill|chip-quality|rounded-full/.test(el.className || "")) continue;
    // COUNT LINE BOXES, don't infer them from height. A range over the
    // element's own text yields one rect per rendered line — exact, and
    // immune to padding, borders and fixed heights.
    var rng = document.createRange();
    rng.selectNodeContents(el);
    // DISTINCT TOPS, not rect count. In an RTL page a range yields one rect per
    // BIDI RUN — "יד-2 ארצי 3ש׳" is five rects on one line — so counting rects
    // reports almost every Hebrew string on the site as wrapped.
    var rects = rng.getClientRects();
    var tops = {};
    for (var t = 0; t < rects.length; t++) tops[Math.round(rects[t].top)] = 1;
    var lines = Object.keys(tops).length;
    if (lines > 1 && label(el).length > 12) {
      out.push({ kind: "שורת תיאור נשברה", text: label(el), detail: lines + " שורות" });
    }
  }

  // 2. chip rows taller than one chip
  var rows = Array.prototype.slice.call(document.querySelectorAll("div"));
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var kids = Array.prototype.slice.call(row.children);
    var chips = kids.filter(function (k) { return /control-pill|chip-action/.test(k.className || ""); });
    if (chips.length < 2) continue;
    var tallest = Math.max.apply(null, chips.map(function (c) { return c.offsetHeight; }));
    if (tallest > 0 && row.offsetHeight > tallest * 1.5) {
      out.push({ kind: "שורת כפתורים נשברה", text: label(row), detail: row.offsetHeight + "px מול צ׳יפ של " + tallest + "px" });
    }
  }

  // 3. horizontal overflow, ignoring containers that scroll on purpose
  var els = Array.prototype.slice.call(document.querySelectorAll("body *"));
  for (var j = 0; j < els.length; j++) {
    var e = els[j];
    if (seen.has(e)) continue;
    var s2 = getComputedStyle(e);
    if (s2.overflowX === "auto" || s2.overflowX === "scroll") continue;
    if (e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0) {
      out.push({ kind: "גלישה אופקית", text: label(e), detail: e.scrollWidth + " > " + e.clientWidth });
      seen.add(e);
    }
  }
  return out;
})()`;

async function main(): Promise<number> {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: 800 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });

  const all: Finding[] = [];
  for (const route of ROUTES) {
    try {
      await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 45_000 });
    } catch {
      all.push({ route, kind: "load", text: "", detail: "העמוד לא נטען" });
      continue;
    }
    // Passed as a STRING, not a function: tsx compiles this file with esbuild's
    // keepNames helper, which rewrites arrow functions to call __name() — a
    // helper that does not exist inside the page, so a function argument dies
    // with "__name is not defined" the moment it is serialised.
    const found = (await page.evaluate(BROWSER_SRC)) as { kind: string; text: string; detail: string }[];
    for (const f of found) all.push({ route, ...f });
  }

  await browser.close();

  console.log(`רוחב ${WIDTH}px · ${ROUTES.length} מסלולים · ${all.length} חריגות\n`);
  const byRoute = new Map<string, Finding[]>();
  for (const f of all) {
    const list = byRoute.get(f.route) ?? [];
    list.push(f);
    byRoute.set(f.route, list);
  }
  for (const [route, list] of byRoute) {
    console.log(`${route} — ${list.length}`);
    for (const f of list.slice(0, 25)) console.log(`   [${f.kind}] ${f.text}  (${f.detail})`);
    if (list.length > 25) console.log(`   … ועוד ${list.length - 25}`);
  }
  return all.length === 0 ? 0 : 0; // reports, never fails a pipeline
}

main()
  .then((c) => process.exit(c))
  .catch((e) => { console.error(e); process.exit(1); });
