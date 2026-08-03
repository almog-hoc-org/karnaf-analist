#!/usr/bin/env tsx
/**
 * Why does one city come back nearly empty? Ask govmap and count what is dropped.
 *
 * ═══ RUN THIS ON A MACHINE IN ISRAEL. govmap answers no one else. ═══
 *
 * WHY THIS EXISTS
 * The coverage baseline found a third of all localities — 53 of 165 — sitting
 * below a tenth of the national transaction rate, and the very bottom of that
 * list is unambiguous: Kuseife, 1 deal in ten years against 21,849 residents.
 * Lakiya, 2 against 19,361. Bu'eine Nujeidat, 1 against 10,630. Against a
 * national median of 50.9 deals per 1,000 residents.
 *
 * No market explanation survives that. A locality of 22,000 people registers
 * more than one apartment sale in a decade whatever its housing customs. This
 * is the collector dropping data, and every one of the affected places is an
 * Arab locality — so the site is currently under-representing an entire group
 * of towns, on a page about to be published.
 *
 * The collector applies two hard filters, and both fail silently — no log, no
 * counter, nothing distinguishing "this city has no deals" from "this city's
 * deals were all discarded":
 *
 *   1. normalizeCity(settlementNameHeb) === cityKey
 *      Exact match after normalisation. Regional councils are the obvious
 *      casualty — Ma'ale Iron and Basma are councils whose deals the authority
 *      records under constituent village names, which can never match.
 *
 *   2. isResidentialApartment(dealNatureDescription)
 *      An allow-list of דירה · דירת גן · דירת גג · פנטהאוז · קוטג' · בית בודד ·
 *      דו משפחתי · מיני פנטהאוז. That vocabulary comes from apartment-block
 *      housing. Where most homes are detached family houses the authority uses
 *      other wording entirely, and every such deal is dropped.
 *
 * This script re-runs the fetch WITHOUT the filters and reports what each one
 * costs, so the fix is chosen against counts instead of a hypothesis.
 *
 *   npx tsx scripts/diagnose-city.ts "שפרעם"
 *   npx tsx scripts/diagnose-city.ts "כסיפה" "רהט" "מעלה עירון"
 */
import { ilFetch } from "../lib/ilFetch";

const GOVMAP_BASE = "https://www.govmap.gov.il/api";
const SWEEP_RADIUS = 2500;
const RING_OFFSETS_M = [0, 2000, 4000, 6000];
const MAX_POLYGONS = 120;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Copied verbatim from the collector — the point is to measure what IT does. */
function normalizeCity(name: string | null | undefined): string {
  if (!name) return "";
  return name.replace(/["'`]/g, "").replace(/[-–]/g, " ").replace(/יי/g, "י").replace(/וו/g, "ו").replace(/\s+/g, " ").trim();
}
function isResidentialApartment(nature: string | null | undefined): boolean {
  if (!nature) return false;
  if (/קבוצת רכישה|קרקע|מסחרי|משרד|חנות|חניה|מחסן|תעשיה|ללא תיכנון|מלון|דיור מוגן/.test(nature)) return false;
  return ["דירה", "דירת גן", "דירת גג", "פנטהאוז", "קוטג'", "בית בודד", "דו משפחתי", "מיני פנטהאוז"].some((p) => nature.includes(p));
}

async function gf(url: string, options?: RequestInit): Promise<Response> {
  const res = await ilFetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "RealEstateDashboard/1.0", ...(options?.headers || {}) },
  });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) {
    throw new Error(`govmap החזיר ${ct || "לא ידוע"} — הרץ ממחשב בישראל`);
  }
  return res;
}

