/**
 * The one guarded ALTER for the `source_deal_id` column, shared by every
 * writer that stores it.
 *
 * WHY WRITERS SELF-PROVISION. prisma/schema.prisma describes the column for
 * FRESH databases (db push runs only against scratch/build DBs), but the live
 * server database predates the schema and never sees a migration — columns
 * reach it only through a guarded ALTER executed by something that actually
 * runs there. Every writer runs this before its first insert; the "duplicate
 * column" error on every later run is the success case.
 */
export const SOURCE_DEAL_ID_ALTER =
  "ALTER TABLE nadlan_transactions ADD COLUMN source_deal_id TEXT";

/** For prisma callers (the network collectors). */
export async function ensureSourceDealIdColumn(prisma: {
  $executeRawUnsafe: (q: string) => Promise<unknown>;
}): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(SOURCE_DEAL_ID_ALTER);
  } catch {
    /* already exists — the normal case */
  }
}

/** For better-sqlite3 callers (the backfill campaign). */
export function ensureSourceDealIdColumnSync(db: { exec: (q: string) => unknown }): void {
  try {
    db.exec(SOURCE_DEAL_ID_ALTER);
  } catch {
    /* already exists — the normal case */
  }
}

/**
 * The two columns the nadlan address campaign adds (4.9.2026): the parcel
 * (gush-helka-tat, e.g. "7242-126-6") that ties a deal to its building even
 * when the street is spelled differently, and the building's floor count.
 * Same guarded-ALTER discipline as source_deal_id.
 */
export const NADLAN_ADDRESS_COLUMN_ALTERS = [
  "ALTER TABLE nadlan_transactions ADD COLUMN parcel_num TEXT",
  "ALTER TABLE nadlan_transactions ADD COLUMN building_floors INTEGER",
] as const;

/** For prisma callers (the nightly nadlan collector, which now stores parcel/floors too). */
export async function ensureNadlanAddressColumns(prisma: { $executeRawUnsafe: (q: string) => Promise<unknown> }): Promise<void> {
  await ensureSourceDealIdColumn(prisma);
  for (const q of NADLAN_ADDRESS_COLUMN_ALTERS) {
    try { await prisma.$executeRawUnsafe(q); } catch { /* already exists — the normal case */ }
  }
}

export function ensureNadlanAddressColumnsSync(db: { exec: (q: string) => unknown }): void {
  ensureSourceDealIdColumnSync(db);
  for (const q of NADLAN_ADDRESS_COLUMN_ALTERS) {
    try { db.exec(q); } catch { /* already exists — the normal case */ }
  }
}
