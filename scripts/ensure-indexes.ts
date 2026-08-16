#!/usr/bin/env tsx
/**
 * Create the read-path indexes on the live database.
 *
 * WHY THIS IS A SCRIPT AND NOT A PRISMA MIGRATION
 * prisma/migrations is never applied to the running database: the Dockerfile
 * only `db push`es when the file is ABSENT (Dockerfile:76), and the server's
 * realestate.db has existed since long before that. So a `@@index` added to
 * schema.prisma is documentation — true of the shape, inert on the data. The
 * indexes have to be created by something that actually runs against the live
 * file, and the nightly pipeline is the one thing that does.
 *
 * Everything here is CREATE INDEX IF NOT EXISTS: the first run builds them
 * (seconds, on 1.35M rows), every run after is a no-op. Safe to run any time.
 *
 * WHAT EACH ONE IS FOR — measured, not guessed:
 *   idx_nadlan_tx_deal_date      the home page's "deals in the last 12 months"
 *   idx_nadlan_tx_excluded_year  the home page's "usable deals" count
 *     Both were full scans of the whole table on every render: the only
 *     existing index leads with city_name, which neither predicate mentions.
 *   idx_stats_bucket_scope_year  /cities, /compare and the rankings, which scan
 *     the stats table by bucket+scope across ALL cities; the unique index there
 *     also leads with city_name and cannot serve them.
 *
 * Run: npx tsx scripts/ensure-indexes.ts   (pipeline: first stage)
 */
import Database from "better-sqlite3";
import path from "path";

const DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db");

const INDEXES: Array<{ name: string; sql: string; why: string }> = [
  {
    name: "idx_nadlan_tx_deal_date",
    sql: "CREATE INDEX IF NOT EXISTS idx_nadlan_tx_deal_date ON nadlan_transactions(deal_date)",
    why: 'עסקאות ב-12 החודשים האחרונים (עמוד הבית)',
  },
  {
    name: "idx_nadlan_tx_excluded_year",
    sql: "CREATE INDEX IF NOT EXISTS idx_nadlan_tx_excluded_year ON nadlan_transactions(excluded, deal_year)",
    why: 'ספירת עסקאות כשירות (עמוד הבית)',
  },
  {
    name: "idx_stats_bucket_scope_year",
    sql: "CREATE INDEX IF NOT EXISTS idx_stats_bucket_scope_year ON nadlan_year_room_stats(room_bucket, scope, year)",
    why: 'סריקות חוצות-ערים (טבלת ערים, השוואה, דירוגים)',
  },
];

function main() {
  const db = new Database(DB);
  db.pragma("busy_timeout = 60000");
  try {
    const before = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>)
        .map((r) => r.name)
    );

    let created = 0;
    for (const ix of INDEXES) {
      if (before.has(ix.name)) {
        console.log(`  ✓ ${ix.name} — קיים`);
        continue;
      }
      const t0 = Date.now();
      db.exec(ix.sql);
      created++;
      console.log(`  + ${ix.name} — נוצר ב-${((Date.now() - t0) / 1000).toFixed(1)}s · ${ix.why}`);
    }

    // ANALYZE only when something changed: it rewrites sqlite_stat1, which the
    // planner reads to decide whether a new index is worth using at all. Skipping
    // it is how a freshly created index sits there unused.
    if (created) {
      db.exec("ANALYZE");
      console.log("  · ANALYZE הורץ — מתכנן השאילתות מכיר את האינדקסים החדשים");
    }
    console.log(`ensure-indexes: ${created} נוצרו, ${INDEXES.length - created} כבר היו קיימים`);
  } finally {
    db.close();
  }
}

main();
