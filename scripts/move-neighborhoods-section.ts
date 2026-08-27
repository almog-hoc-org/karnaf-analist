#!/usr/bin/env tsx
/**
 * One-shot: move "neighborhoods" to directly after "chart-studio" in the
 * SAVED section order of the city page — the operator's 8/2026 request.
 *
 * WHY A SCRIPT AND NOT JUST THE CATALOGUE EDIT. The catalogue's order is only
 * the DEFAULT; an order saved via the admin drag-and-drop panel wins over it,
 * on purpose. So if the operator ever saved one, moving the catalogue entry
 * changes nothing they can see. This nudges the one key inside the saved
 * order — when there is one — and leaves every other position exactly where
 * the operator put it. No saved order, no-op. Idempotent: a key already in
 * place is left alone.
 *
 *   npx tsx scripts/move-neighborhoods-section.ts
 */
import Database from "better-sqlite3";
import path from "path";

const DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "app.db");

function main(): number {
  const db = new Database(DB);
  db.pragma("busy_timeout = 30000");
  try {
    const row = db.prepare("SELECT keys FROM section_order WHERE page = 'city'").get() as { keys: string } | undefined;
    if (!row) { console.log("אין סדר שמור לעמוד העיר — ברירת המחדל של הקטלוג תקפה. אין מה להזיז."); return 0; }
    const keys: string[] = JSON.parse(row.keys);
    const from = keys.indexOf("neighborhoods");
    const anchor = keys.indexOf("chart-studio");
    if (from < 0 || anchor < 0) { console.log("אחד המפתחות איננו בסדר השמור — לא נוגע."); return 0; }
    if (from === anchor + 1) { console.log("neighborhoods כבר מיד אחרי chart-studio — אין מה לעשות."); return 0; }
    keys.splice(from, 1);
    const at = keys.indexOf("chart-studio") + 1;
    keys.splice(at, 0, "neighborhoods");
    db.prepare("UPDATE section_order SET keys = ?, updated_at = CURRENT_TIMESTAMP WHERE page = 'city'").run(JSON.stringify(keys));
    console.log(`✓ הוזז: neighborhoods עכשיו במקום ${at + 1} (אחרי chart-studio), שאר הסדר לא נגע.`);
    return 0;
  } catch (e) {
    console.log(`⏭ דילוג — ${e instanceof Error ? e.message : e}`);
    return 0; // never fail a deploy over a layout preference
  } finally {
    db.close();
  }
}

process.exit(main());

export {};
