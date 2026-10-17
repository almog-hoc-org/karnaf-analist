/**
 * Is this pair of deal rows one sale reported twice?
 *
 * The decision scripts/flag-duplicate-deals.ts makes per pair, as a pure
 * function so it is pinned in tests. The script keeps the clustering, the
 * survivor choice and the writes.
 *
 * Two rules, because two kinds of twin exist:
 *  - the FEED twin: identical price, area and rooms within `windowDays` (the
 *    re-publication signature — 82.5% of provable twins are 1 day apart);
 *  - the SAME-ADDRESS twin: one flat, two channels or two register rows,
 *    where the area differs a little (53 vs 48.3 m² for the same flat on
 *    הערבה 1, two sources) or the dates drift by two or three weeks (two
 *    register rows for ויצמן 57 nineteen days apart). The address is the
 *    evidence, so a looser area and a longer window are allowed — and only
 *    when both rows carry a street and a house number.
 */
import { normStreet, normHouse } from "./addressKey";

export interface DupeCandidate {
  price: number;
  area: number;
  rooms: number | null;
  year_built: number | null;
  street: string | null;
  house_num: string | null;
}

export interface DupeTolerance {
  priceTol: number;
  areaTol: number;
  windowDays: number;
}

/** The same-address rule's bounds, deliberately not admin rules: they describe the evidence, not a preference. */
export const SAME_ADDRESS = { windowDays: 21, areaPct: 0.1 } as const;

export function addressOf(r: Pick<DupeCandidate, "street" | "house_num">): string | null {
  const s = normStreet(r.street);
  const h = r.house_num == null ? "" : normHouse(r.house_num).primary;
  return s && h ? `${s}|${h}` : null;
}

/** @param dd days between the two deals (non-negative) */
export function sameSale(a: DupeCandidate, b: DupeCandidate, dd: number, t: DupeTolerance): boolean {
  if ((a.rooms ?? -1) !== (b.rooms ?? -1)) return false;
  // build-year: equal, or unknown on one side (the govmap↔nadlan case)
  if (a.year_built != null && b.year_built != null && a.year_built !== b.year_built) return false;
  if (Math.abs(b.price - a.price) > t.priceTol) return false;
  const dArea = Math.abs(b.area - a.area);
  if (dd <= t.windowDays && dArea <= t.areaTol) return true;
  const addr = addressOf(a);
  if (!addr || addr !== addressOf(b)) return false;
  return dd <= SAME_ADDRESS.windowDays && dArea <= SAME_ADDRESS.areaPct * Math.max(a.area, b.area);
}

/** The widest window the sweep must look ahead for any rule. */
export function maxWindowDays(t: DupeTolerance): number {
  return Math.max(t.windowDays, SAME_ADDRESS.windowDays);
}
