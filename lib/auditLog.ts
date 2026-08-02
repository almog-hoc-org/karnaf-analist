/**
 * The schema for `admin_exclusion_log`, the audit trail behind every automatic
 * and manual exclusion.
 *
 * WHY THIS FILE EXISTS
 * Seven places write to this table — four cleaning scripts and the admin API —
 * and NOTHING created it. It is not in prisma/schema.prisma and no script
 * declares it; it exists only on databases old enough to have been given it by
 * hand. Any database built from the schema (a fresh deployment, a restore, a
 * developer's first run) hits `no such table: admin_exclusion_log` — the
 * cleaning pipeline dies partway through, and manual admin exclusions return a
 * 500. A table with seven writers and no owner is a deployment failure waiting
 * for its first fresh install, which is exactly what moving to a VPS is.
 *
 * The DDL lives here once so the writers cannot drift. Note `filter_desc`: the
 * admin API writes it and the scripts do not, so it must be nullable.
 */
/** One statement per entry — Prisma's executeRawUnsafe takes a single statement. */
export const AUDIT_LOG_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS admin_exclusion_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    affected INTEGER NOT NULL DEFAULT 0,
    filter_desc TEXT,
    reason TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_admin_exclusion_log_created ON admin_exclusion_log(created_at DESC)`,
];

export const AUDIT_LOG_DDL = AUDIT_LOG_STATEMENTS.join(";\n") + ";";

/**
 * Create the table if missing, given a better-sqlite3 handle. Typed
 * structurally so this module needs no better-sqlite3 import — it is used by
 * Next.js server code as well as by CLI scripts.
 */
export function ensureAuditLog(db: { exec: (sql: string) => unknown }): void {
  db.exec(AUDIT_LOG_DDL);
}

/**
 * Same, for callers holding a Prisma client instead.
 *
 * Worth stating plainly: flag-outlier-deals.ts already wrapped its audit INSERT
 * in `.catch(() => {})`, so on a database without this table it reported
 * success while writing no audit row at all. Creating the table up front is
 * what makes that catch a genuine safety net rather than a blindfold.
 */
export async function ensureAuditLogPrisma(
  client: { $executeRawUnsafe: (sql: string) => Promise<unknown> }
): Promise<void> {
  for (const stmt of AUDIT_LOG_STATEMENTS) await client.$executeRawUnsafe(stmt);
}
