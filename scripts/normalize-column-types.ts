#!/usr/bin/env tsx
/**
 * Make the live database's VALUE types match what schema.prisma declares.
 *
 * THE FAILURE THIS FIXES — measured on production, 16.8.2026
 * Entering a city page returned Next's "server-side exception" screen with an
 * opaque digest. The stack, once captured, was:
 *
 *     PrismaClientKnownRequestError: Invalid `prisma.nadlan_transactions.findMany()`
 *     Expected a string in column 'floor', got number: 2      (code P2023)
 *
 * `floor` is `String?` in schema.prisma, because the Tax Authority feed returns
 * Hebrew floor NAMES ("קומת קרקע", "חמישית") as often as digits. SQLite has no
 * column-type enforcement — a column's declared type is a hint, and a value
 * written as an integer stays an integer — so a collector that passed `2`
 * instead of `"2"` stored an integer in a text column and nothing complained.
 * Prisma 7 validates on the way out and refuses the whole row, which takes down
 * the entire page: not the floor cell, not that deal, the page.
 *
 * WHY THIS IS A WHOLE CLASS AND NOT ONE BUG
 * The failing city changes with every collection run. The operator reported
 * מגדל העמק; by the time it was reproduced the failures were פתח תקווה and
 * רעננה, because those are the cities whose latest deals happened to carry a
 * numeric floor. Any text column can acquire the same defect from any writer,
 * and the symptom is always a 500 on an unpredictable subset of cities. So this
 * repairs EVERY text-declared column rather than the one that broke today.
 *
 * The collectors were fixed too (they now stringify), but a writer-side fix
 * only protects rows written after the deploy. This runs nightly and is
 * idempotent: after the first pass it finds nothing and costs one indexed scan.
 *
 * Run: npx tsx scripts/normalize-column-types.ts   (pipeline: after indexes)
 */
import Database from "better-sqlite3";
import path from "path";

const DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db");

/**
 * Columns declared as String in schema.prisma. A value of any other SQLite
 * storage class here is a latent 500.
 *
 * Adding a text column to the schema? Add it here. The verification below
 * fails loudly if a repair does not stick, but it can only check what it knows.
 */
const TEXT_COLUMNS: Record<string, string[]> = {
  nadlan_transactions: [
    "city_name", "cbs_code", "deal_date", "room_bucket",
    "neighborhood", "street", "house_num", "floor",
    "source", "class_source", "exclusion_reason",
  ],
  nadlan_year_room_stats: ["city_name", "room_bucket", "scope"],
};

function main() {
  const db = new Database(DB);
  db.pragma("busy_timeout = 60000");
  let totalFixed = 0;

  try {
    for (const [table, columns] of Object.entries(TEXT_COLUMNS)) {
      // A table the deployment does not have yet is not an error.
      const exists = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
      ).get(table);
      if (!exists) continue;

      const present = new Set(
        (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name)
      );

      for (const col of columns) {
        if (!present.has(col)) continue;
        // typeof() is SQLite's storage class, which is exactly the thing Prisma
        // checks. 'text' passes; 'null' is a NULL and is fine; anything else —
        // integer, real, blob — is the defect.
        const bad = db.prepare(
          `SELECT COUNT(*) n FROM ${table} WHERE ${col} IS NOT NULL AND typeof(${col}) <> 'text'`
        ).get() as { n: number };
        if (!bad.n) continue;

        const sample = db.prepare(
          `SELECT ${col} v, typeof(${col}) t FROM ${table}
            WHERE ${col} IS NOT NULL AND typeof(${col}) <> 'text' LIMIT 1`
        ).get() as { v: unknown; t: string };

        db.prepare(
          `UPDATE ${table} SET ${col} = CAST(${col} AS TEXT)
            WHERE ${col} IS NOT NULL AND typeof(${col}) <> 'text'`
        ).run();

        totalFixed += bad.n;
        console.log(
          `  ↻ ${table}.${col}: ${bad.n.toLocaleString("he-IL")} ערכים הומרו ל-TEXT ` +
          `(דוגמה: ${JSON.stringify(sample.v)} מסוג ${sample.t})`
        );
      }
    }

    // Verify rather than assume. A CAST that silently did nothing would leave
    // the site 500ing on the same cities while this script reported success.
    const leftovers: string[] = [];
    for (const [table, columns] of Object.entries(TEXT_COLUMNS)) {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!exists) continue;
      const present = new Set(
        (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name)
      );
      for (const col of columns) {
        if (!present.has(col)) continue;
        const bad = db.prepare(
          `SELECT COUNT(*) n FROM ${table} WHERE ${col} IS NOT NULL AND typeof(${col}) <> 'text'`
        ).get() as { n: number };
        if (bad.n) leftovers.push(`${table}.${col} (${bad.n})`);
      }
    }

    if (leftovers.length) {
      console.error(`✗ normalize-column-types: ערכים לא-טקסטואליים נותרו ב-${leftovers.join(", ")}`);
      process.exit(2);
    }

    console.log(
      totalFixed
        ? `normalize-column-types: ${totalFixed.toLocaleString("he-IL")} ערכים תוקנו — כל העמודות הטקסטואליות תקינות`
        : "normalize-column-types: ✓ כל העמודות הטקסטואליות כבר תקינות"
    );
  } finally {
    db.close();
  }
}

main();
