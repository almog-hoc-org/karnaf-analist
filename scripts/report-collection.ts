#!/usr/bin/env tsx
/**
 * The last nightly collection, source by source — read only.
 *
 * Printed in the deploy log so "why was X skipped" is answerable without a
 * shell on the host: on 3.10.2026 import-updates and import-yad2 fell to the
 * 100-minute deadline, and only per-source start times and durations showed
 * that the Overpass budgets and the register promotion had used the night.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DB = path.join(process.cwd(), "data", "app.db");

function main() {
  if (!fs.existsSync(DB)) { console.log("   אין app.db"); return; }
  const db = new Database(DB, { readonly: true, fileMustExist: true });
  const run = db.prepare(`SELECT id, started_at, finished_at, status FROM collection_runs
      WHERE trigger = 'nightly' ORDER BY id DESC LIMIT 1`).get() as
    { id: number; started_at: string; finished_at: string | null; status: string } | undefined;
  if (!run) { console.log("   עוד לא נרשמה ריצה לילית"); return; }
  const mins = (a: string, b: string | null) => (b ? ((Date.parse(b) - Date.parse(a)) / 60_000).toFixed(0) : "—");
  console.log(`   ריצה #${run.id} · ${run.started_at.slice(0, 16).replace("T", " ")} · ${run.status} · ${mins(run.started_at, run.finished_at)} דק׳`);
  const rows = db.prepare(`SELECT source, status, started_at, duration_ms, note FROM collection_source_runs
      WHERE run_id = ? ORDER BY id`).all(run.id) as Array<{ source: string; status: string; started_at: string; duration_ms: number | null; note: string | null }>;
  for (const r of rows) {
    const d = r.duration_ms != null ? `${(r.duration_ms / 60_000).toFixed(1)} דק׳` : "";
    console.log(`   ${r.started_at.slice(11, 16)}  ${r.source.padEnd(20)} ${r.status.padEnd(20)} ${d}${r.status !== "ok" && r.note ? ` · ${r.note.slice(0, 80)}` : ""}`);
  }
}

try { main(); } catch (e) { console.log(`   ⚠ הדוח נכשל: ${e instanceof Error ? e.message : String(e)}`); }
