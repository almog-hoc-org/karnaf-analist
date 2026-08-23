/**
 * Where a page's section order is stored, and how it is read back.
 *
 * Storage is app.db, next to system_rules, and for the same reasons: it is
 * operator-editable state rather than market data, it is tiny, and it is
 * covered by the nightly app.db backup. The 5-second in-process cache mirrors
 * lib/systemRules too — a page render must not hit sqlite once per section.
 *
 * Reading always goes through reconcile() in lib/pageSections, so a stored
 * order can never hide a newly added section or resurrect a deleted one.
 */
import { appDb } from "./appDb";
import { type PageKey, defaultOrder, reconcile } from "./pageSections";

function ensureTable() {
  appDb().exec(`CREATE TABLE IF NOT EXISTS section_order (
    page TEXT PRIMARY KEY,
    keys TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

let cache: Map<string, string[]> | null = null;
let cacheAt = 0;
const TTL_MS = 5_000;

function rows(): Map<string, string[]> {
  const now = Date.now();
  if (cache && now - cacheAt < TTL_MS) return cache;
  try {
    ensureTable();
    const all = appDb().prepare("SELECT page, keys FROM section_order").all() as { page: string; keys: string }[];
    cache = new Map(
      all.map((r) => {
        let parsed: string[] = [];
        try {
          const j = JSON.parse(r.keys);
          if (Array.isArray(j)) parsed = j.filter((k): k is string => typeof k === "string");
        } catch {
          /* a corrupt row falls back to the catalogue order, never to a crash */
        }
        return [r.page, parsed];
      })
    );
  } catch {
    cache = new Map();
  }
  cacheAt = now;
  return cache;
}

export function invalidateSectionOrderCache() { cache = null; cacheAt = 0; }

/** The order this page should render in right now. Always complete. */
export function getSectionOrder(page: PageKey): string[] {
  const stored = rows().get(page);
  if (!stored || stored.length === 0) return defaultOrder(page);
  return reconcile(page, stored);
}

/** True when an operator has saved an order for this page. */
export function hasStoredOrder(page: PageKey): boolean {
  const stored = rows().get(page);
  return !!stored && stored.length > 0;
}

export function setSectionOrder(page: PageKey, keys: string[]) {
  ensureTable();
  const clean = reconcile(page, keys);
  appDb()
    .prepare(
      `INSERT INTO section_order (page, keys, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(page) DO UPDATE SET keys=excluded.keys, updated_at=CURRENT_TIMESTAMP`
    )
    .run(page, JSON.stringify(clean));
  invalidateSectionOrderCache();
}

/** Back to the catalogue order. */
export function resetSectionOrder(page: PageKey) {
  ensureTable();
  appDb().prepare("DELETE FROM section_order WHERE page=?").run(page);
  invalidateSectionOrderCache();
}
