#!/usr/bin/env tsx
/**
 * Re-classify each deal's room count BY AREA (user rule: area is more reliable
 * than the reported room count — a "4-room" at 60 m² is really a 3-room).
 *
 * Writes rooms_effective + room_reclassified, and rewrites room_bucket from the
 * effective count, so ALL downstream room-type logic (aggregation cohorts, the
 * ±deviation price-anomaly filter) uses the corrected type. Reversible in spirit:
 * the original `rooms` is never touched. Idempotent — recomputes every run from
 * the current (admin-editable) ranges. Last 10 years only.
 *
 * Run: npx tsx scripts/reclassify-rooms-by-area.ts   (pipeline: after merge, before flag)
 */
import Database from "better-sqlite3";
import path from "path";
import { getRoomRanges, effectiveRoomsWithRanges, roomBucketOf } from "../lib/roomClassification";
import { historyFromYear } from "../lib/historyWindow";

// Window comes from the shared history floor (lib/historyWindow) — every
// stage must process the SAME range or later stages aggregate rows earlier
// stages never cleaned. Was a private `YEARS_BACK = 10` per script.

function ensureColumn(db: Database.Database, table: string, col: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function main() {
  const db = new Database(path.resolve("./data/realestate.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 60000");
  const minYear = historyFromYear();
  const ranges = getRoomRanges();
  console.log(`reclassify-rooms-by-area: ranges 2=${ranges[2]} 3=${ranges[3]} 4=${ranges[4]} 5=${ranges[5]} 6=${ranges[6]} · years≥${minYear}`);

  ensureColumn(db, "nadlan_transactions", "rooms_effective", "rooms_effective REAL");
  ensureColumn(db, "nadlan_transactions", "room_reclassified", "room_reclassified INTEGER DEFAULT 0");

  const rows = db.prepare(
    `SELECT id, rooms, area, room_bucket FROM nadlan_transactions WHERE deal_year >= ?`
  ).all(minYear) as Array<{ id: number; rooms: number | null; area: number | null; room_bucket: string | null }>;

  const upd = db.prepare(
    `UPDATE nadlan_transactions SET rooms_effective=?, room_bucket=?, room_reclassified=? WHERE id=?`);
  let changed = 0, total = 0;
  const run = db.transaction(() => {
    for (const r of rows) {
      total++;
      const eff = effectiveRoomsWithRanges(r.rooms, r.area, ranges);
      const bucket = roomBucketOf(eff);
      const reported = r.rooms != null && r.rooms > 0 ? Math.round(r.rooms) : null;
      const isChanged = eff != null && reported != null && eff !== reported ? 1 : 0;
      if (isChanged) changed++;
      upd.run(eff, bucket, isChanged, r.id);
    }
  });
  run();

  const pct = total ? (changed / total * 100).toFixed(1) : "0";
  console.log(`  processed ${total.toLocaleString("en")} deals · ${changed.toLocaleString("en")} re-classified by area (${pct}%).`);
  db.close();
}
main();
