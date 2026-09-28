/**
 * Register rows that become deals of ours.
 *
 * lib/mekarkein.ts matches the register to deals we already hold. This file is
 * the other half: a register row that is a whole apartment, that no deal of ours
 * already reports, becomes a nadlan_transactions row with source 'mekarkein'.
 * That is what brings the months our own collectors cannot reach (in 9/2026 the
 * register ran to mid-September while our newest deal was from mid-August) and
 * the years before our addresses begin.
 *
 * STRICTER THAN THE MATCH, ON PURPOSE. A wrong match moves a parcel; a wrong
 * promotion adds a sale that never happened, or counts one sale twice. So:
 *  - apartments only (APARTMENT_NATURES), whole assets only (portion 1), with
 *    an area and a plausible price;
 *  - "already ours" is decided loosely: any deal of ours in the same city within
 *    a day of the date (the +1 shift included) at the same amount, exact or
 *    rounded to the thousand, blocks the row. A missed new deal costs one row; a
 *    duplicate skews a median.
 *  - the address is taken only when it is unambiguous (addressFor).
 *
 * Pure: no database, no network; pinned in tests/pure.test.ts.
 */
import { parcelNum, gushHelkaOf, type MekarkeinRow } from "./mekarkein";
import { roomBucket, SECONDHAND_MIN_AGE } from "./nadlanRow";
import { NADLAN_DATE_SHIFT_DAYS, shiftDate } from "./addressBackfill";
import { normStreet } from "./addressKey";

export const PROMOTE_SOURCE = "mekarkein";

/** The register's natures that are one dwelling. "מגורים" and "ד. מגורים" are
 *  mostly land and shares (median amount ~₪230k–₪500k), so they stay out. */
export const APARTMENT_NATURES: ReadonlySet<string> = new Set([
  "דירה בבית קומות", "דירת גן", "דירת גג",
  "קוטג' דו משפחתי", "קוטג' חד משפחתי", "קוטג' טורי", "בית בודד",
]);

export const PROMOTE_LIMITS = {
  minAmount: 100_000,
  maxAmount: 60_000_000,
  minArea: 20,
  maxArea: 500,
  minDate: "1998-01-01",
} as const;

export type SkipReason = "nature" | "portion" | "area" | "amount" | "date";

/** Why a register row cannot be a deal of ours, or null when it can. */
export function promoteSkipReason(r: Pick<MekarkeinRow, "nature" | "portion" | "area" | "amount" | "dealDate">): SkipReason | null {
  if (!r.nature || !APARTMENT_NATURES.has(r.nature)) return "nature";
  if (r.portion == null || r.portion < 0.999) return "portion";
  if (r.area == null || r.area < PROMOTE_LIMITS.minArea || r.area > PROMOTE_LIMITS.maxArea) return "area";
  if (r.amount < PROMOTE_LIMITS.minAmount || r.amount > PROMOTE_LIMITS.maxAmount) return "amount";
  if (r.dealDate < PROMOTE_LIMITS.minDate) return "date";
  return null;
}

const roundK = (n: number) => Math.round(n / 1000);

/**
 * Our deals of one city, as "date → amounts" in both exact and thousands form,
 * so "is this register row already ours" is two set lookups per day tried.
 */
export interface KnownIndex { exact: Map<string, Set<number>>; rounded: Map<string, Set<number>> }

export function knownIndex(ours: Array<{ dealDate: string; price: number | null }>): KnownIndex {
  const exact = new Map<string, Set<number>>(), rounded = new Map<string, Set<number>>();
  const add = (m: Map<string, Set<number>>, k: string, v: number) => { const s = m.get(k); if (s) s.add(v); else m.set(k, new Set([v])); };
  for (const o of ours) {
    if (!o.price || !o.dealDate) continue;
    const d = o.dealDate.slice(0, 10);
    add(exact, d, Math.round(o.price));
    add(rounded, d, roundK(o.price));
  }
  return { exact, rounded };
}

/** True when any deal of ours could be this register row (±1 day, exact or rounded amount). */
export function isKnown(r: Pick<MekarkeinRow, "dealDate" | "amount">, idx: KnownIndex): boolean {
  const days = [r.dealDate, shiftDate(r.dealDate, NADLAN_DATE_SHIFT_DAYS), shiftDate(r.dealDate, -NADLAN_DATE_SHIFT_DAYS)];
  for (const d of days) {
    if (idx.exact.get(d)?.has(Math.round(r.amount))) return true;
    if (idx.rounded.get(d)?.has(roundK(r.amount))) return true;
  }
  return false;
}

/** What over.org.il's /api/nadlan/parcel/{gush}/{helka} says about one parcel, reduced to what we use. */
export interface OverParcel {
  /** more than one parcel answers to this gush-helka (the register has no gush suffix) */
  ambiguous: boolean;
  addresses: Array<{ street: string; house: string }>;
}

