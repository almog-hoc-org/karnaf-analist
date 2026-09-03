#!/usr/bin/env tsx
/**
 * THE MAC HALF: ask govmap where each residue address is. Network only, no
 * database — the same split as scripts/capture-govmap-addresses.ts, for the
 * same reason: govmap answers 403 to the VPS and the Mac does not hold the
 * live database. The file is the seam.
 *
 * PRIMARY GEOCODER: govmap's own search autocomplete — the endpoint every
 * other govmap consumer in this repo already uses (lib/govmapDeals.ts),
 * needing no token. With isAccurate:true and "street number, city" it
 * returns candidates with a `shape` WKT point in ITM and a `type`/label
 * naming what was found. The level is folded by lib/geocode.levelFromGovmapResult:
 * only a house-level answer becomes a pin; a street-level answer becomes a
 * ring; anything else is recorded as asked-and-unanswered so the next export
 * does not ask again (until the method version is bumped).
 *
 * FALLBACK: govmap's public geocode API (api.govmap.gov.il), which needs a
 * free token. Enabled only when KARNAF_GOVMAP_GEOCODE_URL and
 * KARNAF_GOVMAP_TOKEN are set; its response is parsed by the same rule.
 *
 * The first ten raw answers are printed once — the field names are what the
 * level rule depends on, and they are not documented anywhere.
 *
 *   npx tsx scripts/geocode-govmap-residue.ts data/geocode_todo/<city>.json [...] [--out data/geocode_done] [--budget-min 240]
 */
import fs from "fs";
import path from "path";
import { GOVMAP_BASE, REQUEST_DELAY_MS, govmapFetch, isGeoBlockError } from "../lib/govmapDeals";
import { levelFromGovmapResult, parseWktPoint, type GeocodeLevel } from "../lib/geocode";
import type { TodoAddress } from "./export-geocode-residue";

const argv = process.argv.slice(2);
const arg = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = path.resolve(arg("out") ?? "data/geocode_done");
const BUDGET_MIN = Number(arg("budget-min") ?? 0);
const files = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GeocodeAnswer {
  streetNorm: string; houseNorm: string; street: string; houseNum: string;
  x: number | null; y: number | null; level: GeocodeLevel; label: string | null;
}

let printed = 0;
function describeRaw(r: unknown): void {
  if (printed >= 10) return;
  printed++;
  console.log(`   דגימת תשובה ${printed}: ${JSON.stringify(r).slice(0, 300)}`);
}

async function geocodeOne(city: string, a: TodoAddress): Promise<Omit<GeocodeAnswer, "streetNorm" | "houseNorm" | "street" | "houseNum">> {
  const searchText = `${a.street} ${a.houseNum}, ${city}`;
  const res = await govmapFetch(`${GOVMAP_BASE}/search-service/autocomplete`, {
    method: "POST",
    body: JSON.stringify({ searchText, language: "he", isAccurate: true, maxResults: 5 }),
  });
  const data = (await res.json()) as { results?: Array<{ type?: string; shape?: string; text?: string; name?: string; [k: string]: unknown }> };
  const results = data.results ?? [];
  if (results.length) describeRaw(results[0]);
  // the first candidate WITH a point whose text mentions the city wins;
  // a candidate for another town is worse than no answer
  for (const r of results) {
    const pt = parseWktPoint(r.shape);
    const label = String(r.text ?? r.name ?? r.type ?? "");
    const mentionsCity = !label || label.includes(city.split(/[\s-]/)[0]);
    const level = levelFromGovmapResult({ label, type: r.type, hasPoint: !!pt });
    if (pt && mentionsCity && level !== "none") return { x: pt.x, y: pt.y, level, label: `${r.type ?? ""}|${label}` };
  }
  if (process.env.KARNAF_GOVMAP_GEOCODE_URL && process.env.KARNAF_GOVMAP_TOKEN) return geocodeFallback(searchText);
  return { x: null, y: null, level: "none", label: results[0] ? String(results[0].type ?? "") : null };
}

