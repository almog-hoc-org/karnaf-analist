/**
 * App DB — user-generated content (tracked cities, personal deals, tasks).
 * Deliberately SEPARATE from the read-only analytics DB (data/realestate.db):
 * lives in data/app.db, accessed directly via better-sqlite3 (no Prisma codegen).
 * Single-user for now; a user_id column is included so auth can attach later.
 */
import Database from "better-sqlite3";
import path from "path";

let db: Database.Database | null = null;

export function appDb(): Database.Database {
  if (db) return db;
  db = new Database(path.join(process.cwd(), "data", "app.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_cities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT 'owner',
      city_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, city_name)
    );
    CREATE TABLE IF NOT EXISTS client_deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT 'owner',
      city TEXT NOT NULL,
      neighborhood TEXT,
      street TEXT,
      house_num TEXT,
      size REAL,
      rooms REAL,
      floor INTEGER,
      price REAL,
      balcony_sqm REAL,
      parking_spots INTEGER,
      storage_sqm REAL,
      status TEXT NOT NULL DEFAULT 'seen',
      listing_url TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS deal_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL REFERENCES client_deals(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

export interface ClientDeal {
  id: number;
  city: string;
  neighborhood: string | null;
  street: string | null;
  house_num: string | null;
  size: number | null;
  rooms: number | null;
  floor: number | null;
  price: number | null;
  balcony_sqm: number | null;
  parking_spots: number | null;
  storage_sqm: number | null;
  status: string;
  listing_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  tasks: { id: number; title: string; done: number }[];
}

/**
 * `userId` is REQUIRED on both readers below — deliberately no default.
 *
 * These used to default to "owner". Combined with the old anonymous fallback in
 * lib/auth.ts that made the shared-workspace leak reachable through a second
 * door: any caller that simply forgot the argument silently read someone else's
 * personal data. Making it required moves that from "remember to pass it" to a
 * compile error.
 */
export function listDeals(userId: string): ClientDeal[] {
  const d = appDb();
  const deals = d.prepare("SELECT * FROM client_deals WHERE user_id=? ORDER BY updated_at DESC").all(userId) as any[];
  const taskStmt = d.prepare("SELECT id, title, done FROM deal_tasks WHERE deal_id=? ORDER BY id");
  return deals.map((deal) => ({ ...deal, tasks: taskStmt.all(deal.id) }));
}

export function listTrackedCities(userId: string): string[] {
  return (appDb().prepare("SELECT city_name FROM tracked_cities WHERE user_id=? ORDER BY id").all(userId) as any[])
    .map((r) => r.city_name);
}