/** Parse the endpoint's JSON; tolerant of missing fields, never throws. */
export function parseOverParcel(json: unknown): OverParcel {
  const data = (json as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data) || data.length === 0) return { ambiguous: false, addresses: [] };
  if (data.length > 1) return { ambiguous: true, addresses: [] };
  const identity = (data[0] as { identity?: { addresses?: unknown[]; gp_ambiguous?: boolean } }).identity;
  const out: Array<{ street: string; house: string }> = [];
  for (const a of identity?.addresses ?? []) {
    const x = a as { street?: unknown; house?: unknown; suffix?: unknown };
    const street = typeof x.street === "string" ? x.street.trim() : "";
    if (!street) continue;
    const house = x.house == null ? "" : `${x.house}${typeof x.suffix === "string" && x.suffix.trim() ? x.suffix.trim() : ""}`;
    out.push({ street, house });
  }
  return { ambiguous: identity?.gp_ambiguous === true, addresses: out };
}

export type AddressVia = "sub" | "parcel" | "over" | "over-street";
export interface PromoteAddress { street: string | null; houseNum: string | null; via: AddressVia | null }

/**
 * Street and house for a promoted row, first from our own deals (the same flat,
 * then the same parcel — lib/mekarkein inheritAddresses' rule), then from
 * over.org.il's parcel↔address table. Each level is taken only when it names one
 * address; over.org.il may still give the street alone when every address on the
 * parcel is on one street (a building with two entrances).
 *
 * `ourBySub` / `ourByGh` map "g-h-s" / "g-h" to the set of "street\0house" our
 * deals report there.
 */
export function addressFor(
  gush: number, helka: number, sub: number,
  ourBySub: Map<string, Set<string>>, ourByGh: Map<string, Set<string>>,
  over: OverParcel | null,
): PromoteAddress {
  const one = (s: Set<string> | undefined) => (s && s.size === 1 ? [...s][0].split("\u0000") : null);
  const bySub = one(ourBySub.get(parcelNum(gush, helka, sub)));
  if (bySub) return { street: bySub[0], houseNum: bySub[1] || null, via: "sub" };
  const byGh = one(ourByGh.get(`${gush}-${helka}`));
  if (byGh) return { street: byGh[0], houseNum: byGh[1] || null, via: "parcel" };
  if (over && !over.ambiguous && over.addresses.length) {
    const streets = new Set(over.addresses.map((a) => a.street));
    if (streets.size === 1) {
      const houses = new Set(over.addresses.map((a) => a.house).filter(Boolean));
      const street = [...streets][0];
      return houses.size === 1 ? { street, houseNum: [...houses][0], via: "over" } : { street, houseNum: null, via: "over-street" };
    }
  }
  return { street: null, houseNum: null, via: null };
}

/** The donor maps addressFor reads, from our rows that have parcel, street and house. */
export function ourParcelDonors(rows: Array<{ parcelNum: string | null; street: string | null; houseNum: string | null }>): {
  bySub: Map<string, Set<string>>; byGh: Map<string, Set<string>>;
} {
  const bySub = new Map<string, Set<string>>(), byGh = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, v: string) => { const s = m.get(k); if (s) s.add(v); else m.set(k, new Set([v])); };
  for (const r of rows) {
    if (!r.parcelNum || !r.street?.trim() || !r.houseNum?.trim()) continue;
    const p = r.parcelNum.trim().split("-").map((x) => String(Number(x))).join("-");
    const v = `${r.street.trim()}\u0000${r.houseNum.trim()}`;
    if (p.split("-").length === 3) add(bySub, p, v);
    const gh = gushHelkaOf(p);
    if (gh) add(byGh, gh, v);
  }
  return { bySub, byGh };
}

/**
 * A street name from over.org.il in OUR spelling for that city when one exists
 * ("שד' ירושלים" and "שדרות ירושלים" are one street page, not two).
 */
export function streetSpeller(ourStreets: Array<{ street: string; n: number }>): (s: string) => string {
  const best = new Map<string, { street: string; n: number }>();
  for (const o of ourStreets) {
    const k = normStreet(o.street);
    if (!k) continue;
    const cur = best.get(k);
    if (!cur || o.n > cur.n) best.set(k, o);
  }
  return (s) => best.get(normStreet(s))?.street ?? s;
}

/** The nadlan_transactions tuple (NADLAN_ROW_COLS order) for a promoted row. */
export function promotedTuple(r: MekarkeinRow, city: string, cbsCode: string | null, addr: PromoteAddress): unknown[] {
  const year = Number(r.dealDate.slice(0, 4));
  const yb = r.yearBuilt && r.yearBuilt > 1800 && r.yearBuilt <= year + 5 ? r.yearBuilt : null;
  const isSH = yb && year - yb >= SECONDHAND_MIN_AGE ? 1 : 0;
  const area = r.area!;
  return [
    city, cbsCode, r.dealDate, year, r.rooms, roomBucket(r.rooms), area, r.amount, Math.round(r.amount / area),
    yb, isSH, null, addr.street, addr.houseNum, null,
    parcelNum(r.gush, r.helka, r.sub), null, null, null, r.id, PROMOTE_SOURCE,
  ];
}
