import { getRuleNum } from "./systemRules";

/**
 * Room-count classification BY AREA (user rule): the reported room count is often
 * wrong (a "4-room" recorded at 60 m² is an anomaly). The AREA is the reliable
 * field, so we re-derive the effective room count from the area using per-room
 * area ranges — all editable in the admin ("סיווג חדרים לפי שטח").
 *
 * Ranges (defaults): 2→35-72 · 3→55-85 · 4→75-130 · 5→95-145 · 6→115-175 m².
 * Below the 2-room minimum → 1 (studio); above the 6-room maximum → 7 (7+).
 *
 * Verified against the user's examples:
 *   2 rms / 75 m² → 3 · 3/88 → 4 · 4/68 → 3 · 4/128 → 4 · 4/135 → 5 · 5/88 → 4.
 */
export type RoomRanges = Record<number, [number, number]>; // room -> [min, max]

export function getRoomRanges(): RoomRanges {
  return {
    2: [getRuleNum("room2_area_min", 35), getRuleNum("room2_area_max", 72)],
    3: [getRuleNum("room3_area_min", 55), getRuleNum("room3_area_max", 85)],
    4: [getRuleNum("room4_area_min", 75), getRuleNum("room4_area_max", 130)],
    5: [getRuleNum("room5_area_min", 95), getRuleNum("room5_area_max", 145)],
    6: [getRuleNum("room6_area_min", 115), getRuleNum("room6_area_max", 175)],
  };
}

/** Pure classifier — pass ranges once (getRoomRanges()) when calling per-row in bulk. */
export function effectiveRoomsWithRanges(
  reportedRooms: number | null | undefined,
  area: number | null | undefined,
  ranges: RoomRanges,
): number | null {
  const reported = reportedRooms != null && reportedRooms > 0 ? Math.round(reportedRooms) : null;
  if (area == null || area <= 0) return reported; // no area → can't re-derive, keep reported

  const inRange = (r: number) => r >= 2 && r <= 6 && area >= ranges[r][0] && area <= ranges[r][1];

  if (area < ranges[2][0]) return 1;   // below 2-room minimum → studio
  if (area > ranges[6][1]) return 7;   // above 6-room maximum → 7+

  // reported count fits its own area range → trust it
  if (reported != null && inRange(reported)) return reported;

  // otherwise step from the reported count toward the area until a range contains it
  if (reported != null && reported >= 2 && reported <= 6) {
    const dir = area < ranges[reported][0] ? -1 : 1;
    for (let r = reported; r >= 2 && r <= 6; r += dir) if (inRange(r)) return r;
  }
  // reported missing / unresolved → lowest bucket whose range contains the area (35-175 is contiguous)
  for (let r = 2; r <= 6; r++) if (inRange(r)) return r;
  return reported;
}

/** Convenience for one-off use (reads the rules each call). */
export function effectiveRooms(reportedRooms: number | null | undefined, area: number | null | undefined): number | null {
  return effectiveRoomsWithRanges(reportedRooms, area, getRoomRanges());
}

/**
 * Building age class for a second-hand deal (user rule): a 4-room in a 10-year-old
 * building is worth tens of % more than a 4-room in a 50-year-old one, so they must
 * not share a cohort. modern = built ≥ modern_min_year (default 2005); old = before;
 * unknown = no build-year. Used to split price series AND the anomaly cohort so a
 * legitimately-premium modern deal isn't flagged against an old-dominated median.
 */
export type BuildingAge = "modern" | "old" | "unknown";
export function buildingAgeOf(yearBuilt: number | null | undefined, modernMinYear: number): BuildingAge {
  if (yearBuilt == null || yearBuilt <= 0) return "unknown";
  return yearBuilt >= modernMinYear ? "modern" : "old";
}
export function buildingAge(yearBuilt: number | null | undefined): BuildingAge {
  return buildingAgeOf(yearBuilt, getRuleNum("modern_min_year", 2005));
}

/** Map an (effective) room count to the aggregation bucket used across the site. */
export function roomBucketOf(effRooms: number | null): string {
  if (effRooms == null || effRooms <= 0) return "other";
  const r = Math.round(effRooms);
  if (r <= 1) return "1";
  if (r >= 6) return "6";
  return String(r); // "2".."5"
}
