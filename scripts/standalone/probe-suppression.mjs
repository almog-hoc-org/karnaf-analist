// Is there a disclosure threshold below which the authority stops publishing detail?
//
// ═══ RUN ON A MACHINE IN ISRAEL. ═══
//
//   node probe-suppression.mjs
//
// WHERE THIS CAME FROM
// The endpoint probe cleared our code of the charge. Haifa: polygon with 245
// deals in the index, 1,500 returned, HTTP 200, every request variant working.
// Shefa-'Amr: 12 in the index, 0 returned. Kuseife: 2 in the index, 0 returned.
// Same endpoint, same request shape, same status code, no error.
//
// So the collector is alive and the API has not changed. What differs is
// DENSITY. Shefa-'Amr holds 1,141 deals spread across 111 polygons — about ten
// each — while Haifa's are concentrated. That is the signature of statistical
// disclosure control: a source that will not publish individual transactions
// for an area with few of them, because a handful of sales in a small
// neighbourhood identifies the people who made them.
//
// If that is what this is, no code change recovers those deals from here, and
// the honest response is not a fix but a disclosure — the site must tell a
// reader which localities it under-covers instead of drawing a confident line
// through eight points.
//
// This tests it directly: sample polygons across the whole density range in
// several cities and compare what the index claims against what the detail
// endpoint returns. A threshold shows up as a clean break — everything above
// some count returns data, everything below returns zero, regardless of city.
// If instead the break tracks the CITY rather than the count, the cause is
// something else and this rules the theory out rather than confirming it.

const GOVMAP = "https://www.govmap.gov.il/api";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalizeCity = (n) => !n ? "" :
  n.replace(/["'`]/g, "").replace(/[-–]/g, " ").replace(/יי/g, "י").replace(/וו/g, "ו").replace(/\s+/g, " ").trim();

async function j(url, options) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "RealEstateDashboard/1.0", ...(options?.headers || {}) },
  });
  const body = await res.text();
  if (!(res.headers.get("content-type") ?? "").includes("json")) {
    throw new Error(`HTTP ${res.status} ${body.trim().slice(0, 60)}`);
  }
  return JSON.parse(body);
}

async function polygonsFor(city) {
  const a = await j(`${GOVMAP}/search-service/autocomplete`, {
    method: "POST",
    body: JSON.stringify({ searchText: city, language: "he", isAccurate: false, maxResults: 10 }),
  });
  const key = normalizeCity(city);
  const pts = [];
  for (const r of a.results ?? []) {
    const m = r?.shape?.match(/POINT\(([^ ]+) ([^ ]+)\)/);
    if (m) pts.push({ x: Math.round(+m[1]), y: Math.round(+m[2]) });
  }
  const found = new Map();
  // A couple of rings is enough to gather a spread of densities; this is a
  // sample, not a collection run.
  const sweep = [];
  for (const c of pts.slice(0, 2)) {
    sweep.push(c);
    for (const r of [2000, 4000]) {
      for (let ang = 0; ang < 360; ang += 90) {
        const rad = (ang * Math.PI) / 180;
        sweep.push({ x: Math.round(c.x + r * Math.cos(rad)), y: Math.round(c.y + r * Math.sin(rad)) });
      }
    }
  }
  for (const pt of sweep) {
    try {
      const arr = await j(`${GOVMAP}/real-estate/deals/${pt.x},${pt.y}/2500`);
      for (const p of arr ?? []) {
        const n = parseInt(p.dealscount);
        if (n > 0 && normalizeCity(p.settlementNameHeb) === key) found.set(p.polygon_id, n);
      }
    } catch { /* transient */ }
    await sleep(250);
  }
  return [...found.entries()].map(([id, count]) => ({ id, count }));
}

/** Spread the sample across the density range instead of only the busiest. */
function sample(polys, n) {
  const sorted = [...polys].sort((a, b) => b.count - a.count);
  if (sorted.length <= n) return sorted;
  const step = (sorted.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => sorted[Math.round(i * step)]);
}

async function probeCity(city) {
  console.log(`\n${"═".repeat(58)}\n${city}\n${"═".repeat(58)}`);
  let polys;
  try { polys = await polygonsFor(city); }
  catch (e) { console.log(`  ✗ ${e.message}`); return []; }
  if (!polys.length) { console.log("  ✗ לא נמצאו פוליגונים"); return []; }

  const total = polys.reduce((s, p) => s + p.count, 0);
  console.log(`  ${polys.length} פוליגונים · ${total.toLocaleString("en")} עסקאות לפי האינדקס\n`);
  console.log(`  ${"אינדקס".padStart(8)}${"הוחזר".padStart(9)}   פוליגון`);

  const out = [];
  for (const p of sample(polys, 10)) {
    let got = -1;
    try {
      const d = await j(`${GOVMAP}/real-estate/neighborhood-deals/${p.id}?limit=2000&startDate=2016-01&endDate=2026-12`);
      got = Array.isArray(d?.data) ? d.data.length : 0;
    } catch { got = -1; }
    const mark = got < 0 ? "שגיאה" : got === 0 ? "0  ✗" : String(got);
    console.log(`  ${String(p.count).padStart(8)}${mark.padStart(9)}   ${p.id}`);
    out.push({ city, indexed: p.count, returned: got });
    await sleep(400);
  }
  return out;
}

// Deliberately spans the range: a large dense city, two mid-size Jewish towns
// with modest volume, and three of the localities that came back empty. If the
// break follows the COUNT it is a threshold in the source; if it follows the
// CITY, the theory is wrong and something else is going on.
const CITIES = ["חיפה", "יבנה", "אור עקיבא", "שפרעם", "טמרה", "כסיפה"];
const all = [];
for (const c of CITIES) all.push(...(await probeCity(c)));

console.log(`\n${"═".repeat(58)}\nסיכום — האם הסף תלוי בכמות או בעיר?\n${"═".repeat(58)}`);
const ok = all.filter((r) => r.returned > 0);
const zero = all.filter((r) => r.returned === 0);
if (ok.length) {
  console.log(`  הכי נמוך שכן החזיר נתונים:  ${Math.min(...ok.map((r) => r.indexed))} עסקאות באינדקס`);
}
if (zero.length) {
  console.log(`  הכי גבוה שהחזיר אפס:        ${Math.max(...zero.map((r) => r.indexed))} עסקאות באינדקס`);
}
const zeroCities = [...new Set(zero.map((r) => r.city))];
const okCities = [...new Set(ok.map((r) => r.city))];
console.log(`  ערים שהחזירו נתונים:        ${okCities.join(", ") || "—"}`);
console.log(`  ערים שהחזירו אפס בלבד:      ${zeroCities.filter((c) => !okCities.includes(c)).join(", ") || "—"}`);
console.log("");
