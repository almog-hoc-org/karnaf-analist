#!/usr/bin/env tsx
/**
 * Click one neighbourhood on the live map, over HTTP, and check the deals come
 * back.
 *
 * WHAT THIS CATCHES, AND WHY IT NEEDS ITS OWN CHECK
 * A mapped neighbourhood carries two names: the OpenStreetMap name of the
 * shape, and the Tax Authority name on the price row. The panel's query must
 * send the second. They are usually identical — which is what makes the wrong
 * choice silent: the endpoint answers 200 with `total: 0`, and every
 * neighbourhood in the country looks like a neighbourhood nobody buys in.
 * Nothing throws, nothing logs, and the unit test can only prove the builder
 * picks the right field, not that the field matches what the deals table
 * actually stores.
 *
 * So this asks the SERVER, the way the panel does: read the map, take the most
 * expensive shape that has a price row, and fetch its deals. `total > 0` is the
 * assertion. It also reports the query plan cost indirectly — a slow answer
 * here means the (city_name, neighborhood, deal_date) index is missing.
 *
 * Exits 0 with a note when the pilot city has no collected map: that is the
 * normal state of every city outside the pilot, not a failure.
 *
 *   npx tsx scripts/probe-neighborhood-deals.ts [baseUrl] [city]
 */
const BASE = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const CITY = process.argv[3] ?? "תל אביב-יפו";
const UA = { "user-agent": "karnaf-probe/1.0" };

type Mapped = { neighborhood: string; summary: { neighborhood: string; sqm: number; n: number } | null };

async function main(): Promise<number> {
  let map: { neighborhoods: Mapped[]; matched: number } | null;
  try {
    const res = await fetch(`${BASE}/api/city-map/${encodeURIComponent(CITY)}`, {
      headers: UA, signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) { console.error(`FAIL: city-map ${CITY} → HTTP ${res.status}`); return 1; }
    map = (await res.json()).map ?? null;
  } catch (e) {
    console.error(`FAIL: city-map ${CITY} לא נענה — ${e instanceof Error ? e.message : e}`);
    return 1;
  }

  if (!map || !map.neighborhoods.length) {
    console.log(`· אין מפה ל${CITY} — הקולקטור לא רץ עליה. דילוג (זה המצב הרגיל מחוץ לפיילוט).`);
    return 0;
  }

  const priced = map.neighborhoods.filter((n) => n.summary);
  if (!priced.length) {
    console.error(`FAIL: ${map.neighborhoods.length} צורות ל${CITY} ואף אחת לא הוצמדה למחיר.`);
    return 1;
  }
  priced.sort((a, b) => b.summary!.sqm - a.summary!.sqm);

  let bad = 0;
  // Three, not one: a single lucky match would hide a join that works for the
  // shapes whose two names happen to be identical and fails for the rest.
  for (const n of priced.slice(0, 3)) {
    const taxName = n.summary!.neighborhood;
    const q = new URLSearchParams({ neighborhood: taxName, dealType: "sh", limit: "10", offset: "0" });
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/city-transactions/${encodeURIComponent(CITY)}?${q}`, {
      headers: UA, signal: AbortSignal.timeout(30_000),
    });
    const ms = Date.now() - t0;
    if (!res.ok) { console.error(`✗ ${taxName}: HTTP ${res.status}`); bad++; continue; }
    const j = (await res.json()) as { deals?: unknown[]; total?: number };
    const total = Number(j.total ?? 0);
    const osmNote = n.neighborhood === taxName ? "" : ` (שם המפה: ${n.neighborhood})`;
    if (total > 0) {
      console.log(`✓ ${taxName}${osmNote}: ${total.toLocaleString("he-IL")} עסקאות · ${ms}ms`);
    } else {
      console.error(`✗ ${taxName}${osmNote}: 0 עסקאות — השם שנשלח לשאילתה אינו תואם ל-nadlan_transactions`);
      bad++;
    }
  }

  if (bad) { console.error(`probe-neighborhood-deals: ${bad} מתוך 3 נכשלו`); return 1; }
  console.log(`probe-neighborhood-deals: תקין · ${map.matched} שכונות מוצמדות ב${CITY}`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
