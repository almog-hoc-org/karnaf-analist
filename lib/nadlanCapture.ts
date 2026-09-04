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

/**
 * The query plan for one base (a city, or one neighbourhood): for every year,
 * an ascending window anchored just before it and a descending window
 * anchored at its end, each once unfiltered and once per room count.
 * Newest years first — if the run stops on budget, the years users look at
 * most are the ones already captured.
 */
export function sliceQueries(years: number[], nowYear: number, rooms: string[] = ["", "3", "4", "5"]): SliceQuery[] {
  const out: SliceQuery[] = [];
  const ordered = [...new Set(years)].filter((y) => Number.isInteger(y) && y > 1990 && y <= nowYear).sort((a, b) => b - a);
  for (const y of ordered) {
    for (const room of rooms) {
      const roomExtra = room ? { room_num: room } : {};
      out.push({ label: `${y}:up:${room || "all"}`, year: y, extra: { type_order: "dealDate_up", deal_date: String(horizonMonths(y, nowYear)), ...roomExtra } });
      out.push({ label: `${y}:down:${room || "all"}`, year: y, extra: { type_order: "dealDate_down", deal_date: String(Math.max(0, (nowYear - y) * 12)), ...roomExtra } });
    }
  }
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
