/**
 * The two cleaning rules, for deals that DON'T live in our database.
 *
 * The neighbourhood/street tables (lib/govNadlanService) and the sub-area price
 * matrix (lib/subarea-deals-service) pull straight from the government API, so
 * the `excluded` / `luxury` columns the nightly flaggers write can't reach them.
 * Without this they would be the only prices on the site still averaging
 * duplicate reports and luxury sales — the same city page showing two different
 * answers.
 *
 * One implementation, used by both: same window, same tolerances, same
 * dashboard rules as scripts/flag-duplicate-deals.ts and
 * scripts/flag-luxury-deals.ts. When the rules change, everything moves together.
 *
 * Cohort here is narrower than the nightly job's — a live fetch covers ONE city,
 * so the ladder is year|rooms → year → all, without the city dimension.
 */
import { getRuleNum, getRuleBool } from "./systemRules";

/** The minimum a caller must expose for the rules to apply. */
export interface CleanableDeal {
  /** deal date — anything Date.parse understands */
  date: string;
  price: number;
  area: number;
  rooms: number | null;
  /** floor label/number when known — a different floor means a different flat */
  floor?: string | number | null;
  /** "street|houseNum" when known — a different address means a different building */
  address?: string | null;
}

export interface CleanResult<T> {
  kept: T[];
  /** identical reports of one sale, removed (they never happened twice) */
  dupeCount: number;
  /** real sales, removed from the PRICES only */
  luxuryCount: number;
}

const dayOf = (s: string) => Math.floor(Date.parse(String(s).slice(0, 10)) / 86_400_000);

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Apply both rules to a live-fetched list. Returns the deals that may set a
 * price, plus how many each rule removed (surface these — a number the user
 * can't account for is worse than no number).
 */
export function cleanDeals<T>(deals: T[], get: (d: T) => CleanableDeal): CleanResult<T> {
  const dupesOn = getRuleBool("duplicate_detection_on", true);
  const luxOn = getRuleBool("luxury_filter_on", true);
  if (!dupesOn && !luxOn) return { kept: deals, dupeCount: 0, luxuryCount: 0 };

  const requireSameUnit = getRuleBool("dupe_require_same_unit", true);
  const sameBuildingMax = Math.max(1, getRuleNum("dupe_same_building_max", 2));
  const windowDays = getRuleNum("dupe_window_days", 7);
  const priceTol = getRuleNum("dupe_price_tolerance", 0);
  const areaTol = getRuleNum("dupe_area_tolerance", 0);
  const minPrice = getRuleNum("luxury_min_price", 4_500_000);
  const premium = getRuleNum("luxury_sqm_premium_pct", 20) / 100;
  const minCohort = Math.max(2, getRuleNum("luxury_min_cohort", 10));

  const rows = deals.map((d, i) => ({ i, d, c: get(d) }))
    .filter((r) => r.c.price > 0 && r.c.area > 0 && Number.isFinite(dayOf(r.c.date)));
  const drop = new Set<number>();
  let dupeCount = 0;

  // ── rule 1: duplicate reports ──────────────────────────────────────────
  if (dupesOn) {
    const blocks = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = priceTol === 0 && areaTol === 0
        ? `${r.c.price}|${r.c.area}|${r.c.rooms ?? "?"}`
        : "all";
      const a = blocks.get(key);
      if (a) a.push(r); else blocks.set(key, [r]);
    }
    for (const list of blocks.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => dayOf(a.c.date) - dayOf(b.c.date));
      const n = list.length;
      const parent = Array.from({ length: n }, (_, k) => k);
      const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n && dayOf(list[j].c.date) - dayOf(list[i].c.date) <= windowDays; j++) {
          const a = list[i].c, b = list[j].c;
          if (Math.abs(b.price - a.price) > priceTol) continue;
          if (Math.abs(b.area - a.area) > areaTol) continue;
          if ((a.rooms ?? -1) !== (b.rooms ?? -1)) continue;
          const ra = find(i), rb = find(j);
          if (ra !== rb) parent[rb] = ra;
        }
      }
      const groups = new Map<number, typeof rows>();
      for (let i = 0; i < n; i++) {
        const root = find(i);
        const g = groups.get(root);
        if (g) g.push(list[i]); else groups.set(root, [list[i]]);
      }
      for (const g of groups.values()) {
        if (g.length < 2) continue;
        // how many of these are plausibly separate sales? (see flag-duplicate-deals.ts)
        let keepN = 1;
        if (requireSameUnit) {
          const addrs = g.map((r) => r.c.address).filter(Boolean);
          const floors = g.map((r) => r.c.floor).filter((f) => f != null);
          if (addrs.length >= 2 && new Set(addrs).size > 1) keepN = g.length;            // different buildings
          else if (floors.length >= 2 && new Set(floors.map(String)).size > 1) keepN = sameBuildingMax; // same building
        }
        if (g.length <= keepN) continue;
        g.sort((a, b) => dayOf(a.c.date) - dayOf(b.c.date));
        for (const r of g.slice(keepN)) { drop.add(r.i); dupeCount++; }
      }
    }
  }

  // ── rule 2: luxury deals (cohorts built on the de-duplicated set) ──────
  let luxuryCount = 0;
  if (luxOn) {
    const live = rows.filter((r) => !drop.has(r.i));
    const yearOf = (c: CleanableDeal) => new Date(c.date).getFullYear();
    const roomsOf = (c: CleanableDeal) => ((c.rooms ?? 0) > 0 ? String(Math.round(c.rooms!)) : "?");
    const bucket = (keyFn: (c: CleanableDeal) => string) => {
      const m = new Map<string, number[]>();
      for (const r of live) {
        const k = keyFn(r.c);
        const a = m.get(k);
        if (a) a.push(r.c.price / r.c.area); else m.set(k, [r.c.price / r.c.area]);
      }
      const o = new Map<string, number>();
      for (const [k, v] of m) if (v.length >= minCohort) o.set(k, median(v));
      return o;
    };
    const mFull = bucket((c) => `${yearOf(c)}|${roomsOf(c)}`);
    const mYear = bucket((c) => String(yearOf(c)));
    const mAll = bucket(() => "*");

    for (const r of live) {
      if (r.c.price <= minPrice) continue;
      const base = mFull.get(`${yearOf(r.c)}|${roomsOf(r.c)}`) ?? mYear.get(String(yearOf(r.c))) ?? mAll.get("*");
      if (!base || base <= 0) continue;
      if (r.c.price / r.c.area > base * (1 + premium)) { drop.add(r.i); luxuryCount++; }
    }
  }

  return { kept: deals.filter((_, i) => !drop.has(i)), dupeCount, luxuryCount };
}
