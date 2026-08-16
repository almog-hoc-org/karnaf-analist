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

/**
 * Give a column TEXT affinity by rebuilding it.
 *
 * WHY A CAST IS NOT ENOUGH — this is the whole subtlety of the bug.
 * SQLite applies the column's AFFINITY on every write. A column declared
 * INTEGER (or anything numeric) converts "3" straight back to 3 as it stores
 * it, so `UPDATE t SET c = CAST(c AS TEXT)` reports success, changes nothing,
 * and the verification finds the identical count it started with. That is
 * exactly what the first live run did: 66 values converted, 66 still numeric.
 *
 * A column that genuinely has TEXT affinity cannot hold an integer at all —
 * SQLite converts numbers to text on the way in — which is why fixing the
 * declared type retires the entire failure mode rather than papering over it.
 *
 * SQLite cannot change a column's type in place, so: add, copy, drop, rename.
 * One transaction, so a crash leaves the old column intact.
 */
function rebuildAsText(db: Database.Database, table: string, col: string) {
  const tmp = `${col}__astext`;
  db.transaction(() => {
    // A previous interrupted run could have left the scratch column behind.
    const cols = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name)
    );
    if (cols.has(tmp)) db.exec(`ALTER TABLE ${table} DROP COLUMN ${tmp}`);

    db.exec(`ALTER TABLE ${table} ADD COLUMN ${tmp} TEXT`);
    db.exec(`UPDATE ${table} SET ${tmp} = CAST(${col} AS TEXT) WHERE ${col} IS NOT NULL`);
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${col}`);
    db.exec(`ALTER TABLE ${table} RENAME COLUMN ${tmp} TO ${col}`);
  })();
}

function main() {
  const db = new Database(DB);
  db.pragma("busy_timeout = 60000");
  let totalFixed = 0;

  try {
    // Declared types first: a value repair against a numeric-affinity column
    // is a no-op that reports success, so the affinity has to be right before
    // anything is worth casting.
    for (const [table, columns] of Object.entries(TEXT_COLUMNS)) {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!exists) continue;
      const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type: string }>;
      for (const c of info) {
        if (!columns.includes(c.name)) continue;
        // TEXT / VARCHAR / CLOB / anything containing "CHAR" all carry TEXT
        // affinity per SQLite's rules; everything else does not.
        const declared = (c.type || "").toUpperCase();
        const isTextAffinity = declared.includes("CHAR") || declared.includes("CLOB") || declared.includes("TEXT");
        if (isTextAffinity) continue;
        const t0 = Date.now();
        rebuildAsText(db, table, c.name);
        console.log(
          `  ⚑ ${table}.${c.name}: הוגדרה כ-${c.type || "(ללא טיפוס)"} — נבנתה מחדש כ-TEXT ` +
          `ב-${((Date.now() - t0) / 1000).toFixed(1)}s. עמודה נומרית ממירה מחרוזת ספרות בחזרה למספר, ` +
          `ולכן המרה בלבד לא הייתה נדבקת.`
        );
      }
    }

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
