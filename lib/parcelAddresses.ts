/**
 * Addresses by parcel, from the two public tables over.org.il republishes.
 *
 * WHY. A tax-register deal (source 'mekarkein') arrives with gush-helka-sub
 * and nothing else. Its street came from our own deals on the same parcel or
 * from a per-parcel HTTP lookup rationed to 2,000 a night, largest city first
 * — so a small town's register deals waited weeks, and a new project's
 * parcel, unknown to the lookup, was cached as "no address" for good. Its
 * neighbourhood came from nowhere at all: 0% of register rows had one.
 *
 * Two files replace both:
 *  - the govmap deals mirror (dataset 4174aac2…, monthly, 2.5M deals): every
 *    deal with gush-helka-sub, street, house, floor and the Tax Authority's
 *    neighbourhood — the same names our own deals carry;
 *  - the parcel→address table (dataset 88670e58…, several times a day): every
 *    address in the country tied to its gush-helka, the only source for a
 *    parcel no deal has been reported on yet (a new project).
 *
 * Pure: no database, no network; pinned in tests/pure.test.ts. The importers
 * are scripts/import-govmap-mirror.ts and scripts/import-over-addresses.ts.
 */
import { normStreet } from "./addressKey";
import type { OverParcel } from "./mekarkeinPromote";

export const GOVMAP_MIRROR_DATASET = "4174aac2-c8b2-443e-9425-3773ce47c8da";
export const OVER_ADDRESSES_DATASET = "88670e58-8320-41cf-8f30-b5856ee97f1b";
export const OVER_API = "https://www.over.org.il/api/v1";
export const PARCEL_ADDRESSES_ATTRIBUTION = "כתובות לפי גוש-חלקה ומראה שכבת העסקאות של govmap — נדל״ן לעם (over.org.il)";

/** "12693-0-18" → gush 12693, suffix 0, helka 18 (the table's parcel_key). */
export function parseParcelKey(key: string | null | undefined): { gush: number; suffix: number; helka: number } | null {
  const m = (key ?? "").trim().match(/^(\d+)-(\d+)-(\d+)$/);
  if (!m) return null;
  const [gush, suffix, helka] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return gush > 0 && helka > 0 ? { gush, suffix, helka } : null;
}

/** "שכונת קריית שמואל" → "קריית שמואל": the table prefixes what the Tax Authority does not. */
export function cleanHood(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/^\s*(שכונת|שכ['׳]|ש['׳])\s+/, "").replace(/\s+/g, " ").trim();
  return s || null;
}

export interface OverAddressRow { suffix: number; street: string; house: string; hood: string | null }

/**
 * The parcel→address table's rows for one gush-helka, as the OverParcel the
 * promoter already understands. More than one gush suffix answering to the
 * same gush-helka is the API's gp_ambiguous: the register row carries no
 * suffix, so it cannot say which.
 */
export function overParcelFromRows(rows: OverAddressRow[]): OverParcel & { hood: string | null } {
  if (!rows.length) return { ambiguous: false, addresses: [], hood: null };
  const suffixes = new Set(rows.map((r) => r.suffix));
  if (suffixes.size > 1) return { ambiguous: true, addresses: [], hood: null };
  const seen = new Set<string>();
  const addresses: Array<{ street: string; house: string }> = [];
  const hoods = new Set<string>();
  for (const r of rows) {
    if (!r.street || !r.house) continue;
    const k = `${normStreet(r.street)}|${r.house}`;
    if (!seen.has(k)) { seen.add(k); addresses.push({ street: r.street, house: r.house }); }
    if (r.hood) hoods.add(r.hood);
  }
  return { ambiguous: false, addresses, hood: hoods.size === 1 ? [...hoods][0] : null };
}

/** The newest version's first downloadable file whose name ends with `suffix`, from a versions listing. */
export function latestResource(
  versions: Array<{ version_number?: number; resources?: Array<{ name?: string; download_url?: string }> }>,
  suffix: string,
): { version: number; url: string } | null {
  const sorted = [...versions].sort((a, b) => (b.version_number ?? 0) - (a.version_number ?? 0));
  for (const v of sorted) {
    for (const r of v.resources ?? []) {
      if (r.download_url && r.download_url.endsWith(suffix)) return { version: v.version_number ?? 0, url: r.download_url };
    }
  }
  return null;
}
