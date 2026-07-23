import fs from "fs";
import path from "path";

/**
 * Aggregate the scraped nadlan settlement deals (data/nadlan_deals/{city}.json,
 * ~500 recent deals each, WITH build year) into per-room stats split by
 * ALL vs SECOND-HAND (dealYear − yearBuilt ≥ SECONDHAND_MIN_AGE).
 *
 * This is the build-year source the govmap data can't provide. It's recent
 * (the 500 most-recent settlement deals), so it answers "current prices, and
 * how second-hand differs from all deals" per city — including cities with no
 * govmap sub-area cache (e.g. Lod).
 */

export const SECONDHAND_MIN_AGE = 3;
const CACHE_DIR = path.resolve(process.cwd(), "data", "nadlan_deals");

// sanity bounds
const MIN_SQM = 2_000, MAX_SQM = 200_000, MIN_AREA = 20, MAX_AREA = 500;

export type RoomKey = "3" | "4" | "5" | "all";

export interface NadlanStat {
  avgSqm: number | null;
  medianSqm: number | null;
  avgPrice: number | null;
  medianPrice: number | null;
  n: number;
}

export interface NadlanCityAgg {
  city: string;
  totalRows: number | null;
  capturedAt: string;
  periodFrom: string;
  periodTo: string;
  /** per room ("3"/"4"/"5"/"all") → { all, secondhand } */
  byRoom: Record<RoomKey, { all: NadlanStat; secondhand: NadlanStat }>;
}

interface RawDeal {
  dealDate?: string; dealAmount?: number; roomNum?: number;
  assetArea?: number; yearBuilt?: number; priceSM?: number;
}

function median(v: number[]): number | null {
  if (v.length === 0) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function stat(deals: RawDeal[]): NadlanStat {
  const sqm = deals.map((d) => d.priceSM!).filter((x) => x! > 0);
  const price = deals.map((d) => d.dealAmount!).filter((x) => x! > 0);
  return {
    avgSqm: sqm.length ? sqm.reduce((s, v) => s + v, 0) / sqm.length : null,
    medianSqm: median(sqm),
    avgPrice: price.length ? price.reduce((s, v) => s + v, 0) / price.length : null,
    medianPrice: median(price),
    n: deals.length,
  };
}
function roomKey(rn: number | undefined): RoomKey | null {
  if (rn == null) return null;
  if (rn >= 2.5 && rn < 3.5) return "3";
  if (rn >= 3.5 && rn < 4.5) return "4";
  if (rn >= 4.5) return "5";
  return null; // 1-2 rooms excluded from the size breakdown (kept in "all")
}

export function loadNadlanCity(cityName: string): NadlanCityAgg | null {
  const f = path.join(CACHE_DIR, cityName.replace(/[/\\?%*:|"<>]/g, "_") + ".json");
  if (!fs.existsSync(f)) return null;
  let raw: { totalRows?: number; capturedAt?: string; deals?: RawDeal[] };
  try { raw = JSON.parse(fs.readFileSync(f, "utf-8")); } catch { return null; }
  const deals = (raw.deals ?? []).filter(
    (d) => d.dealDate && d.dealAmount && d.assetArea &&
      d.assetArea >= MIN_AREA && d.assetArea <= MAX_AREA &&
      (d.priceSM ?? 0) >= MIN_SQM && (d.priceSM ?? 0) <= MAX_SQM
  );
  if (deals.length === 0) return null;

  const isSecondHand = (d: RawDeal) => {
    const dy = Number((d.dealDate || "").slice(0, 4));
    const yb = Number(d.yearBuilt);
    return yb > 0 && dy - yb >= SECONDHAND_MIN_AGE;
  };

  const byRoom = {} as NadlanCityAgg["byRoom"];
  for (const rk of ["3", "4", "5", "all"] as RoomKey[]) {
    const inRoom = rk === "all" ? deals : deals.filter((d) => roomKey(d.roomNum) === rk);
    byRoom[rk] = { all: stat(inRoom), secondhand: stat(inRoom.filter(isSecondHand)) };
  }

  const dates = deals.map((d) => d.dealDate!).sort();
  return {
    city: cityName,
    totalRows: raw.totalRows ?? null,
    capturedAt: raw.capturedAt ?? "",
    periodFrom: dates[0].slice(0, 7),
    periodTo: dates[dates.length - 1].slice(0, 7),
    byRoom,
  };
}
