// Why does the deals endpoint return nothing? Swallow no errors, print everything.
//
// ═══ RUN ON A MACHINE IN ISRAEL. ═══
//
//   node probe-deals-endpoint.mjs
//
// WHAT THE PREVIOUS DIAGNOSTIC FOUND, AND WHY IT CHANGED THE QUESTION
// It resolved Shefa-'Amr to 111 matching polygons and the authority's own
// index reported 1,141 deals in them. Kuseife: 7 polygons, 51 deals. Ma'ale
// Iron: 131 polygons, 1,744 deals. Then the per-polygon fetch returned ZERO
// deals for every single one.
//
// So this is not the property-type filter — that never got the chance to run —
// and it is not name matching, which worked. Something about the second call,
// /real-estate/neighborhood-deals/{polygon}, comes back empty while the first
// call insists there are deals there.
//
// The collector cannot tell us which, because that fetch sits inside
// `catch { /* skip */ }`: a 404, a 500, an HTML error page and a genuinely
// empty result all produce the same silent zero. The same shape of silent
// failure as the missing pdfplumber and the geo-blocked probe before it.
//
// This asks the same question with nothing swallowed — status line, content
// type, body — and asks it of a city known to hold plenty of data as well as
// one known to hold almost none. That comparison is what separates "the
// endpoint changed for everyone" from "these localities are special", and the
// two need completely different fixes.

const GOVMAP = "https://www.govmap.gov.il/api";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalizeCity = (n) => !n ? "" :
  n.replace(/["'`]/g, "").replace(/[-–]/g, " ").replace(/יי/g, "י").replace(/וו/g, "ו").replace(/\s+/g, " ").trim();

async function raw(url, options) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "RealEstateDashboard/1.0", ...(options?.headers || {}) },
  });
  const body = await res.text();
  return { status: res.status, ct: res.headers.get("content-type") ?? "", body };
}

/** One polygon id for a city, via the index call that we know works. */
async function firstPolygon(city) {
  const a = await raw(`${GOVMAP}/search-service/autocomplete`, {
    method: "POST",
    body: JSON.stringify({ searchText: city, language: "he", isAccurate: false, maxResults: 10 }),
  });
  const m = (JSON.parse(a.body).results ?? []).map((r) => r?.shape?.match(/POINT\(([^ ]+) ([^ ]+)\)/)).find(Boolean);
  if (!m) return null;
  const x = Math.round(+m[1]), y = Math.round(+m[2]);
  const d = await raw(`${GOVMAP}/real-estate/deals/${x},${y}/2500`);
  if (!d.ct.includes("json")) return null;
  const arr = JSON.parse(d.body) ?? [];
  const mine = arr.filter((p) => parseInt(p.dealscount) > 0 && normalizeCity(p.settlementNameHeb) === normalizeCity(city));
  mine.sort((a, b) => parseInt(b.dealscount) - parseInt(a.dealscount));
  return mine[0] ?? null;
}

async function probe(city) {
  console.log(`\n${"═".repeat(64)}\n${city}\n${"═".repeat(64)}`);
  const poly = await firstPolygon(city);
  if (!poly) { console.log("  ✗ לא נמצא פוליגון — בעיה מוקדם יותר בשרשרת."); return; }
  console.log(`  פוליגון ${poly.polygon_id} · הרשות מדווחת ${poly.dealscount} עסקאות בו`);

  // Exactly what the collector sends, then variations — so a difference in the
  // response points at which part of the request is now wrong.
  const variants = [
    ["כמו הקולקטור", `${GOVMAP}/real-estate/neighborhood-deals/${poly.polygon_id}?limit=2000&startDate=2023-06&endDate=2026-12`],
    ["בלי טווח תאריכים", `${GOVMAP}/real-estate/neighborhood-deals/${poly.polygon_id}?limit=2000`],
    ["בלי פרמטרים כלל", `${GOVMAP}/real-estate/neighborhood-deals/${poly.polygon_id}`],
    ["תאריך מלא YYYY-MM-DD", `${GOVMAP}/real-estate/neighborhood-deals/${poly.polygon_id}?limit=2000&startDate=2023-06-01&endDate=2026-12-31`],
  ];

  for (const [label, url] of variants) {
    const r = await raw(url);
    let summary;
    if (r.ct.includes("json")) {
      try {
        const j = JSON.parse(r.body);
        const n = Array.isArray(j?.data) ? j.data.length : Array.isArray(j) ? j.length : null;
        summary = n === null ? `JSON, מפתחות: ${Object.keys(j ?? {}).join(",") || "(ריק)"}` : `${n} עסקאות`;
        if (n > 0) {
          const s = (Array.isArray(j.data) ? j.data : j)[0];
          summary += ` · דוגמה: ${s.dealDate ?? "?"} · ${s.dealNatureDescription ?? "?"} · ${s.settlementNameHeb ?? "?"}`;
        }
      } catch { summary = "JSON פגום"; }
    } else {
      summary = `${r.ct || "ללא סוג"} — ${r.body.trim().slice(0, 100).replace(/\s+/g, " ")}`;
    }
    console.log(`  ${String(r.status).padEnd(4)} ${label.padEnd(22)} ${summary}`);
    await sleep(500);
  }
}

// A city the database is full of, next to two it is empty of. If the first also
// returns nothing, the endpoint changed for everyone and the whole collector is
// dead — a far bigger problem than any one group of localities.
for (const c of ["חיפה", "שפרעם", "כסיפה"]) {
  try { await probe(c); } catch (e) { console.error(`\n✗ ${c}: ${e.message}`); }
}
console.log("");
