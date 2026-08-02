#!/usr/bin/env tsx
/**
 * Move the legacy "owner" workspace onto a real account.
 *
 * WHY THIS EXISTS
 * Until the access model changed, `workspaceId()` returned the literal string
 * "owner" for anonymous visitors, so every tracked city, client deal and task
 * created before that change is stored under user_id='owner'. Nothing reaches
 * that workspace any more — the pages and actions now require a session and
 * scope every query to the caller's own id. The rows are intact but orphaned.
 *
 * This hands them to a real account, so the data you already curated shows up
 * when you log in.
 *
 * USAGE
 *   npx tsx scripts/claim-owner-workspace.ts --list
 *       show the registered accounts and how much data is waiting under 'owner'
 *
 *   npx tsx scripts/claim-owner-workspace.ts --email you@example.com
 *       dry run — prints exactly what WOULD move, changes nothing
 *
 *   npx tsx scripts/claim-owner-workspace.ts --email you@example.com --apply
 *       perform the move, inside one transaction
 *
 *   npx tsx scripts/claim-owner-workspace.ts --purge --apply
 *       the data was only test scaffolding: delete it instead
 *
 * Register the account through the site FIRST, then run this.
 * Safe to re-run: once 'owner' is empty every mode is a no-op.
 */
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "app.db");

interface Counts { cities: number; deals: number; tasks: number }

function ownerCounts(db: Database.Database): Counts {
  const one = (sql: string) => Number((db.prepare(sql).get() as { n: number } | undefined)?.n ?? 0);
  return {
    cities: one("SELECT COUNT(*) n FROM tracked_cities WHERE user_id='owner'"),
    deals: one("SELECT COUNT(*) n FROM client_deals   WHERE user_id='owner'"),
    // tasks hang off deals, so they move with their parent
    tasks: one(`SELECT COUNT(*) n FROM deal_tasks
                WHERE deal_id IN (SELECT id FROM client_deals WHERE user_id='owner')`),
  };
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (n: string) => argv.includes(`--${n}`);
  const value = (n: string) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name)
  );
  if (!tables.has("client_deals")) {
    console.log(`nothing to do — ${DB_PATH} has no personal-workspace tables yet.`);
    db.close();
    return;
  }

  const before = ownerCounts(db);
  const total = before.cities + before.deals + before.tasks;

  if (flag("list") || argv.length === 0) {
    console.log(`app.db: ${DB_PATH}\n`);
    console.log(`waiting under 'owner': ${before.cities} tracked cities · ${before.deals} deals · ${before.tasks} tasks`);
    const users = tables.has("users")
      ? (db.prepare("SELECT id, email, name FROM users ORDER BY id").all() as { id: number; email: string; name: string }[])
      : [];
    console.log(`\nregistered accounts (${users.length}):`);
    for (const u of users) console.log(`  u${u.id}  ${u.email}  (${u.name})`);
    if (!users.length) console.log("  — none yet. Register through the site, then re-run.");
    console.log(`\nnext: npx tsx scripts/claim-owner-workspace.ts --email <address>`);
    db.close();
    return;
  }

  if (total === 0) {
    console.log("'owner' workspace is already empty — nothing to move.");
    db.close();
    return;
  }

  const apply = flag("apply");

  // ── purge mode ────────────────────────────────────────────────────
  if (flag("purge")) {
    console.log(`purge: ${before.deals} deals · ${before.tasks} tasks · ${before.cities} tracked cities`);
    if (!apply) {
      console.log("\ndry run — nothing deleted. Re-run with --apply to delete for real.");
      db.close();
      return;
    }
    db.transaction(() => {
      db.prepare(`DELETE FROM deal_tasks
                  WHERE deal_id IN (SELECT id FROM client_deals WHERE user_id='owner')`).run();
      db.prepare("DELETE FROM client_deals WHERE user_id='owner'").run();
      db.prepare("DELETE FROM tracked_cities WHERE user_id='owner'").run();
    })();
    console.log("✓ purged.");
    db.close();
    return;
  }

  // ── claim mode ────────────────────────────────────────────────────
  const email = value("email");
  if (!email) {
    console.error("✗ pass --email <address> (or --purge). --list shows the accounts.");
    process.exit(1);
  }
  if (!tables.has("users")) {
    console.error("✗ no users table yet — register through the site first.");
    process.exit(1);
  }
  const user = db.prepare("SELECT id, email, name FROM users WHERE email=?")
    .get(email.trim().toLowerCase()) as { id: number; email: string; name: string } | undefined;
  if (!user) {
    console.error(`✗ no account for ${email}. Register through the site first, then re-run.`);
    process.exit(1);
  }

  // matches AuthUser.id in lib/auth.ts — "u" + rowid
  const target = `u${user.id}`;
  console.log(`claiming 'owner' → ${target} (${user.email})`);
  console.log(`  ${before.cities} tracked cities · ${before.deals} deals · ${before.tasks} tasks`);

  // A city the account already tracks would collide with UNIQUE(user_id, city_name).
  const collisions = Number((db.prepare(
    `SELECT COUNT(*) n FROM tracked_cities o
     WHERE o.user_id='owner'
       AND EXISTS (SELECT 1 FROM tracked_cities t WHERE t.user_id=? AND t.city_name=o.city_name)`
  ).get(target) as { n: number }).n);
  if (collisions) console.log(`  ${collisions} tracked cities already exist on the target — those rows are dropped, not duplicated`);

  if (!apply) {
    console.log("\ndry run — nothing changed. Re-run with --apply to perform the move.");
    db.close();
    return;
  }

  db.transaction(() => {
    // deals (tasks follow their parent by deal_id — no update needed there)
    db.prepare("UPDATE client_deals SET user_id=? WHERE user_id='owner'").run(target);
    // drop the duplicates first so the UPDATE below can't hit the unique index
    db.prepare(
      `DELETE FROM tracked_cities
       WHERE user_id='owner'
         AND city_name IN (SELECT city_name FROM tracked_cities WHERE user_id=?)`
    ).run(target);
    db.prepare("UPDATE tracked_cities SET user_id=? WHERE user_id='owner'").run(target);
  })();

  const after = ownerCounts(db);
  console.log(`✓ moved. 'owner' now holds ${after.cities} cities · ${after.deals} deals · ${after.tasks} tasks (expected 0).`);
  db.close();
}

main();
