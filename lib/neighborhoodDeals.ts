import type { MappedNeighborhood } from "@/lib/cityMap";

/**
 * The query behind "click a neighbourhood, see its deals".
 *
 * WHY THIS IS A SEPARATE, PURE FUNCTION AND NOT TWO LINES IN THE COMPONENT
 * A mapped neighbourhood carries TWO names: `neighborhood`, which is what
 * OpenStreetMap calls the shape, and `summary.neighborhood`, which is what the
 * Tax Authority called it. The map pins the first — it is what the reader
 * clicked. The deals query must send the second, because that is the string
 * stored on every row of nadlan_transactions.
 *
 * The two are usually equal, which is exactly what makes the mistake so easy
 * and so quiet: sending the OSM name matches nothing, returns zero deals, and
 * looks for all the world like a neighbourhood with no sales. The choice is
 * pinned by a test rather than by a comment.
 *
 * A shape with no price row produces NO query at all. It has no Tax Authority
 * counterpart to ask about, so the only honest answer is "not enough deals",
 * and firing a request that is guaranteed to come back empty just spends the
 * caller's rate-limit budget.
 */

/** The graph's own vocabulary — see app/api/city-transactions/[cityName]. */
export type DealScope = "sh" | "new" | "all";

export const DEAL_SCOPES: Array<{ id: DealScope; label: string }> = [
  // Second-hand first, and the default: the "עסקאות" count in the table beside
  // the map is the second-hand count, so any other default would open a panel
  // whose total disagrees with the row the reader just clicked.
  { id: "sh", label: "יד שנייה" },
  { id: "new", label: "חדשות" },
  { id: "all", label: "הכל" },
];

/**
 * How many deals one page of the panel shows.
 *
 * Measured, not chosen: a deal row is ~36px (two lines — address, then rooms
 * and ₪/m²), the panel's own chrome is ~206px, and the map beside it is 614px
 * tall at every width the section renders at. Ten rows land the opened panel
 * inside that height, so the drill-down starts within the block it replaced
 * rather than pushing past it. "הצג עוד" grows it from there — the reader's
 * choice, not the default.
 */
export const NEIGHBORHOOD_DEALS_PAGE = 10;

export function neighborhoodDealsQuery(
  n: Pick<MappedNeighborhood, "neighborhood" | "summary">,
  scope: DealScope,
  opts: { offset?: number; limit?: number } = {}
): URLSearchParams | null {
  if (!n.summary) return null;
  const q = new URLSearchParams({
    neighborhood: n.summary.neighborhood, // Tax Authority spelling — NOT n.neighborhood
    dealType: scope,
    limit: String(opts.limit ?? NEIGHBORHOOD_DEALS_PAGE),
    offset: String(opts.offset ?? 0),
  });
  return q;
}
