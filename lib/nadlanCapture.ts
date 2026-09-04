/**
 * The pure half of the nadlan.gov.il address campaign
 * (scripts/capture-nadlan-addresses.ts on the Mac,
 * scripts/backfill-nadlan-addresses.ts on the server): how a city's deal
 * window is sliced into queries, what is kept from each item, and what one
 * item donates to a database row. No network, no browser, no database —
 * pinned in tests/pure.test.ts.
 *
 * WHY THIS CAMPAIGN EXISTS (measured 4.9.2026). Every row that carries a
 * street also carries a house number; the gap is rows with NO street, and
 * all of them are nadlan-channel rows: 371k before 2016 (govmap has nothing
 * there) and 436k from 2016 on. A deal-data response captured from the
 * site's own page shows each item carries `address` ("יצחק צוקרמן 23"),
 * `parcelNum` (gush-helka-tat, "7242-126-6"), `floor`, `buildingFloors`,
 * `assetId`, `neighborhoodId`. lib/nadlanAddress.extractAddress already reads
 * `address`; the historical rows simply predate it.
 *
 * THE WINDOW. An anonymous session gets ≤500 items per fetch_number and two
 * fetches per query — ~1,000 deals per window. The window is shaped by the
 * filters the page itself offers: `room_num`, a `deal_date` horizon in
 * months back, `type_order` up/down (scripts/fill-city-years.ts learned
 * that an ascending sort anchored N months back makes that year the START
 * of its own window). Slicing by year × rooms × direction reaches deep into
 * the history one window at a time; a neighbourhood page, when it yields a
 * token of its own, multiplies that again.
 */
import { extractAddress } from "./nadlanAddress";
import { floorText, type AddressDonor } from "./addressBackfill";

export type RawItem = Record<string, unknown>;

/** The fields worth carrying from the Mac to the server — nothing else. */
export const CAPTURE_FIELDS = [
  "dealDate", "dealAmount", "assetArea", "roomNum",
  "address", "floor", "parcelNum", "buildingFloors",
  "assetId", "addressId", "streetCode", "neighborhoodName", "neighborhoodId", "polygonId",
  "yearBuilt", "hokHamecher", "priceSM", "dealNature",
] as const;

export type CapturedItem = Partial<Record<(typeof CAPTURE_FIELDS)[number], unknown>>;

