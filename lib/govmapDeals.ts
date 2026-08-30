/**
 * The govmap deal-fetching plumbing, shared by the collector
 * (scripts/collect-govmap-transactions.ts) and the address-backfill campaign
 * (scripts/backfill-govmap-addresses.ts).
 *
 * WHY EXTRACTED. Both jobs walk the same three endpoints — autocomplete →
 * polygon sweep → per-polygon deals — with the same rate limit, the same
 * retry/backoff, and the same geo-block detection. Duplicating the sweep
 * would fork exactly the parts that must stay identical: govmap throttles by
 * behaviour, and two callers with two different paces are two chances to get
 * blocked. Behaviour here is a verbatim move from the collector, not a
 * redesign.
 *
 * govmap is the ONLY channel that carries per-deal addresses (streetNameHeb,
 * houseNum, floorNo) — the nadlan channel reports the neighbourhood at best.
 * Its prices are noisy and are banned from the statistics; these fetches are
 * used for deal rows and address donation only.
 */
import { normalizeCity } from "./cityAliases";
import { ilFetch, ilProxyUrl } from "./ilFetch";

export const GOVMAP_BASE = "https://www.govmap.gov.il/api";
export const REQUEST_DELAY_MS = 300;
export const SWEEP_RADIUS = 2500;
export const RING_OFFSETS_M = [0, 2000, 4000, 6000];
// 45 polygons dropped whole neighbourhoods in big cities (TLV kept only 36% of
// deals) — 120 covers the full polygon list almost everywhere.
export const MAX_POLYGONS = 120;
export const GOVMAP_END_DATE = "2026-12";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GovmapRawDeal {
  dealId?: number; dealDate: string; dealAmount: number; assetRoomNum: number | null;
  assetArea: number | null; neighborhood: string | null; settlementNameHeb?: string | null;
  settlementId?: number; dealNatureDescription?: string | null;
  streetNameHeb?: string | null; houseNum?: string | number | null;
  /** stringified on insert: `floor` is a TEXT column (Hebrew floor names), and an
   *  integer stored there makes Prisma reject the whole row on read. */
  floorNo?: string | number | null;
}

export function isResidentialApartment(nature: string | null | undefined): boolean {
  if (!nature) return false;
  if (/קבוצת רכישה|קרקע|מסחרי|משרד|חנות|חניה|מחסן|תעשיה|ללא תיכנון|מלון|דיור מוגן/.test(nature)) return false;
  return ["דירה", "דירת גן", "דירת גג", "פנטהאוז", "קוטג'", "בית בודד", "דו משפחתי", "מיני פנטהאוז"].some((p) => nature.includes(p));
}

/**
 * Date-window slicing. Slicing exists only to stay under the endpoint's
 * 2000-deals-per-call cap, so the slice boundaries have to sit INSIDE the
 * window — hard-coding them breaks the moment the window narrows: a start of
 * 2021-01 against a fixed first slice ending 2020-01 asks for a range that
 * runs backwards. Derived from the window instead: ten years get their three
 * slices, a quarterly top-up gets one.
 */
export function govmapWindows(
  start: string,
  end: string = GOVMAP_END_DATE,
  sliceMarks: string[] = ["2020-01", "2023-06"]
): ReadonlyArray<readonly [string, string]> {
  const marks = [start, ...sliceMarks.filter((m) => m > start && m < end), end];
  return marks.slice(0, -1).map((s, i) => [s, marks[i + 1]] as const);
}

/** Fetch with retry on throttle/transient errors (govmap returns HTML/5xx under load). */
export async function govmapFetch(url: string, options?: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // ilFetch, not fetch: govmap is geo-restricted to Israel and answers
      // everyone else with an HTML shell. Without KARNAF_IL_PROXY set this IS
      // plain fetch, so nothing changes for a run from inside Israel.
      const res = await ilFetch(url, { ...options, headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "RealEstateDashboard/1.0", ...(options?.headers || {}) } });
      if (!res.ok) throw new Error(`Govmap ${res.status}`);
      // A 200 carrying HTML is the geo-block, not a deal list. Saying so once
      // beats 168 cities each reporting "Unexpected token '<'".
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("json")) {
        throw new Error(
          `Govmap החזיר ${ct || "תוכן לא ידוע"} במקום JSON — ${ilProxyUrl() ? "גם דרך הפרוקסי" : "חסימה גיאוגרפית; הגדר KARNAF_IL_PROXY"}`
        );
      }
      return res;
    } catch (e) { lastErr = e; await sleep(800 * (attempt + 1)); }
  }
  throw lastErr;
}

