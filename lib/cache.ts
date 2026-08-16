import { unstable_cache } from "next/cache";

/**
 * Caching layer for the read-only research data.
 *
 * WHY THIS EXISTS
 * Every page in this app renders at request time (the root layout reads
 * cookies, which opts every route beneath it out of static generation). A
 * single /city/[slug] view issues ~25 Prisma calls, including a GROUP BY over
 * every transaction row in the city — ~84k rows for Tel Aviv — to produce
 * under 2KB of counts. That is fine for one analyst on a laptop and falls over
 * when the page is handed to an audience.
 *
 * The data behind those queries changes at most once a night, when the
 * pipeline runs. So the fix is not to make the queries faster, it is to stop
 * repeating them: cache the results and invalidate deliberately when the
 * pipeline swaps the database.
 *
 * WHY NOT JUST MAKE THE PAGES STATIC
 * That is the better end state, but it requires moving the cookie-reading nav
 * out of the root layout first — a change with real UX consequences (a flash
 * of logged-out chrome). Caching the loaders gets most of the win now and
 * stays correct either way, so it is the step that ships first.
 *
 * INVALIDATION
 * Everything here is tagged. `app/api/revalidate/route.ts` clears tags after a
 * successful pipeline run. Each entry also carries a time-based ceiling so a
 * missed webhook degrades into "up to N hours stale" rather than "stale until
 * someone restarts the server".
 */

/** Cache tags. Keep them coarse — over-invalidating is cheap, under-invalidating is a correctness bug. */
export const TAGS = {
  /** Anything derived from nadlan_transactions / nadlan_year_room_stats. */
  market: "market-data",
  /** Anything derived from the cities table, CBS series, permits, population. */
  reference: "reference-data",
} as const;

export type CacheTag = (typeof TAGS)[keyof typeof TAGS];

/** Time ceilings, in seconds. */
export const TTL = {
  /** Pipeline runs nightly; 6h bounds staleness without hammering the DB. */
  market: 6 * 60 * 60,
  /** Reference data moves monthly at most. */
  reference: 12 * 60 * 60,
} as const;

/**
 * Wrap an async loader in the shared cache.
 *
 * The returned function's ARGUMENTS participate in the cache key, so one
 * wrapper serves every city without a per-city registration.
 *
 * @param fn        the loader to memoize
 * @param keyParts  a stable, unique name for this loader — changing it orphans
 *                  the old entries rather than serving them under new logic
 * @param tag       which invalidation group this belongs to
 * @param ttl       seconds before the entry is considered stale regardless of tags
 */
export function cached<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  keyParts: string[],
  tag: CacheTag,
  ttl: number
): (...args: A) => Promise<R> {
  const wrapped = unstable_cache(fn, keyParts, { tags: [tag], revalidate: ttl });
  return async (...args: A) => {
    try {
      return await wrapped(...args);
    } catch (e) {
      // Outside the Next server runtime there is no incremental cache, and
      // unstable_cache throws this invariant the moment it is CALLED. That is
      // fine for a request — it cannot happen there — but it means any script
      // importing a cached loader dies on contact.
      //
      // The cost was not theoretical: scripts/diagnose-city-render.ts, written
      // to name the loader behind a production 500, reported all 168 cities
      // failing at getCityInsights with this invariant and never reached a
      // single real query. A diagnostic that cannot run is worse than none —
      // it produces a confident wrong answer.
      //
      // A script wants live data anyway, so falling through to the uncached
      // loader is not a degraded mode: it is the correct one.
      if (e instanceof Error && /incrementalCache missing/i.test(e.message)) return fn(...args);
      throw e;
    }
  };
}

/** Convenience wrappers for the two groups, so call sites stay short and consistent. */
export function cachedMarket<A extends unknown[], R>(fn: (...args: A) => Promise<R>, keyParts: string[]) {
  return cached(fn, keyParts, TAGS.market, TTL.market);
}

export function cachedReference<A extends unknown[], R>(fn: (...args: A) => Promise<R>, keyParts: string[]) {
  return cached(fn, keyParts, TAGS.reference, TTL.reference);
}

/**
 * Map/Set-safe caching.
 *
 * ⚠️ THE TRAP THIS EXISTS FOR: unstable_cache SERIALIZES what it stores. A
 * loader that returns a Map gets its value back as a plain object, and the
 * first `.get(...)` or `.forEach(...)` on it throws
 * "g.forEach is not a function" — at render time, in production, on a page
 * that worked in dev. Two loaders in this codebase (classification rates,
 * urban-renewal projects) were already shipped this way and only survived
 * because their callers sat inside try/catch.
 *
 * So: cache the ENTRIES (a plain array, which serializes cleanly) and rebuild
 * the Map or Set on the way out. The rebuild is O(n) over a few hundred rows —
 * nothing next to the query it replaces — and the call site keeps its Map API.
 */
export function cachedMap<A extends unknown[], K, V>(
  fn: (...args: A) => Promise<Map<K, V>>,
  keyParts: string[],
  tag: CacheTag = TAGS.market,
  ttl: number = TTL.market
): (...args: A) => Promise<Map<K, V>> {
  const entries = cached(async (...args: A) => Array.from(await fn(...args)), keyParts, tag, ttl);
  return async (...args: A) => new Map(await entries(...args));
}

export function cachedSet<A extends unknown[], V>(
  fn: (...args: A) => Promise<Set<V>>,
  keyParts: string[],
  tag: CacheTag = TAGS.market,
  ttl: number = TTL.market
): (...args: A) => Promise<Set<V>> {
  const members = cached(async (...args: A) => Array.from(await fn(...args)), keyParts, tag, ttl);
  return async (...args: A) => new Set(await members(...args));
}
