/**
 * One nadlan.gov.il deal item → one nadlan_transactions row.
 *
 * Two writers store nadlan items: the nightly collector
 * (scripts/collect-nadlan-transactions.ts) and the address campaign's
 * insert step (scripts/backfill-nadlan-addresses.ts --insert-new). They must
 * agree on every derived column — deal_year, the room bucket, the
 * second-hand verdict, the address split — or the same deal would be
 * classified two ways depending on which path stored it. So the tuple is
 * built here, once, and both writers bind NADLAN_ROW_COLS.
 *
 * Pure: no database, no network; pinned in tests/pure.test.ts.
 */
import { extractAddress } from "./nadlanAddress";
import { floorText } from "./addressBackfill";

/** Deal year minus build year at or above this = second-hand (the collectors' shared rule). */
export const SECONDHAND_MIN_AGE = 4;

export function roomBucket(rn: number | null | undefined): string {
  if (rn == null || Number.isNaN(rn)) return "other";
  if (rn >= 2.5 && rn < 3.5) return "3";
  if (rn >= 3.5 && rn < 4.5) return "4";
  if (rn >= 4.5) return "5";
  return "other";
}

/** The columns every nadlan row insert binds, in tuple order. */
export const NADLAN_ROW_COLS = [
  "city_name", "cbs_code", "deal_date", "deal_year", "rooms", "room_bucket", "area", "price", "price_sqm",
  "year_built", "is_secondhand", "neighborhood", "street", "house_num", "floor",
  "parcel_num", "building_floors", "hok_hamecher", "prev_deals", "source_deal_id", "source",
] as const;

export type NadlanRowTuple = unknown[];

/**
 * The tuple for one raw item, or null when the item cannot be a row (no date,
 * no amount, or a date before 1991 — the collectors' own filters).
 */
export function buildNadlanRow(d: Record<string, unknown>, city: string, cbsCode: string | null): NadlanRowTuple | null {
  if (!d.dealDate || !d.dealAmount) return null;
  const dealDate = String(d.dealDate).slice(0, 10);
  const dy = Number(dealDate.slice(0, 4));
  if (!(dy > 1990)) return null;
  const yb = Number(d.yearBuilt) || null;
  const isSH = yb && yb > 0 && dy - yb >= SECONDHAND_MIN_AGE ? 1 : 0;
  const rooms = d.roomNum == null || d.roomNum === "" ? null : Number(d.roomNum);
  const addr = extractAddress(d, city);
  const parcel = typeof d.parcelNum === "string" && d.parcelNum.trim() ? d.parcelNum.trim() : null;
  const bf = Number(d.buildingFloors);
  const assetId = d.assetId != null && d.assetId !== "" ? String(d.assetId).replace(/\.0$/, "") : null;
  const floor = floorText(typeof d.floor === "string" ? d.floor.replace(/[‎‏]/g, "").trim() : (d.floor as number | null | undefined));
  return [
    city, cbsCode, dealDate, dy, rooms, roomBucket(rooms), d.assetArea ?? null, d.dealAmount ?? null, d.priceSM ?? null,
    yb, isSH, typeof d.neighborhoodName === "string" && d.neighborhoodName.trim() ? d.neighborhoodName.trim() : null,
    addr.street, addr.houseNum, floor,
    parcel, Number.isFinite(bf) && bf > 0 ? bf : null,
    d.hokHamecher == null ? null : Number(d.hokHamecher),
    Array.isArray(d.prevDeals) ? d.prevDeals.length : null,
    assetId, "nadlan",
  ];
}
