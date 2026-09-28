/**
 * The tax authority's deal register (מיסוי מקרקעין), as published by
 * over.org.il — parsing and matching. PURE: no database, no network.
 *
 * WHAT THE REGISTER IS (read from github.com/zomer-g/ckan-version-tracker,
 * 28.9.2026): 3.84M rows scraped from nadlan.taxes.gov.il since 1998, one gush
 * at a time. Columns: gush, chelka, sub_chelka, deal_date (DD/MM/YYYY),
 * deal_amount (the sale value — the figure nadlan.gov.il shows), declared_amount
 * (the declared consideration, which nadlan.gov.il never shows), deal_nature,
 * portion (share of the asset sold, 0.000–1.000), asset_area (of the WHOLE
 * asset), room_num, year_built, settlement (+ settlement_code, empty on 17.5%).
 * NO address and NO floor.
 *
 * WHAT IT GIVES US: a gush-helka-sub for every deal since 1998. Our rows since
 * 9/2021 already tie a parcel to a street and house number (the nadlan capture
 * stores parcel_num), so an older deal that learns its parcel from the register
 * can inherit the address of newer deals in the same parcel. That is the only
 * route to an address for the ~370k deals before 2021.
 *
 * WHY MATCHING IS CONSERVATIVE: a wrong parcel moves a deal to another
 * building, which is worse than no parcel. A match is accepted only when it is
 * the ONLY candidate on both sides; anything else is counted as ambiguous.
 * Their own hand check (10 random parcels): 140 of 145 sales matched nadlan.gov.il
 * on date and amount, 120 to the shekel and 20 rounded to the thousand, so the
 * two keys below are exact and rounded.
 */
import crypto from "node:crypto";
import { normalizeCity, canonicalCityName } from "./cityAliases";
import { townSkeleton } from "./geocode";
import { shiftDate, NADLAN_DATE_SHIFT_DAYS } from "./addressBackfill";

export const MEKARKEIN_DATASET_ID = "fd06f5ae-8a4f-4120-b275-8a514ad23499";
export const MEKARKEIN_CSV_URL =
  `https://www.over.org.il/api/append/${MEKARKEIN_DATASET_ID}/download.csv`;
/** The attribution the publisher uses; shown wherever these rows are used. */
export const MEKARKEIN_ATTRIBUTION = "עסקאות נדל\"ן — רשות המסים (מיסוי מקרקעין), דרך גרסאות לעם (over.org.il)";

export interface MekarkeinRow {
  /** content hash — the register has no key, and identical rows are one sale */
  id: string;
  settlement: string;
  settlementCode: string | null;
  gush: number;
  helka: number;
  sub: number;
  /** ISO YYYY-MM-DD */
  dealDate: string;
  amount: number;
  declaredAmount: number | null;
  nature: string | null;
  portion: number | null;
  area: number | null;
  rooms: number | null;
  yearBuilt: number | null;
  firstSeen: string | null;
}

