/**
 * The admin deals browser's filter → WHERE. In lib/, not in the route file:
 * a route module may export only its handlers (Next's build gate refused
 * `buildWhere` as a route export), and the guard below is pinned in tests.
 */
export interface Filters {
  city?: string; street?: string; neighborhood?: string;
  yearFrom?: number; yearTo?: number;
  priceMin?: number; priceMax?: number; sqmMin?: number; sqmMax?: number;
  rooms?: string; source?: string;
  cls?: "secondhand" | "new" | "unclassified" | "";
  excluded?: "yes" | "no" | "";
  reason?: string; // filter by exclusion_reason (e.g. 'חריג-שוק' for non-market deals)
  luxury?: "yes" | "no" | ""; // luxury deals are ACTIVE — they leave the prices, not the counts
}

/**
 * buildWhere() seeds its condition list with "1=1", so a filter object with
 * nothing set produces `WHERE 1=1` — which the bulk UPDATE below would happily
 * apply to every row, emptying the site in one request. A mutation must prove
 * it is targeted, and the proof is `conds`: the number of conditions the WHERE
 * really carries. An earlier guard counted the filter FIELDS instead, and
 * `{yearFrom: 0}` or `{cls: "x"}` counted as a filter while adding no
 * condition — `WHERE 1=1` with a passing guard.
 */
export function buildWhere(f: Filters): { where: string; params: unknown[]; conds: number } {
  const conds: string[] = ["1=1"];
  const params: unknown[] = [];
  if (f.city) { conds.push("city_name = ?"); params.push(f.city); }
  if (f.street) { conds.push("street LIKE ?"); params.push(`%${f.street}%`); }
  if (f.neighborhood) { conds.push("neighborhood LIKE ?"); params.push(`%${f.neighborhood}%`); }
  if (f.yearFrom) { conds.push("deal_year >= ?"); params.push(f.yearFrom); }
  if (f.yearTo) { conds.push("deal_year <= ?"); params.push(f.yearTo); }
  if (f.priceMin) { conds.push("price >= ?"); params.push(f.priceMin); }
  if (f.priceMax) { conds.push("price <= ?"); params.push(f.priceMax); }
  if (f.sqmMin) { conds.push("price_sqm >= ?"); params.push(f.sqmMin); }
  if (f.sqmMax) { conds.push("price_sqm <= ?"); params.push(f.sqmMax); }
  if (f.rooms) { conds.push("room_bucket = ?"); params.push(f.rooms); }
  if (f.source) { conds.push("source = ?"); params.push(f.source); }
  if (f.cls === "secondhand") conds.push("is_secondhand = 1");
  else if (f.cls === "new") conds.push("year_built IS NOT NULL AND is_secondhand = 0");
  else if (f.cls === "unclassified") conds.push("year_built IS NULL");
  if (f.excluded === "yes") conds.push("COALESCE(excluded,0) = 1");
  else if (f.excluded === "no") conds.push("COALESCE(excluded,0) = 0");
  if (f.reason) { conds.push("exclusion_reason LIKE ?"); params.push(`%${f.reason}%`); }
  if (f.luxury === "yes") conds.push("COALESCE(luxury,0) = 1");
  else if (f.luxury === "no") conds.push("COALESCE(luxury,0) = 0");
  return { where: conds.join(" AND "), params, conds: conds.length - 1 };
}
