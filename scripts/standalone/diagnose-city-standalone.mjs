// Standalone twin of scripts/diagnose-city.ts — no repo, no npm install.
//
// ═══ RUN ON A MACHINE IN ISRAEL. govmap answers no one else. ═══
//
//   node diagnose-city.mjs "שפרעם" "כסיפה" "מעלה עירון"
//
// WHY A SECOND COPY EXISTS
// The question it answers is urgent — the site is about to be published while
// under-representing 53 localities — and the machine in Israel that can ask it
// does not have the repository checked out. Cloning and installing to run one
// read-only diagnostic is a worse trade than a file that runs on bare Node.
//
// It duplicates normalizeCity and isResidentialApartment ON PURPOSE, verbatim.
// The point is to measure what the COLLECTOR does; importing a shared helper
// would be better engineering for production code and worse for this, because
// a later edit to the helper would silently change what this reports about the
// version that ran. If the collector's filters change, this file is expected to
// fall out of date — that is the correct behaviour for a snapshot diagnostic.

const GOVMAP = "https://www.govmap.gov.il/api";
const RADIUS = 2500;
const RINGS = [0, 2000, 4000, 6000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const normalizeCity = (n) => !n ? "" :
  n.replace(/["'`]/g, "").replace(/[-–]/g, " ").replace(/יי/g, "י").replace(/וו/g, "ו").replace(/\s+/g, " ").trim();

const isResidentialApartment = (nature) => {
  if (!nature) return false;
  if (/קבוצת רכישה|קרקע|מסחרי|משרד|חנות|חניה|מחסן|תעשיה|ללא תיכנון|מלון|דיור מוגן/.test(nature)) return false;
  return ["דירה", "דירת גן", "דירת גג", "פנטהאוז", "קוטג'", "בית בודד", "דו משפחתי", "מיני פנטהאוז"]
    .some((p) => nature.includes(p));
};

async function gf(url, options) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "RealEstateDashboard/1.0", ...(options?.headers || {}) },
  });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) throw new Error(`govmap החזיר ${ct || "לא ידוע"} — האם אתה בישראל, בלי VPN?`);
  return res;
}

async function diagnose(cityName) {
  const key = normalizeCity(cityName);
  console.log(`\n${"═".repeat(60)}\n${cityName}   (מנורמל: "${key}")\n${"═".repeat(60)}`);

  const data = await (await gf(`${GOVMAP}/search-service/autocomplete`, {
    method: "POST",
    body: JSON.stringify({ searchText: cityName, language: "he", isAccurate: false, maxResults: 10 }),
  })).json();
  const results = data.results ?? [];
  const settlements = results.filter((r) => r.type === "settlement");
  console.log(`\n1. חיפוש שם: ${results.length} תוצאות, ${settlements.length} מסוג יישוב`);
  for (const r of results.slice(0, 5)) console.log(`     ${String(r.type ?? "?").padEnd(12)} ${r.text ?? r.name ?? "?"}`);
  if (!results.length) { console.log("   ✗ govmap לא מזהה את השם — זה הכשל."); return; }

  const pts = [];
  for (const r of (settlements.length ? settlements : results.slice(0, 2))) {
    const m = r?.shape?.match(/POINT\(([^ ]+) ([^ ]+)\)/);
    if (m) pts.push({ x: Math.round(+m[1]), y: Math.round(+m[2]) });
  }
  if (!pts.length) { console.log("   ✗ אין נקודות ציון — הכשל כאן."); return; }

  const sweep = [];
  for (const c of pts) {
    sweep.push(c);
    for (const r of RINGS) {
      if (!r) continue;
      for (let a = 0; a < 360; a += 45) {
        const rad = (a * Math.PI) / 180;
        sweep.push({ x: Math.round(c.x + r * Math.cos(rad)), y: Math.round(c.y + r * Math.sin(rad)) });
      }
    }
  }

  const matched = new Map(), nearby = new Map();
  for (const pt of sweep) {
    try {
      const arr = await (await gf(`${GOVMAP}/real-estate/deals/${pt.x},${pt.y}/${RADIUS}`)).json();
      for (const p of arr ?? []) {
        const n = parseInt(p.dealscount);
        if (!(n > 0)) continue;
        nearby.set(p.settlementNameHeb, (nearby.get(p.settlementNameHeb) ?? 0) + n);
        if (normalizeCity(p.settlementNameHeb) === key) matched.set(p.polygon_id, n);
      }
    } catch { /* transient */ }
    await sleep(300);
  }

  console.log(`\n2. פוליגונים תואמים: ${matched.size}`);
  console.log(`   שמות יישובים בסביבה (מספר עסקאות):`);
  for (const [name, n] of [...nearby.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`     ${normalizeCity(name) === key ? "✓" : " "} ${String(n).padStart(6)}  ${name}`);
  }
  if (!matched.size) {
    console.log(`\n   ✗ אף פוליגון לא תואם את השם. אם למעלה מופיעים כפרים סמוכים,`);
    console.log(`     זו מועצה אזורית והעסקאות רשומות תחת שמות המרכיבים.`);
    return;
  }

  const picked = [...matched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 120).map((e) => e[0]);
  const natures = new Map();
  let total = 0, kept = 0;
  for (const pid of picked) {
    for (const [s, e] of [["2016-01", "2020-01"], ["2020-01", "2023-06"], ["2023-06", "2026-12"]]) {
      try {
        const d = await (await gf(`${GOVMAP}/real-estate/neighborhood-deals/${pid}?limit=2000&startDate=${s}&endDate=${e}`)).json();
        for (const deal of d.data ?? []) {
          if (normalizeCity(deal.settlementNameHeb) !== key) continue;
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

  console.log(`\n3. סוגי נכס — ${total.toLocaleString("en")} עסקאות, ${kept.toLocaleString("en")} עוברות את המסנן`);
  if (!total) { console.log("   (לא הוחזרו עסקאות)"); return; }
  console.log(`   ${"עובר".padEnd(8)}${"כמות".padStart(7)}  סוג`);
  for (const [nature, c] of [...natures.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 20)) {
    console.log(`   ${(c.kept > 0 ? "✓" : "✗ נזרק").padEnd(8)}${String(c.total).padStart(7)}  ${nature}`);
  }
  const dropped = total - kept;
  console.log(dropped > 0
    ? `\n   ⚠ ${dropped.toLocaleString("en")} (${((dropped / total) * 100).toFixed(0)}%) נזרקות ע"י מסנן סוג הנכס — בשקט, בלי לוג.`
    : `\n   ✓ מסנן סוג הנכס לא זורק כלום כאן. הכשל במקום אחר.`);
}

const cities = process.argv.slice(2);
if (!cities.length) { console.error('שימוש: node diagnose-city.mjs "שפרעם" "כסיפה"'); process.exit(1); }
for (const c of cities) {
  try { await diagnose(c); } catch (e) { console.error(`\n✗ ${c}: ${e.message}`); }
}
console.log("");
