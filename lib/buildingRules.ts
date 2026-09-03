/**
 * The pure rules of the street and address pages — client-safe, no database.
 * lib/addressPages.ts (server) applies them to rows; tests/pure.test.ts pins
 * every one, because each is a claim the page makes about a real building.
 */
import { normHouse, normStreet } from "./addressKey";

/** A deal as the address pages see it. */
export interface AddressDeal {
  id: number;
  dealDate: string;
  dealYear: number;
  rooms: number | null;
  area: number | null;
  price: number | null;
  priceSqm: number | null;
  yearBuilt: number | null;
  isSecondHand: boolean;
  floor: string | null;
  street: string | null;
  houseNum: string | null;
  neighborhood: string | null;
  luxury: boolean;
}

/* ───────────── URL ↔ address ───────────── */

/**
 * One URL segment for a building: "שדרות רוטשילד 16". The house number is the
 * LAST whitespace token when it starts with a digit — a street whose name
 * ends in a number ("דרך 90") therefore cannot have an address page under
 * this scheme, which is the honest limit rather than a guess.
 */
export function addressSlug(street: string, house: string): string {
  return `${street.trim()} ${house.trim()}`.replace(/\s+/g, " ").trim();
}

export function parseAddressSlug(slug: string): { street: string; house: string } | null {
  const s = slug.replace(/\s+/g, " ").trim();
  const m = s.match(/^(.*\S)\s+(\d[\dא-תA-Za-z\-–/]*)$/);
  if (!m) return null;
  const house = normHouse(m[2]).primary;
  if (!house) return null;
  return { street: m[1], house };
}

/** Same building? Compares normalised keys, so "שד' רוטשילד 16" = "שדרות רוטשילד 16". */
export function sameBuilding(a: { street: string; house: string }, b: { street: string; house: string }): boolean {
  return normStreet(a.street) === normStreet(b.street) && normHouse(a.house).primary === normHouse(b.house).primary;
}

/* ───────────── statistics ───────────── */

export function medianOf(values: Array<number | null | undefined>): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export interface YearStat {
  year: number;
  n: number;
  medianSqm: number | null;
  medianPrice: number | null;
}

/** Per-year counts and medians, ascending by year. Luxury deals count but never price. */
export function yearStats(deals: AddressDeal[]): YearStat[] {
  const by = new Map<number, AddressDeal[]>();
  for (const d of deals) by.set(d.dealYear, [...(by.get(d.dealYear) ?? []), d]);
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, rows]) => ({
      year,
      n: rows.length,
      medianSqm: medianOf(rows.filter((r) => !r.luxury).map((r) => r.priceSqm)),
      medianPrice: medianOf(rows.filter((r) => !r.luxury).map((r) => r.price)),
    }));
}

/* ───────────── buildings on a street ───────────── */

export interface BuildingRow {
  house: string;
  /** the most common raw spelling of the number, for display */
  label: string;
  n: number;
  lastDate: string;
  medianSqm: number | null;
  yearBuilt: number | null;
}

