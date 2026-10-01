/**
 * Tables for the tax authority's deal register (lib/mekarkein.ts), created by
 * the scripts that write them (CREATE TABLE IF NOT EXISTS, like every writer
 * here). Also the one guarded ALTER that adds nadlan_transactions.mekarkein_id,
 * the register row a deal was matched to.
 */
export function ensureMekarkeinTables(db: { exec: (q: string) => unknown }): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mekarkein_deals (
      id TEXT PRIMARY KEY,
      city_name TEXT,
      settlement TEXT NOT NULL,
      settlement_code TEXT,
      gush INTEGER NOT NULL,
      helka INTEGER NOT NULL,
      sub INTEGER NOT NULL,
      deal_date TEXT NOT NULL,
      amount INTEGER NOT NULL,
      declared_amount INTEGER,
      nature TEXT,
      portion REAL,
      area REAL,
      rooms REAL,
      year_built INTEGER,
      first_seen TEXT,
      imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_mek_city_date_amount ON mekarkein_deals(city_name, deal_date, amount);
    CREATE INDEX IF NOT EXISTS idx_mek_city_parcel ON mekarkein_deals(city_name, gush, helka);
    CREATE TABLE IF NOT EXISTS mekarkein_import_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      mode TEXT NOT NULL,
      rows_read INTEGER NOT NULL,
      rows_new INTEGER NOT NULL,
      rows_unmapped INTEGER NOT NULL,
      last_first_seen TEXT
    );
  `);
}

/** The source version a run loaded, so a nightly run can skip an unchanged one. */
export function ensureImportSourceColumn(db: { exec: (q: string) => unknown }): void {
  try { db.exec("ALTER TABLE mekarkein_import_status ADD COLUMN source_modified TEXT"); } catch { /* already exists */ }
}

export function ensureMekarkeinIdColumn(db: { exec: (q: string) => unknown }): void {
  try { db.exec("ALTER TABLE nadlan_transactions ADD COLUMN mekarkein_id TEXT"); } catch { /* already exists */ }
}
