#!/usr/bin/env tsx
/**
 * Merge a transaction database collected elsewhere into the live one.
 *
 * WHY THIS EXISTS
 * The Tax Authority geo-restricts govmap.gov.il and nadlan.gov.il to Israel.
 * Measured: the same asset URL returns 10,158,613 bytes of JavaScript from a
 * machine in Israel and 1,734 bytes of HTML shell from this server in Europe.
 * So the deals cannot be collected here at all, by any client, proxy aside.
 *
 * They CAN be collected from a machine in Israel, and the operating model only
 * needs that twice a year. This script is the receiving end: collect at home,
 * ship the file, merge it here.
 *
 * WHAT IT REPLACES, AND WHAT IT REFUSES TO TOUCH
 * Only the two tables the Tax Authority collectors own:
 *
 *   nadlan_transactions        the deals themselves
 *   nadlan_collection_status   the per-city collection manifest
 *
 * Everything else in the live database stays exactly as it is. That matters
 * more than it looks: the server collects the CBS and the Chief Economist every
 * night into the SAME file — cbs_press_data, construction_starts, city rows.
 * Copying the whole database over from a laptop would silently destroy all of
 * it, and the loss would surface weeks later as a supply page gone quiet.
 *
 * nadlan_year_room_stats is deliberately NOT imported. It is derived, the
 * pipeline rebuilds it from these rows, and importing a laptop's copy would
 * publish statistics nothing on this machine had verified.
 *
 * REPLACE, NOT UPSERT. The incoming file is a complete 10-year collection, and
 * there is no natural key on a deal that is reliable enough to merge row by row
 * without risking double-counting — which would corrupt every median on the
 * site. Wholesale replacement inside one transaction is the honest operation,
 * and the gates below are what make it safe.
 *
 *   npx tsx scripts/import-transactions.ts /app/data/incoming.db
 *   npx tsx scripts/import-transactions.ts /app/data/incoming.db --dry-run
 *   npx tsx scripts/import-transactions.ts /app/data/incoming.db --force
 *
 * EXIT CODES: 0 merged · 1 unusable input · 2 a gate refused the merge.
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const LIVE_DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db");

/** The only tables this script is allowed to write. */
const TABLES = ["nadlan_transactions", "nadlan_collection_status"] as const;

/**
 * How much smaller the incoming set may be before the merge is refused.
 *
 * Same 2% the aggregation uses, and for the same reason: a collection that came
 * back materially thinner than what is already live is a symptom — an
 * interrupted run, a browser session that died halfway, a machine that went to
 * sleep — not something to publish and find out about from a reader.
 */
const MAX_SHRINK_PCT = 2;

/**
 * Column names of a table, optionally in an attached schema.
 *
 * The schema goes BEFORE the pragma name — `PRAGMA src.table_info(t)`, not
 * `PRAGMA table_info(src.t)`. The second parses as a function call on a
 * qualified name and fails with a bare "near '.': syntax error", which says
 * nothing about what is actually wrong.
 */