/** Group a street's deals by building (normalised house number). */
export function bucketBuildings(deals: AddressDeal[]): BuildingRow[] {
  const by = new Map<string, AddressDeal[]>();
  for (const d of deals) {
    const h = normHouse(d.houseNum).primary;
    if (!h) continue;
    by.set(h, [...(by.get(h) ?? []), d]);
  }
  const out: BuildingRow[] = [];
  for (const [house, rows] of by) {
    const labels = new Map<string, number>();
    for (const r of rows) { const l = String(r.houseNum ?? "").trim(); labels.set(l, (labels.get(l) ?? 0) + 1); }
    const label = [...labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? house;
    out.push({
      house, label, n: rows.length,
      lastDate: rows.map((r) => r.dealDate).sort().at(-1) ?? "",
      medianSqm: medianOf(rows.filter((r) => !r.luxury).map((r) => r.priceSqm)),
      yearBuilt: modeOf(rows.map((r) => r.yearBuilt)),
    });
  }
  // busiest first, then by number
  return out.sort((a, b) => b.n - a.n || houseSort(a.house, b.house));
}

function houseSort(a: string, b: string): number {
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  return na - nb || a.localeCompare(b);
}

export function modeOf<T>(values: Array<T | null | undefined>): T | null {
  const counts = new Map<T, number>();
  for (const v of values) if (v != null && v !== 0) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null, bestN = 0;
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
  return best;
}

/* ───────────── inside one building ───────────── */

/**
 * The flats of one building, grouped as "probably the same apartment":
 * same floor, same room count, and areas within AREA_TOLERANCE_SQM of the
 * first deal in the group (a reported area drifts a metre or two between
 * reports of the same flat). Clustering, not rounding: rounding to a bucket
 * splits 100 and 101 m² when the bucket edge falls between them.
 */
export const AREA_TOLERANCE_SQM = 3;

export function apartmentKey(d: AddressDeal): string | null {
  if (d.area == null || d.rooms == null) return null;
  const floor = (d.floor ?? "").trim() || "?";
  return `${floor}|${d.rooms}`;
}

export interface ApartmentThread {
  key: string;
  floor: string;
  rooms: number;
  area: number;
  deals: AddressDeal[];
  /** ₪/m² change from the first sale to the last, when both priced */
  changePct: number | null;
  yearsApart: number | null;
}

/** Deals grouped into apartments that sold more than once, most-resold first. */
export function apartmentThreads(deals: AddressDeal[]): ApartmentThread[] {
  const by = new Map<string, AddressDeal[]>();
  for (const d of deals) {
    const k = apartmentKey(d);
    if (!k) continue;
    by.set(k, [...(by.get(k) ?? []), d]);
  }
  const out: ApartmentThread[] = [];
  for (const [key, rows] of by) {
    // cluster by area within the group
    const byArea = [...rows].sort((a, b) => a.area! - b.area!);
    let cluster: AddressDeal[] = [];
    const flush = () => {
      if (cluster.length < 2) { cluster = []; return; }
      const sorted = [...cluster].sort((a, b) => a.dealDate.localeCompare(b.dealDate));
      const first = sorted[0], last = sorted[sorted.length - 1];
      const changePct = first.priceSqm && last.priceSqm ? (last.priceSqm / first.priceSqm - 1) * 100 : null;
      out.push({
        key: `${key}|${Math.round(first.area!)}`, floor: (first.floor ?? "").trim() || "?", rooms: first.rooms!, area: first.area!,
        deals: sorted, changePct, yearsApart: last.dealYear - first.dealYear,
      });
      cluster = [];
    };
    for (const d of byArea) {
      if (cluster.length && d.area! - cluster[0].area! > AREA_TOLERANCE_SQM) flush();
      cluster.push(d);
    }
    flush();
  }
  return out.sort((a, b) => b.deals.length - a.deals.length || (b.yearsApart ?? 0) - (a.yearsApart ?? 0));
}

/**
 * Is this building a developer's project — sold new, many flats, in a short
 * window? Then the page should say so: the first-sale prices are a
 * developer's list, not a resale market, and the two must not be averaged.
 *
 * Rule: at least `minDeals` NEW (not second-hand) deals whose dates fall
 * within `months` of the earliest new deal, and one dominant build year.
 */
export function detectProject(
  deals: AddressDeal[],
  opts: { minDeals: number; months: number }
): { isProject: boolean; newDeals: number; firstSale: string | null; lastSale: string | null; yearBuilt: number | null } {
  const fresh = deals.filter((d) => !d.isSecondHand && d.yearBuilt).sort((a, b) => a.dealDate.localeCompare(b.dealDate));
  const yearBuilt = modeOf(fresh.map((d) => d.yearBuilt));
  if (fresh.length < opts.minDeals) return { isProject: false, newDeals: fresh.length, firstSale: null, lastSale: null, yearBuilt };
  const first = fresh[0].dealDate;
  const limit = addMonths(first, opts.months);
  const inWindow = fresh.filter((d) => d.dealDate <= limit);
  const isProject = inWindow.length >= opts.minDeals;
  return {
    isProject, newDeals: fresh.length,
    firstSale: first, lastSale: fresh[fresh.length - 1].dealDate, yearBuilt,
  };
}

/** "2021-03-14" + 24 months → "2023-03-14" (string arithmetic, no Date drift). */
export function addMonths(iso: string, months: number): string {
  const m = iso.match(/^(\d{4})-(\d{2})(-\d{2})?/);
  if (!m) return iso;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + months;
  const y = Math.floor(total / 12), mo = (total % 12) + 1;
  return `${y}-${String(mo).padStart(2, "0")}${m[3] ?? "-01"}`;
}

/** The share of `x` against a reference, as a signed percentage, or null. */
export function pctVs(x: number | null, ref: number | null): number | null {
  if (x == null || ref == null || !(ref > 0) || !(x > 0)) return null;
  return (x / ref - 1) * 100;
}
