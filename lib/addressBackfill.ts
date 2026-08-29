/**
 * The pure matching/donation rules of the govmap address backfill — one place,
 * testable, and DELIBERATELY identical to scripts/merge-cross-channel.ts.
 *
 * WHY IDENTICAL MATTERS. The nightly merge and the backfill answer the same
 * question — "is this govmap record the same reported deal as that row?" —
 * and two different answers would mean a deal one job matches and the other
 * duplicates or skips. The keys and the never-guess rules below are the
 * merge's, verbatim; the tests pin the parity.
 *
 * THE NEVER-GUESS RULE, in one sentence: candidate donors that disagree on
 * the street donate nothing at all, and donors that agree on the street but
 * disagree on the neighbourhood donate the street only — a wrong confident
 * address is worse than a missing one.
 */

/** The address columns a donor can give. floor may arrive numeric from the feed. */
export interface AddressDonor {
  street: string | null;
  house_num: string | null;
  floor: number | string | null;
  neighborhood: string | null;
}

/** What a chooseDonation call decided to give (floor already stringified). */
export interface Donation {
  street: string | null;
  house_num: string | null;
  floor: string | null;
  neighborhood: string | null;
}

/**
 * floor is a TEXT column (the feed returns Hebrew floor names as often as
 * digits). Donating a raw integer copies the defect onto a clean row, and
 * Prisma refuses to read a row whose text column holds a number — which is a
 * 500 on the whole city page, not a missing floor cell.
 */
export function floorText(v: number | string | null | undefined): string | null {
  return v == null ? null : String(v);
}

/** merge-cross-channel's strict cross-channel key (city is fixed by the caller's loop). */
export function strictKey(r: { deal_date: string; price: number; area: number; rooms: number | null }): string {
  return `${r.deal_date}|${Math.round(r.price)}|${Math.round(r.area)}|${Math.round(r.rooms ?? 0)}`;
}

/** merge-cross-channel's soft key — date + exact price; area checked separately with ±2 m². */
export function looseKey(r: { deal_date: string; price: number }): string {
  return `${r.deal_date}|${Math.round(r.price)}`;
}

/** The soft pass's area tolerance, shared so the test can pin it. */
export const SOFT_AREA_TOLERANCE_SQM = 2;

/**
 * Decide what a group of candidate donors gives — or null when they conflict
 * on the street (the ambiguous case: donate nothing, count it, move on).
 */
export function chooseDonation(cands: AddressDonor[]): Donation | null {
  if (cands.length === 0) return null;
  const streets = new Set(cands.map((d) => d.street).filter(Boolean));
  if (streets.size > 1) return null; // conflicting addresses → don't guess
  // The never-guess rule applies to the neighbourhood too: donors that agree
  // on the street but disagree on the hood donate no hood.
  const hoods = new Set(cands.map((d) => d.neighborhood).filter(Boolean));
  const donor = cands.find((d) => d.street) ?? cands[0];
  return {
    street: donor.street ?? null,
    house_num: donor.house_num ?? null,
    floor: floorText(donor.floor),
    neighborhood: hoods.size === 1 ? [...hoods][0]! : null,
  };
}

/**
 * Gap-first city ordering: the cities with the most address-less rows get the
 * campaign's first nights, so Tel-Aviv-class wins land before the long tail.
 */
export function orderCitiesByGap<T extends { missing: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.missing - a.missing);
}