async function diagnose(cityName: string) {
  const cityKey = normalizeCity(cityName);
  console.log(`\n${"═".repeat(64)}`);
  console.log(`${cityName}   (מנורמל: "${cityKey}")`);
  console.log(`${"═".repeat(64)}`);

  // ── 1. does autocomplete resolve it at all? ────────────────────────
  const res = await gf(`${GOVMAP_BASE}/search-service/autocomplete`, {
    method: "POST",
    body: JSON.stringify({ searchText: cityName, language: "he", isAccurate: false, maxResults: 10 }),
  });
  const data = await res.json();
  const results = data.results ?? [];
  const settlements = results.filter((r: { type: string }) => r.type === "settlement");
  console.log(`\n1. חיפוש שם: ${results.length} תוצאות, ${settlements.length} מסוג יישוב`);
  for (const r of results.slice(0, 5)) {
    console.log(`     ${String(r.type ?? "?").padEnd(12)} ${r.text ?? r.name ?? "?"}`);
  }
  if (settlements.length === 0 && results.length === 0) {
    console.log(`   ✗ govmap לא מזהה את השם הזה בכלל — זה הכשל.`);
    return;
  }

  const pts: { x: number; y: number }[] = [];
  for (const r of (settlements.length ? settlements : results.slice(0, 2))) {
    const m = r?.shape?.match(/POINT\(([^ ]+) ([^ ]+)\)/);
    if (m) pts.push({ x: Math.round(parseFloat(m[1])), y: Math.round(parseFloat(m[2])) });
  }
  if (!pts.length) { console.log(`   ✗ אין נקודות ציון — הכשל כאן.`); return; }

  // ── 2. polygons, and what the authority calls this place ───────────
  const sweep: { x: number; y: number }[] = [];
  for (const c of pts) {
    sweep.push(c);
    for (const r of RING_OFFSETS_M) {
      if (r === 0) continue;
      for (let a = 0; a < 360; a += 45) {
        const rad = (a * Math.PI) / 180;
        sweep.push({ x: Math.round(c.x + r * Math.cos(rad)), y: Math.round(c.y + r * Math.sin(rad)) });
      }
    }
  }

  const matched = new Map<string, number>();
  const nearbyNames = new Map<string, number>();
  for (const pt of sweep) {
    try {
      const arr = await (await gf(`${GOVMAP_BASE}/real-estate/deals/${pt.x},${pt.y}/${SWEEP_RADIUS}`)).json() as
        { polygon_id: string; dealscount: string; settlementNameHeb: string }[];
      for (const p of arr ?? []) {
        const n = parseInt(p.dealscount);
        if (!(n > 0)) continue;
        nearbyNames.set(p.settlementNameHeb, (nearbyNames.get(p.settlementNameHeb) ?? 0) + n);
        if (normalizeCity(p.settlementNameHeb) === cityKey) matched.set(p.polygon_id, n);
      }
    } catch { /* transient */ }
    await sleep(300);
  }

  console.log(`\n2. פוליגונים: ${matched.size} תואמים את השם`);
  console.log(`   שמות יישובים שנמצאו בסביבה (עם מספר עסקאות):`);
  const sorted = [...nearbyNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [name, n] of sorted) {
    const hit = normalizeCity(name) === cityKey;
    console.log(`     ${hit ? "✓" : " "} ${String(n).padStart(6)}  ${name}`);
  }
  if (matched.size === 0) {
    console.log(`\n   ✗ אף פוליגון לא תואם. אם למעלה מופיעים שמות של כפרים סמוכים,`);
    console.log(`     זו מועצה אזורית והעסקאות רשומות תחת שמות המרכיבים.`);
    return;
  }

  // ── 3. what the nature filter costs ────────────────────────────────
  const picked = [...matched.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_POLYGONS).map((e) => e[0]);
  const natures = new Map<string, { total: number; kept: number }>();
  let total = 0, kept = 0;
  for (const pid of picked) {
    for (const [s, e] of [["2016-01", "2020-01"], ["2020-01", "2023-06"], ["2023-06", "2026-12"]]) {
      try {
        const d = await (await gf(`${GOVMAP_BASE}/real-estate/neighborhood-deals/${pid}?limit=2000&startDate=${s}&endDate=${e}`)).json() as
          { data?: Array<{ settlementNameHeb: string; dealNatureDescription: string | null }> };
        for (const deal of d.data ?? []) {
          if (normalizeCity(deal.settlementNameHeb) !== cityKey) continue;
          const nature = deal.dealNatureDescription ?? "(ריק)";
          const ok = isResidentialApartment(deal.dealNatureDescription);
          const cur = natures.get(nature) ?? { total: 0, kept: 0 };
          cur.total++; if (ok) cur.kept++;
          natures.set(nature, cur);
          total++; if (ok) kept++;
        }
      } catch { /* skip */ }
      await sleep(300);
    }
  }

  console.log(`\n3. סוגי נכס — ${total.toLocaleString("en")} עסקאות בעיר, ${kept.toLocaleString("en")} עוברות את המסנן`);
  if (total === 0) { console.log(`   (לא הוחזרו עסקאות כלל)`); return; }
  console.log(`   ${"עובר".padEnd(6)}${"כמות".padStart(7)}  סוג`);
  for (const [nature, c] of [...natures.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 20)) {
    console.log(`   ${(c.kept > 0 ? "✓" : "✗ נזרק").padEnd(6)}${String(c.total).padStart(7)}  ${nature}`);
  }
  const dropped = total - kept;
  if (dropped > 0) {
    console.log(`\n   ⚠ ${dropped.toLocaleString("en")} עסקאות (${((dropped / total) * 100).toFixed(0)}%) נזרקות ע"י מסנן סוג הנכס.`);
    console.log(`     כל אחת מהן נעלמת בשקט — בלי לוג ובלי מונה.`);
  } else {
    console.log(`\n   ✓ מסנן סוג הנכס לא זורק כלום כאן. הכשל במקום אחר.`);
  }
}

async function main() {
  const cities = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!cities.length) {
    console.error('שימוש: npx tsx scripts/diagnose-city.ts "שפרעם" ["כסיפה" ...]');
    process.exit(1);
  }
  for (const c of cities) {
    try { await diagnose(c); }
    catch (e) { console.error(`\n✗ ${c}: ${e instanceof Error ? e.message : e}`); }
  }
  console.log("");
}

main();
