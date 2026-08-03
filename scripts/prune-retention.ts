#!/usr/bin/env tsx
/**
 * Enforce the retention periods the privacy notice commits to.
 *
 * WHY THIS EXISTS
 * A retention policy that lives only in a published document is a claim. One
 * wired to a scheduled job is a fact. Both read the same constants from
 * lib/legal.ts, so the notice and the database cannot drift apart — change the
 * number in one place and both the page and this job follow.
 *
 * Runs as the last stage of the nightly pipeline. Idempotent; deleting nothing
 * is a normal outcome.
 *
 *   npx tsx scripts/prune-retention.ts             delete
 *   npx tsx scripts/prune-retention.ts --dry-run   report only
 */
import Database from "better-sqlite3";
import path from "path";
import { RETENTION } from "../lib/legal";

const APP_DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "app.db");

function main() {
  const dry = process.argv.includes("--dry-run");
  const db = new Database(APP_DB);
  db.pragma("journal_mode = WAL");

  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name)
  );

  console.log(`prune-retention${dry ? " (DRY RUN)" : ""} — ${APP_DB}`);

  /** Count first, then delete, so the log says what changed even on a dry run. */
  const sweep = (table: string, where: string, label: string) => {
    if (!tables.has(table)) { console.log(`  ${label}: הטבלה לא קיימת — מדלג`); return 0; }
    const n = Number((db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${where}`).get() as { c: number }).c);
    if (n === 0) { console.log(`  ${label}: אין מה למחוק`); return 0; }
    if (!dry) db.prepare(`DELETE FROM ${table} WHERE ${where}`).run();
    console.log(`  ${label}: ${dry ? "היו נמחקות" : "נמחקו"} ${n.toLocaleString("en")} רשומות`);
    return n;
  };

  let total = 0;
  total += sweep("events", `created_at < datetime('now','-${RETENTION.eventsDays} days')`,
                 `אירועים (>${RETENTION.eventsDays} יום)`);
  total += sweep("feedback", `created_at < datetime('now','-${RETENTION.feedbackDays} days')`,
                 `משוב (>${RETENTION.feedbackDays} יום)`);
  total += sweep("sessions", `expires_at < datetime('now','-${RETENTION.expiredSessionsDays} days')`,
                 `סשנים שפגו (>${RETENTION.expiredSessionsDays} יום)`);

  // Reclaim disk after a large delete. VACUUM rewrites the file, so it is only
  // worth the I/O when something actually went.
  if (!dry && total > 1000) {
    db.exec("VACUUM");
    console.log("  VACUUM — שטח דיסק שוחרר");
  }

  console.log(`  סה"כ: ${total.toLocaleString("en")}`);
  db.close();
}

main();