function columnsOf(db: Database.Database, table: string, schema = "main"): string[] {
  return (db.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
}

function tableExists(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

const n = (v: unknown) => Number(v ?? 0).toLocaleString("en");

function main() {
  const argv = process.argv.slice(2);
  const incomingPath = argv.find((a) => !a.startsWith("--"));
  const dry = argv.includes("--dry-run");
  const force = argv.includes("--force");

  if (!incomingPath) {
    console.error("שימוש: npx tsx scripts/import-transactions.ts <נתיב-לקובץ> [--dry-run] [--force]");
    process.exit(1);
  }
  if (!fs.existsSync(incomingPath)) {
    console.error(`✗ הקובץ לא נמצא: ${incomingPath}`);
    process.exit(1);
  }
  if (path.resolve(incomingPath) === LIVE_DB) {
    console.error("✗ קובץ הקלט הוא מסד הנתונים החי עצמו. מסרב.");
    process.exit(1);
  }

  console.log(`▶ מיזוג עסקאות`);
  console.log(`  נכנס: ${incomingPath} (${(fs.statSync(incomingPath).size / 1e6).toFixed(0)}MB)`);
  console.log(`  חי:   ${LIVE_DB} (${(fs.statSync(LIVE_DB).size / 1e6).toFixed(0)}MB)\n`);

  // ── validate the incoming file BEFORE touching anything ──────────────
  const inc = new Database(incomingPath, { readonly: true });

  const integrity = (inc.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
  if (integrity !== "ok") {
    console.error(`✗ הקובץ הנכנס פגום: ${integrity}`);
    process.exit(1);
  }
  if (!tableExists(inc, "nadlan_transactions")) {
    console.error("✗ אין טבלת nadlan_transactions בקובץ הנכנס.");
    process.exit(1);
  }

  const db = new Database(LIVE_DB);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 60000");

  const incCount = Number((inc.prepare("SELECT COUNT(*) c FROM nadlan_transactions").get() as { c: number }).c);
  const liveCount = Number((db.prepare("SELECT COUNT(*) c FROM nadlan_transactions").get() as { c: number }).c);
  const incCities = Number((inc.prepare("SELECT COUNT(DISTINCT city_name) c FROM nadlan_transactions").get() as { c: number }).c);
  const liveCities = Number((db.prepare("SELECT COUNT(DISTINCT city_name) c FROM nadlan_transactions").get() as { c: number }).c);
  const incYb = Number((inc.prepare("SELECT COUNT(*) c FROM nadlan_transactions WHERE year_built > 0").get() as { c: number }).c);
  const liveYb = Number((db.prepare("SELECT COUNT(*) c FROM nadlan_transactions WHERE year_built > 0").get() as { c: number }).c);

  console.log(`  ${"".padEnd(22)} ${"נכנס".padStart(12)} ${"חי".padStart(12)}`);
  console.log(`  ${"עסקאות".padEnd(22)} ${n(incCount).padStart(12)} ${n(liveCount).padStart(12)}`);
  console.log(`  ${"ערים".padEnd(22)} ${n(incCities).padStart(12)} ${n(liveCities).padStart(12)}`);
  console.log(`  ${"עם שנת בנייה".padEnd(22)} ${n(incYb).padStart(12)} ${n(liveYb).padStart(12)}\n`);

  // ── gates ────────────────────────────────────────────────────────────
  const refusals: string[] = [];
  if (incCount === 0) refusals.push("הקובץ הנכנס ריק");
  if (liveCount > 0) {
    const shrink = ((liveCount - incCount) / liveCount) * 100;
    if (shrink > MAX_SHRINK_PCT) {
      refusals.push(`${shrink.toFixed(1)}% פחות עסקאות מהחי (מגבלה ${MAX_SHRINK_PCT}%)`);
    }
  }
  if (incCities < liveCities) {
    refusals.push(`${liveCities - incCities} ערים פחות מהחי — איסוף חלקי`);
  }

  if (refusals.length && !force) {
    console.error("✗ מסרב למזג:");
    for (const r of refusals) console.error(`    · ${r}`);
    console.error("\n  המסד החי לא נגע. אם זה מכוון — הרץ שוב עם --force.");
    inc.close(); db.close();
    process.exit(2);
  }
  if (refusals.length) {
    console.error("⚠ --force נתון; ממזג למרות:");
    for (const r of refusals) console.error(`    · ${r}`);
  }

  if (dry) {
    console.log("(DRY RUN) — לא נכתב דבר.");
    inc.close(); db.close();
    return;
  }

  // ── merge ────────────────────────────────────────────────────────────
  inc.close();
  db.exec(`ATTACH DATABASE '${incomingPath.replace(/'/g, "''")}' AS src`);

  const merge = db.transaction(() => {
    for (const table of TABLES) {
      const srcHas = !!db.prepare("SELECT 1 FROM src.sqlite_master WHERE type='table' AND name=?").get(table);
      if (!srcHas) { console.log(`  ${table}: אין בקובץ הנכנס — מדלג`); continue; }
      if (!tableExists(db, table)) { console.log(`  ${table}: אין בחי — מדלג`); continue; }

      // Column sets drift: several columns (class_source, rooms_effective,
      // hok_hamecher) are added at run time by the cleaning scripts rather than
      // declared in the schema, so the two files rarely match exactly. Copying
      // the intersection moves everything both sides understand and silently
      // drops nothing the destination could have stored.
      const shared = columnsOf(db, table).filter((c) => columnsOf(db, table, "src").includes(c));
      if (!shared.length) { console.log(`  ${table}: אין עמודות משותפות — מדלג`); continue; }

      const cols = shared.map((c) => `"${c}"`).join(",");
      db.prepare(`DELETE FROM main.${table}`).run();
      const r = db.prepare(`INSERT INTO main.${table} (${cols}) SELECT ${cols} FROM src.${table}`).run();
      console.log(`  ${table}: ${n(r.changes)} שורות · ${shared.length} עמודות`);
    }
  });

  try {
    merge();
  } catch (e) {
    // One transaction: a failure here leaves the live tables exactly as they
    // were, which is the whole point of not doing this table by table.
    console.error(`\n✗ המיזוג נכשל וגולגל לאחור: ${e instanceof Error ? e.message : e}`);
    console.error("  המסד החי לא השתנה.");
    db.exec("DETACH DATABASE src");
    db.close();
    process.exit(1);
  }

  db.exec("DETACH DATABASE src");
  const after = Number((db.prepare("SELECT COUNT(*) c FROM nadlan_transactions").get() as { c: number }).c);
  db.close();

  console.log(`\n✓ מוזג — ${n(after)} עסקאות במסד החי.`);
  console.log(`\n  השלב הבא, וחובה: הרץ את הצינור כדי לנקות ולחשב מחדש —`);
  console.log(`    systemctl start karnaf-pipeline.service`);
  console.log(`  עד שהוא ירוץ, טבלת הסטטיסטיקה עדיין משקפת את הנתונים הקודמים.`);
}

main();
