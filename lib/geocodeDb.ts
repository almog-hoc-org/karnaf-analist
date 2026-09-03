/**
 * The tables behind deal locations, and the one place their DDL lives.
 *
 * WHY WRITERS SELF-PROVISION. prisma/schema.prisma shapes fresh databases
 * only; the live server database never sees a migration, so a table reaches
 * it by a CREATE TABLE IF NOT EXISTS executed by something that runs there
 * (the precedent is lib/addressBackfillDb.ts and the map tables in
 * scripts/collect-city-map.ts). Every writer — the national-file import, the
 * govmap residue apply, the fixture — calls ensureGeocodeTables first; every
 * reader wraps its SELECT in a try/catch and treats "no such table" as
 * "nothing geocoded yet", which is the normal state of every city until the
 * campaign reaches it.
 *
 * ONE ROW PER ADDRESS, NOT PER DEAL. See lib/addressKey.ts for why. The
 * primary key is the normalised (city, street, house) triple; house_norm ''
 * is the street itself — the fallback when a number is unknown, drawn as a
 * hollow ring rather than a filled pin so it never passes for an exact spot.
 */

export const ADDRESS_GEOCODES_DDL = `
CREATE TABLE IF NOT EXISTS address_geocodes (
  city_name   TEXT NOT NULL,
  street_norm TEXT NOT NULL,
  house_norm  TEXT NOT NULL,
  lon REAL, lat REAL,
  itm_x REAL, itm_y REAL,
  level  TEXT NOT NULL,
  source TEXT NOT NULL,
  raw_label TEXT,
  geocoded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (city_name, street_norm, house_norm)
);
CREATE INDEX IF NOT EXISTS idx_geocodes_city_level ON address_geocodes(city_name, level);

CREATE TABLE IF NOT EXISTS govmap_geocode_status (
  city_name TEXT NOT NULL UNIQUE,
  method_version TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  requested INTEGER NOT NULL DEFAULT 0,
  house_level INTEGER NOT NULL DEFAULT 0,
  street_level INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  last_run DATETIME
);

CREATE TABLE IF NOT EXISTS osm_address_status (
  city_name TEXT PRIMARY KEY,
  fetched INTEGER,
  kept INTEGER,
  streets INTEGER,
  imported_at DATETIME
);

CREATE TABLE IF NOT EXISTS mapi_import_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  resource_id TEXT,
  package_title TEXT,
  rows_in INTEGER,
  rows_kept INTEGER,
  crs TEXT,
  imported_at DATETIME
);
`;

/** For better-sqlite3 callers (scripts). */
export function ensureGeocodeTablesSync(db: { exec: (q: string) => unknown }): void {
  db.exec(ADDRESS_GEOCODES_DDL);
}

/** For prisma callers. $executeRawUnsafe takes one statement at a time. */
export async function ensureGeocodeTables(prisma: {
  $executeRawUnsafe: (q: string) => Promise<unknown>;
}): Promise<void> {
  for (const stmt of ADDRESS_GEOCODES_DDL.split(";").map((s) => s.trim()).filter(Boolean)) {
    try { await prisma.$executeRawUnsafe(stmt); } catch { /* exists */ }
  }
}
