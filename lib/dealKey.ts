/**
 * ONE definition of when two rows are the same reported deal.
 *
 * WHY THIS FILE EXISTS
 * Every collector used to wipe a city before writing it:
 *
 *   DELETE FROM nadlan_transactions WHERE city_name=? AND source=?
 *
 * — while the comment above needsCollection in collect-transactions.ts claimed
 * the opposite, that repeated runs "only ADD the newly-reachable deals; never
 * duplicates or loses existing ones". There was no union anywhere in the code.
 *
 * That contradiction is not academic. An anonymous nadlan session is capped at
 * roughly 2,400 deals per city per sweep, so a single pass CANNOT return ten
 * years of build-year data for a large city — only repeated passes accumulating
 * can. The campaign in needsCollection retries a city up to six times to reach
 * ten-year second-hand coverage, and every retry was throwing away what the
 * previous one had found. A run returning 2022–2026 followed by one returning
 * 2021–2025 ends up holding 2021–2025, not the union. That is why 95,485 deals
 * still carry no classification and twenty cities produce no statistics at all.
 *
 * Accumulating instead of replacing needs an identity test, and it has to be
 * the SAME one everywhere — the collectors and scripts/import-transactions.ts
 * both decide "have I seen this deal before", and two different answers would
 * mean rows that one path skips and the other duplicates.
 *
 * WHAT IS AND IS NOT PART OF IDENTITY
 * City, date, address, area, price and rooms. Two rows agreeing on all of those
 * are one reported deal, and re-collecting a period simply finds them again.
 *
 * Deliberately NOT the looser rule in scripts/flag-duplicate-deals.ts (same
 * price and area within a 7-day window). That rule catches the authority
 * reporting one sale twice on different dates, and it runs later in the
 * pipeline where it belongs. Applied here it would silently discard genuinely
 * distinct sales — two identical flats in one building sold the same week is an
 * ordinary event, not a double report.
 *
 * `rooms` is included because the nadlan collector already treats it as part of
 * identity in its own in-memory dedupe (date|amount|area|rooms). Matching that
 * keeps one notion of sameness rather than two.
 *
 * THE TRADE-OFF, STATED PLAINLY
 * A union never REMOVES a row. If the authority corrects or withdraws a deal,
 * our copy keeps it. That is the price of accumulation and it is the right side
 * to err on here: flag-duplicate-deals catches double reports downstream, and
 * losing a year of history is worse than holding a stale row.
 */

/** Columns that together identify a deal. Order is not significant. */
export const DEAL_KEY_COLS = [
  "city_name",
  "deal_date",
  "street",
  "house_num",
  "area",
  "price",
  "rooms",
] as const;

/**
 * A NULL-safe equality predicate between two aliased tables.
 *
 * COALESCE on every column matters more than it looks: street and house_num are
 * NULL on every nadlan row (that source carries no address) and populated on
 * govmap rows. In SQL, NULL = NULL is NULL, not true — so without this, no
 * nadlan row would ever match another nadlan row and the whole union would
 * degrade to an append, quietly duplicating everything on the second run.
 *
 * Text and numeric columns get different sentinels so that an empty string
 * cannot collide with a zero.
 */
export function dealKeyMatch(a: string, b: string, cols: readonly string[] = DEAL_KEY_COLS): string {
  const NUMERIC = new Set(["area", "price", "rooms"]);
  return cols
    .map((c) => {
      const empty = NUMERIC.has(c) ? "-1" : "''";
      return `COALESCE(${a}."${c}", ${empty}) = COALESCE(${b}."${c}", ${empty})`;
    })
    .join(" AND ");
}

/**
 * Index backing the identity lookup.
 *
 * IT MUST INDEX THE SAME EXPRESSIONS THE MATCH USES. The first version indexed
 * the plain columns (city_name, deal_date, price, area) while dealKeyMatch
 * compares COALESCE(col, sentinel). SQLite cannot use a plain-column index for
 * a COALESCE(col) comparison, so the NOT EXISTS subquery fell back to a full
 * scan of the whole table for EVERY incoming row: on a 1.4M-row live database
 * against a 210k-row batch that is ~3×10¹¹ comparisons, and it ran for over an
 * hour with the site stopped for the merge before it was killed. An expression
 * index on exactly COALESCE(col, sentinel) — same sentinels as dealKeyMatch,
 * '' for text and -1 for numbers — turns each lookup back into a seek.
 *
 * Four leading columns are enough to make the seek selective; the remaining key
 * columns (street, house_num, rooms) are checked against the few candidates the
 * seek returns. street/house_num are NULL on every nadlan row anyway.
 *
 * NEW NAME, on purpose. `CREATE INDEX IF NOT EXISTS` with the OLD name would
 * see the old plain index already present and silently do nothing, leaving the
 * slow path in place. The importer drops the old name explicitly; here a fresh
 * name guarantees the expression index is the one that gets built.
 *
 * NOT unique. A unique index would reject a real double report at insert time
 * and lose it, and cannot be created on the live table which already holds such
 * rows — that is what flag-duplicate-deals.ts is for. This only makes "have I
 * seen this deal" fast enough to run per batch instead of per table scan.
 */
export const DEAL_KEY_INDEX_SQL =
  `CREATE INDEX IF NOT EXISTS idx_nadlan_tx_dealkey_x
     ON nadlan_transactions (
       COALESCE(city_name, ''), COALESCE(deal_date, ''),
       COALESCE(price, -1), COALESCE(area, -1)
     )`;

/**
 * Drop the superseded plain-column index. Runs where multiple statements are
 * allowed (db.exec in import-transactions); kept separate from the CREATE above
 * so DEAL_KEY_INDEX_SQL stays a single statement for prisma.$executeRawUnsafe.
 */
export const DEAL_KEY_INDEX_DROP_OLD_SQL =
  `DROP INDEX IF EXISTS idx_nadlan_tx_dealkey`;

/**
 * Batch insert that skips rows already present.
 *
 * Built as WITH ... VALUES ... SELECT rather than a plain multi-row INSERT so a
 * whole batch is still one statement. Per-row round trips would turn a 2,400
 * deal city into 2,400 statements.
 *
 * @param cols  full column list being inserted, comma separated
 * @param rows  how many value tuples the caller is binding
 */
export function insertIfAbsentSql(cols: string, rows: number): string {
  const names = cols.split(",").map((c) => c.trim());
  const tuple = `(${names.map(() => "?").join(",")})`;
  const values = Array.from({ length: rows }, () => tuple).join(",");
  const quoted = names.map((c) => `"${c}"`).join(",");
  // Only key columns present in this insert can be compared; a collector that
  // does not write street/house_num still matches on what it does write.
  const usable = DEAL_KEY_COLS.filter((k) => names.includes(k));
  return `
    WITH v(${quoted}) AS (VALUES ${values})
    INSERT INTO nadlan_transactions (${quoted})
    SELECT ${names.map((c) => `v."${c}"`).join(",")} FROM v
     WHERE NOT EXISTS (
       SELECT 1 FROM nadlan_transactions t WHERE ${dealKeyMatch("t", "v", usable)}
     )`;
}