/** True when the error is the geo-block — every later city would fail
 *  identically, so callers should stop the whole run instead of burning the
 *  remaining cities on the same answer. Two shapes, both measured: an HTML
 *  shell served with HTTP 200 ("במקום JSON"), and a plain HTTP 403 — the
 *  form the VPS actually got on the first dispatch run (165 cities × 5s of
 *  identical 403s before anyone knew). */
export function isGeoBlockError(e: unknown): boolean {
  return e instanceof Error && (/במקום JSON/.test(e.message) || /Govmap 403/.test(e.message));
}

/** ALL settlement candidate centre points (there can be several "יבנה"s; the right one is
 *  whichever yields matching polygons — so we sweep from all of them). */
export async function searchCityPoints(cityName: string): Promise<{ x: number; y: number }[]> {
  const res = await govmapFetch(`${GOVMAP_BASE}/search-service/autocomplete`, { method: "POST", body: JSON.stringify({ searchText: cityName, language: "he", isAccurate: false, maxResults: 10 }) });
  const data = await res.json();
  const pts: { x: number; y: number }[] = [];
  const cands = (data.results ?? []).filter((r: { type: string }) => r.type === "settlement");
  for (const r of (cands.length ? cands : (data.results ?? []).slice(0, 2))) {
    const m = r?.shape?.match(/POINT\(([^ ]+) ([^ ]+)\)/);
    if (m) pts.push({ x: Math.round(parseFloat(m[1])), y: Math.round(parseFloat(m[2])) });
  }
  return pts;
}

/** Sweep grid → the city's deal polygons, busiest first, capped at MAX_POLYGONS. */
export async function discoverCityPolygons(cityKey: string, centers: { x: number; y: number }[]): Promise<string[]> {
  const sweep: { x: number; y: number }[] = [];
  for (const c of centers) {
    sweep.push({ x: c.x, y: c.y });
    for (const r of RING_OFFSETS_M) { if (r === 0) continue; for (let a = 0; a < 360; a += 45) { const rad = (a * Math.PI) / 180; sweep.push({ x: Math.round(c.x + r * Math.cos(rad)), y: Math.round(c.y + r * Math.sin(rad)) }); } }
  }
  const polys = new Map<string, number>();
  for (const pt of sweep) {
    try {
      const arr: { polygon_id: string; dealscount: string; settlementNameHeb: string }[] = await (await govmapFetch(`${GOVMAP_BASE}/real-estate/deals/${pt.x},${pt.y}/${SWEEP_RADIUS}`)).json();
      for (const p of arr ?? []) { if (parseInt(p.dealscount) > 0 && normalizeCity(p.settlementNameHeb) === cityKey && !polys.has(p.polygon_id)) polys.set(p.polygon_id, parseInt(p.dealscount)); }
    } catch (e) { if (isGeoBlockError(e)) throw e; /* transient */ }
    await sleep(REQUEST_DELAY_MS);
  }
  return [...polys.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_POLYGONS).map((e) => e[0]);
}

/**
 * The full per-city fetch: centre points → polygons → residential deals over
 * the given windows, deduplicated by dealId. Exactly the collector's walk.
 */
export async function fetchCityDeals(
  cityName: string,
  windows: ReadonlyArray<readonly [string, string]>
): Promise<GovmapRawDeal[]> {
  const cityKey = normalizeCity(cityName);
  const centers = await searchCityPoints(cityName);
  if (centers.length === 0) return [];
  await sleep(REQUEST_DELAY_MS);
  const picked = await discoverCityPolygons(cityKey, centers);
  if (picked.length === 0) return [];

  const seen = new Set<string>();
  const deals: GovmapRawDeal[] = [];
  for (const pid of picked) {
    for (const [s, e] of windows) {
      try {
        const d: { data?: GovmapRawDeal[] } = await (await govmapFetch(`${GOVMAP_BASE}/real-estate/neighborhood-deals/${pid}?limit=2000&startDate=${s}&endDate=${e}`)).json();
        for (const deal of d.data ?? []) {
          if (normalizeCity(deal.settlementNameHeb) !== cityKey) continue;
          if (!isResidentialApartment(deal.dealNatureDescription)) continue;
          const key = String(deal.dealId ?? `${deal.dealDate}-${deal.dealAmount}-${deal.assetArea}`);
          if (seen.has(key)) continue;
          seen.add(key);
          deals.push(deal);
        }
      } catch (e) { if (isGeoBlockError(e)) throw e; /* skip */ }
      await sleep(REQUEST_DELAY_MS);
    }
  }
  return deals;
}