/** api.govmap.gov.il geocode — shape discovered on the Mac; parsed leniently. */
async function geocodeFallback(keyword: string): Promise<Omit<GeocodeAnswer, "streetNorm" | "houseNorm" | "street" | "houseNum">> {
  const url = process.env.KARNAF_GOVMAP_GEOCODE_URL!;
  const res = await govmapFetch(url, {
    method: "POST",
    body: JSON.stringify({ keyword, type: 0, token: process.env.KARNAF_GOVMAP_TOKEN }),
  });
  const data = (await res.json()) as { data?: Array<{ X?: number; Y?: number; ResultLable?: string; ResultType?: string }> };
  const first = data.data?.[0];
  if (first) describeRaw(first);
  const hasPoint = first?.X != null && first?.Y != null;
  const level = levelFromGovmapResult({ label: first?.ResultLable, type: first?.ResultType, hasPoint });
  return hasPoint && level !== "none"
    ? { x: Number(first!.X), y: Number(first!.Y), level, label: `${first!.ResultType ?? ""}|${first!.ResultLable ?? ""}` }
    : { x: null, y: null, level: "none", label: first?.ResultLable ?? null };
}

async function main() {
  if (!files.length) { console.error("שימוש: geocode-govmap-residue.ts <todo.json> [...] [--out dir] [--budget-min N]"); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  const overBudget = () => BUDGET_MIN > 0 && (Date.now() - t0) / 60000 >= BUDGET_MIN;

  for (const file of files) {
    const todo = JSON.parse(fs.readFileSync(file, "utf8")) as { city: string; method: string; addresses: TodoAddress[] };
    const outFile = path.join(OUT, path.basename(file));
    // resume: answers already on disk are not asked again
    const done: GeocodeAnswer[] = fs.existsSync(outFile) ? (JSON.parse(fs.readFileSync(outFile, "utf8")) as { answers: GeocodeAnswer[] }).answers : [];
    const doneKeys = new Set(done.map((d) => `${d.streetNorm}|${d.houseNorm}`));
    const pending = todo.addresses.filter((a) => !doneKeys.has(`${a.streetNorm}|${a.houseNorm}`));
    console.log(`── ${todo.city}: ${pending.length.toLocaleString("en")} כתובות לשאול (${done.length} כבר נענו) ──`);
    let house = 0, street = 0, none = 0;
    const save = () => {
      fs.writeFileSync(`${outFile}.tmp`, JSON.stringify({ city: todo.city, method: todo.method, answers: done }));
      fs.renameSync(`${outFile}.tmp`, outFile);
    };
    for (let i = 0; i < pending.length; i++) {
      if (overBudget()) { console.log(`⏸  תקציב הזמן נגמר — ${pending.length - i} כתובות יישאלו בריצה הבאה`); save(); process.exit(0); }
      const a = pending[i];
      try {
        const ans = await geocodeOne(todo.city, a);
        done.push({ streetNorm: a.streetNorm, houseNorm: a.houseNorm, street: a.street, houseNum: a.houseNum, ...ans });
        if (ans.level === "house") house++; else if (ans.level === "street") street++; else none++;
      } catch (e) {
        if (isGeoBlockError(e)) {
          console.error(`⛔ ${e instanceof Error ? e.message : e}\n   govmap חסום מהמכונה הזו — הסקריפט הזה חייב לרוץ מסביבה ישראלית.`);
          save(); process.exit(1);
        }
        console.error(`   ${a.street} ${a.houseNum}: ${e instanceof Error ? e.message : e}`);
      }
      if ((i + 1) % 200 === 0) { save(); console.log(`   … ${i + 1}/${pending.length} · בית ${house} · רחוב ${street} · ללא ${none}`); }
      await sleep(REQUEST_DELAY_MS);
    }
    save();
    console.log(`   ✓ ${todo.city}: בית ${house} · רחוב ${street} · ללא תשובה ${none} → ${outFile}`);
  }
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