export function pickCaptureFields(it: RawItem): CapturedItem {
  const out: CapturedItem = {};
  for (const k of CAPTURE_FIELDS) {
    const v = it[k];
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

/**
 * The collector's own dedup key (date | amount | area | rooms) — the same
 * four values that, with the city, identify a nadlan row in the database,
 * so a captured item and its row agree on identity without any id.
 */
export function itemKey(it: { dealDate?: unknown; dealAmount?: unknown; assetArea?: unknown; roomNum?: unknown }): string {
  return `${String(it.dealDate ?? "").slice(0, 10)}|${it.dealAmount ?? ""}|${it.assetArea ?? ""}|${it.roomNum ?? ""}`;
}

export interface SliceQuery {
  /** stable id, recorded in the capture file so a stopped run resumes */
  label: string;
  year: number;
  extra: Record<string, unknown>;
}

/** Months back from now that put `year` at the start of an ascending window. */
export function horizonMonths(year: number, nowYear: number): number {
  return Math.max(0, (nowYear - year) * 12 + 6);
}

/** Items per fetch_number the anonymous window returns at most. */
export const WINDOW_PAGE = 500;

/** Years worth querying, newest first — if the run stops on budget, the
 *  years users look at most are the ones already captured. */
export function orderYears(years: number[], nowYear: number): number[] {
  return [...new Set(years)].filter((y) => Number.isInteger(y) && y > 1990 && y <= nowYear).sort((a, b) => b - a);
}

/** The one query every year starts with: ascending, unfiltered, anchored just before the year. */
export function primarySlice(year: number, nowYear: number): SliceQuery {
  return { label: `${year}:up:all`, year, extra: { type_order: "dealDate_up", deal_date: String(horizonMonths(year, nowYear)) } };
}

/**
 * The seven extra windows for a year whose primary window SATURATED (both
 * fetches came back full, i.e. ≥1,000 deals from the anchor onwards): the
 * same anchor per room count, and a descending window anchored at the
 * year's end, unfiltered and per room count. Measured 4.9.2026: most
 * neighbourhood-years hold fewer than 500 deals, so running these blindly
 * cost ~8× the requests for nothing.
 */
export function expansionSlices(year: number, nowYear: number, rooms: string[] = ["3", "4", "5"]): SliceQuery[] {
  const up = String(horizonMonths(year, nowYear));
  const down = String(Math.max(0, (nowYear - year) * 12));
  const out: SliceQuery[] = [];
  for (const room of rooms) out.push({ label: `${year}:up:${room}`, year, extra: { type_order: "dealDate_up", deal_date: up, room_num: room } });
  out.push({ label: `${year}:down:all`, year, extra: { type_order: "dealDate_down", deal_date: down } });
  for (const room of rooms) out.push({ label: `${year}:down:${room}`, year, extra: { type_order: "dealDate_down", deal_date: down, room_num: room } });
  return out;
}

/** Did a window fill both fetches? Then the year needs the expansion slices. */
export function saturated(pageCounts: number[]): boolean {
  return pageCounts.length >= 2 && pageCounts.every((n) => n >= WINDOW_PAGE);
}

/** Every window a base could need — the primary and the expansion of every year. */
export function sliceQueries(years: number[], nowYear: number): SliceQuery[] {
  const out: SliceQuery[] = [];
  for (const y of orderYears(years, nowYear)) out.push(primarySlice(y, nowYear), ...expansionSlices(y, nowYear));
  return out;
}

/** Everything one nadlan item can give a row. */
export interface NadlanDonor extends AddressDonor {
  parcel_num: string | null;
  building_floors: number | null;
  asset_id: string | null;
}

export function donorFromItem(it: RawItem, city: string): NadlanDonor {
  const addr = extractAddress(it, city);
  const parcel = typeof it.parcelNum === "string" && it.parcelNum.trim() ? it.parcelNum.trim() : null;
  const bf = Number(it.buildingFloors);
  const assetId = it.assetId != null && it.assetId !== "" ? String(it.assetId).replace(/\.0$/, "") : null;
  return {
    street: addr.street,
    house_num: addr.houseNum,
    // "קומה ‎2‏" → keep the text, strip the bidi marks the site embeds
    floor: floorText(typeof it.floor === "string" ? it.floor.replace(/[‎‏]/g, "").trim() : (it.floor as number | null | undefined)),
    neighborhood: typeof it.neighborhoodName === "string" && it.neighborhoodName.trim() ? it.neighborhoodName.trim() : null,
    parcel_num: parcel,
    building_floors: Number.isFinite(bf) && bf > 0 ? bf : null,
    asset_id: assetId,
  };
}

/** The file one city's capture produces — resumable by `slicesDone`. */
export interface CaptureFile {
  city: string;
  cbsCode: string;
  capturedAt: string;
  /** measured on the first neighbourhood page: does it yield its own token? null = not tried */
  neighborhoodWindow: boolean | null;
  slicesDone: string[];
  items: CapturedItem[];
}

/** Merge newly captured items into a file, by identity; returns how many were new. */
export function mergeItems(file: CaptureFile, fresh: RawItem[]): number {
  const seen = new Set(file.items.map((i) => itemKey(i)));
  let added = 0;
  for (const it of fresh) {
    const k = itemKey(it);
    if (seen.has(k)) continue;
    seen.add(k);
    file.items.push(pickCaptureFields(it));
    added++;
  }
  return added;
}

/** Years present in a set of items — the run's own honest "how far back did we get". */
export function yearSpan(items: Array<{ dealDate?: unknown }>): { min: number; max: number } | null {
  let min = Infinity, max = -Infinity;
  for (const it of items) {
    const y = Number(String(it.dealDate ?? "").slice(0, 4));
    if (!Number.isFinite(y) || y < 1990) continue;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return min === Infinity ? null : { min, max };
}