const int = (v: string | undefined): number | null => {
  const s = (v ?? "").trim();
  if (!/^-?\d+$/.test(s)) return null;
  return Number(s);
};
const num = (v: string | undefined): number | null => {
  const s = (v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** DD/MM/YYYY → YYYY-MM-DD; anything else → null (never guessed). */
export function registerDate(v: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v ?? "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * One CSV record (header → value) → a typed row, or null when it cannot be a
 * usable deal (no parcel, no date, no amount).
 */
export function parseRegisterRecord(r: Record<string, string>): MekarkeinRow | null {
  const gush = int(r.gush), helka = int(r.chelka);
  const dealDate = registerDate(r.deal_date);
  const amount = int(r.deal_amount);
  if (gush == null || helka == null || !dealDate || amount == null || amount <= 0) return null;
  const row: Omit<MekarkeinRow, "id"> = {
    settlement: (r.settlement ?? "").trim(),
    settlementCode: (r.settlement_code ?? "").trim() || null,
    gush, helka, sub: int(r.sub_chelka) ?? 0,
    dealDate, amount,
    declaredAmount: int(r.declared_amount),
    nature: (r.deal_nature ?? "").trim() || null,
    portion: num(r.portion),
    area: num(r.asset_area),
    rooms: num(r.room_num),
    yearBuilt: int(r.year_built),
    firstSeen: (r.first_seen ?? "").trim().slice(0, 19) || null,
  };
  // first_seen / scraped_at are bookkeeping, not content: the same sale seen
  // on two scrapes must hash the same.
  const id = crypto.createHash("sha1").update([
    row.settlement, row.gush, row.helka, row.sub, row.dealDate, row.amount,
    row.declaredAmount ?? "", row.nature ?? "", row.portion ?? "", row.area ?? "", row.rooms ?? "", row.yearBuilt ?? "",
  ].join("|")).digest("hex");
  return { id, ...row };
}

/** "7242-126-6", the form our parcel_num column uses. */
export function parcelNum(gush: number, helka: number, sub: number): string {
  return `${gush}-${helka}-${sub}`;
}

/** Gush-helka of a stored parcel_num ("7242-126-6" or "7242-126") → "7242-126", or null. */
export function gushHelkaOf(parcel: string | null | undefined): string | null {
  const m = /^\s*0*(\d+)-0*(\d+)(?:-0*(\d+))?\s*$/.exec(parcel ?? "");
  return m ? `${Number(m[1])}-${Number(m[2])}` : null;
}

/**
 * Settlement names in the register → our city names. Keyed by the consonant
 * skeleton of the normalised name, the same comparison the geocoder uses
 * (lib/geocode.ts townSkeleton), so "קרית"/"קריית", hyphens and quotes agree.
 */
export function cityResolver(ourCities: string[]): (settlement: string) => string | null {
  const key = (s: string) => townSkeleton(normalizeCity(canonicalCityName(s)));
  const map = new Map<string, string | null>();
  for (const c of ourCities) {
    const k = key(c);
    map.set(k, map.has(k) && map.get(k) !== c ? null : c); // two of ours on one key → refuse
  }
  return (settlement) => (settlement ? map.get(key(settlement)) ?? null : null);
}

/** Our side of the match. */
export interface OurDeal {
  id: number;
  dealDate: string; // ISO
  price: number;
  area: number | null;
  rooms: number | null;
  parcelNum: string | null;
}

export type MatchLevel = "exact" | "rounded" | "shifted";

export interface MatchResult {
  matches: Array<{ ourId: number; regId: string; parcel: string; level: MatchLevel }>;
  /** our rows with more than one candidate, or whose candidate is claimed twice */
  ambiguous: number;
  /** matched, but the register's gush-helka disagrees with the parcel we already hold */
  conflicts: number;
  /** matched and agreeing with an existing parcel_num — the accuracy control */
  confirmed: number;
  unmatched: number;
}

const roundK = (n: number) => Math.round(n / 1000);

/**
 * Match one city's deals to the register rows of the same city.
 *
 * Only whole-asset sales (portion 1) are candidates: a partial row's amount
 * pays for a share, so it never equals the price of the flat. Keys, in order:
 *   exact   — same date, same amount to the shekel;
 *   rounded — same date, amount equal to the thousand (nadlan.gov.il rounds);
 *   shifted — exact amount, our date one day LATER than the register's. Older
 *             nadlan rows carry a systematic +1 day (lib/addressBackfill.ts,
 *             NADLAN_DATE_SHIFT_DAYS, measured 6.9.2026).
 * When a key has several candidates, area within 2 m² and then rooms narrow
 * them; a match is taken only when exactly one survives. A register row that
 * two of our rows would take is given to neither.
 */
export function matchCity(ours: OurDeal[], register: MekarkeinRow[], areaTolerance = 2): MatchResult {
  const whole = register.filter((r) => r.portion == null || Math.abs(r.portion - 1) < 0.0005);
  const byExact = new Map<string, MekarkeinRow[]>();
  const byRounded = new Map<string, MekarkeinRow[]>();
  const push = (m: Map<string, MekarkeinRow[]>, k: string, r: MekarkeinRow) => { const a = m.get(k); if (a) a.push(r); else m.set(k, [r]); };
  for (const r of whole) {
    push(byExact, `${r.dealDate}|${r.amount}`, r);
    push(byRounded, `${r.dealDate}|${roundK(r.amount)}`, r);
  }

  const narrow = (cands: MekarkeinRow[], d: OurDeal): MekarkeinRow[] => {
    if (cands.length <= 1) return cands;
    let c = cands;
    if (d.area != null) {
      const a = c.filter((r) => r.area != null && Math.abs(r.area - d.area!) <= areaTolerance);
      if (a.length) c = a;
    }
    if (c.length > 1 && d.rooms != null) {
      const b = c.filter((r) => r.rooms != null && Math.abs(r.rooms - d.rooms!) < 0.01);
      if (b.length) c = b;
    }
    return c;
  };

  const proposals: Array<{ d: OurDeal; r: MekarkeinRow; level: MatchLevel }> = [];
  let ambiguous = 0, unmatched = 0;
  for (const d of ours) {
    if (!(d.price > 0)) { unmatched++; continue; }
    let level: MatchLevel = "exact";
    let cands = narrow(byExact.get(`${d.dealDate}|${d.price}`) ?? [], d);
    if (!cands.length) { level = "rounded"; cands = narrow(byRounded.get(`${d.dealDate}|${roundK(d.price)}`) ?? [], d); }
    if (!cands.length) {
      level = "shifted";
      cands = narrow(byExact.get(`${shiftDate(d.dealDate, -NADLAN_DATE_SHIFT_DAYS)}|${d.price}`) ?? [], d);
    }
    if (!cands.length) { unmatched++; continue; }
    if (cands.length > 1) { ambiguous++; continue; }
    proposals.push({ d, r: cands[0], level });
  }

  const claims = new Map<string, number>();
  for (const p of proposals) claims.set(p.r.id, (claims.get(p.r.id) ?? 0) + 1);

  const out: MatchResult = { matches: [], ambiguous, conflicts: 0, confirmed: 0, unmatched };
  for (const p of proposals) {
    if ((claims.get(p.r.id) ?? 0) > 1) { out.ambiguous++; continue; }
    const parcel = parcelNum(p.r.gush, p.r.helka, p.r.sub);
    const held = gushHelkaOf(p.d.parcelNum);
    if (held) {
      if (held === `${p.r.gush}-${p.r.helka}`) out.confirmed++;
      else { out.conflicts++; continue; }
    }
    out.matches.push({ ourId: p.d.id, regId: p.r.id, parcel, level: p.level });
  }
  return out;
}

/** A row that can give or take an address. */
export interface ParcelAddressRow {
  id: number;
  parcelNum: string | null;
  street: string | null;
  houseNum: string | null;
}

/**
 * Addresses for rows that have a parcel but no street, from rows of the SAME
 * city that have both. The same sub-parcel is the same flat, so it is tried
 * first; then the gush-helka, which is one building in most cities. Taken only
 * when every donor at that level agrees on street and house; otherwise the row
 * is ambiguous and left alone (a large parcel can hold several buildings).
 */
export function inheritAddresses(rows: ParcelAddressRow[]): {
  fills: Array<{ id: number; street: string; houseNum: string; via: "sub" | "parcel" }>;
  ambiguous: number;
  noDonor: number;
} {
  const norm = (p: string) => p.trim().split("-").map((x) => String(Number(x))).join("-");
  const bySub = new Map<string, Set<string>>();
  const byGh = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, v: string) => { const s = m.get(k); if (s) s.add(v); else m.set(k, new Set([v])); };
  for (const r of rows) {
    if (!r.parcelNum || !r.street?.trim() || !r.houseNum?.trim()) continue;
    const v = `${r.street.trim()}\u0000${r.houseNum.trim()}`;
    const p = norm(r.parcelNum);
    if (p.split("-").length === 3) add(bySub, p, v);
    const gh = gushHelkaOf(p);
    if (gh) add(byGh, gh, v);
  }
  const fills: Array<{ id: number; street: string; houseNum: string; via: "sub" | "parcel" }> = [];
  let ambiguous = 0, noDonor = 0;
  for (const r of rows) {
    if (!r.parcelNum || r.street?.trim()) continue;
    const p = norm(r.parcelNum);
    const sub = bySub.get(p);
    const gh = byGh.get(gushHelkaOf(p) ?? "");
    const pick = sub?.size === 1 ? { s: sub, via: "sub" as const } : gh?.size === 1 ? { s: gh, via: "parcel" as const } : null;
    if (!pick) { if (sub || gh) ambiguous++; else noDonor++; continue; }
    const [street, houseNum] = [...pick.s][0].split("\u0000");
    fills.push({ id: r.id, street, houseNum, via: pick.via });
  }
  return { fills, ambiguous, noDonor };
}
