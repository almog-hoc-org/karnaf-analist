#!/usr/bin/env tsx
/**
 * Run the full cleaning + aggregation pipeline, in order, with a run log.
 *
 * WHY THIS SCRIPT EXISTS
 * Nothing in the repo ran the pipeline end to end. The order existed as prose in
 * README.md ("the order is critical; each step assumes the previous finished")
 * and in each script's header comment, but the only executable copy was a
 * shorter, drifted list inside the admin API route. The two shell refresh
 * scripts (biweekly, monthly) run imports and no cleaning stages at all.
 *
 * That is the gap this closes: one command, the documented order, gates that
 * actually block, and a record of what ran.
 *
 * USAGE
 *   npx tsx scripts/pipeline.ts                 full run, gates enforced
 *   npx tsx scripts/pipeline.ts --from=outliers resume after a failure
 *   npx tsx scripts/pipeline.ts --skip-gates    mutations only (what the admin button does)
 *   npx tsx scripts/pipeline.ts --dry-run       print the plan and exit
 *   npx tsx scripts/pipeline.ts --list          show stage ids and why each sits where it does
 *
 * AFTER A SUCCESSFUL RUN it pings /api/revalidate so a live server drops its
 * cached query results. Set REVALIDATE_URL and REVALIDATE_TOKEN to enable;
 * without them the run still succeeds and simply says the ping was skipped.
 *
 * EXIT CODES: 0 success · 1 a stage failed · 2 a verification gate failed.
 * The distinction matters for alerting: a gate failure means the data is
 * suspect, not that the machine broke.
 */
import { spawn } from "child_process";
import Database from "better-sqlite3";
import path from "path";
import { PIPELINE, STAGE_IDS, stagesFrom, type PipelineStage } from "../lib/pipeline";

const APP_DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "app.db");

/** Run-history table. Nothing recorded pipeline runs before this. */
function ensureRunLog(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at DATETIME NOT NULL,
      finished_at DATETIME,
      status TEXT NOT NULL,              -- running | ok | failed | gate-failed
      stages_run TEXT,                   -- comma-separated stage ids that completed
      failed_stage TEXT,
      error TEXT,
      trigger TEXT NOT NULL DEFAULT 'cli'
    );
    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started ON pipeline_runs(started_at DESC);
  `);
}

function runStage(stage: PipelineStage): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("npx", ["tsx", stage.script], { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    const onData = (d: Buffer) => { const s = d.toString(); buf += s; process.stdout.write(s); };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    const timer = setTimeout(() => { p.kill("SIGTERM"); reject(new Error(`timeout after ${stage.timeoutMs / 60000}min`)); }, stage.timeoutMs);
    p.on("close", (code) => {
      clearTimeout(timer);
      // NOTE: verify-anomalies.ts sets process.exitCode rather than calling
      // process.exit(), so its status only materialises on natural termination.
      // Reading the close code here handles both correctly.
      if (code === 0) {
        resolve(buf);
      } else {
        reject(new Error(`exit ${code}: ${buf.trim().split("\n").slice(-3).join(" | ").slice(0, 300)}`));
      }
    });
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

async function pingRevalidate(): Promise<string> {
  const url = process.env.REVALIDATE_URL;
  const token = process.env.REVALIDATE_TOKEN;
  if (!url || !token) return "skipped (REVALIDATE_URL / REVALIDATE_TOKEN not set)";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? "ok" : `HTTP ${res.status}`;
  } catch (e) {
    return `failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const has = (f: string) => argv.includes(`--${f}`);
  const val = (f: string) => argv.find((a) => a.startsWith(`--${f}=`))?.split("=")[1];

  if (has("list")) {
    console.log("pipeline stages, in execution order:\n");
    for (const [i, s] of PIPELINE.entries()) {
      console.log(`${String(i + 1).padStart(2)}. ${s.id.padEnd(16)} ${s.gate ? "[GATE] " : "       "}${s.label}`);
      console.log(`    ${s.script}`);
      console.log(`    ${s.why}\n`);
    }
    return;
  }

  let stages: PipelineStage[];
  try {
    stages = stagesFrom(val("from"));
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  if (has("skip-gates")) stages = stages.filter((s) => !s.gate);

  if (has("dry-run")) {
    console.log(`would run ${stages.length} stages:`);
    for (const s of stages) console.log(`  ${s.id.padEnd(16)} ${s.gate ? "[GATE] " : ""}${s.script}`);
    return;
  }

  const db = new Database(APP_DB);
  db.pragma("journal_mode = WAL");
  ensureRunLog(db);

  const startedAt = new Date().toISOString();
  const runId = Number(
    db.prepare("INSERT INTO pipeline_runs (started_at, status, trigger) VALUES (?, 'running', ?)")
      .run(startedAt, val("trigger") ?? "cli").lastInsertRowid
  );

  const done: string[] = [];
  const t0 = Date.now();
  console.log(`▶ pipeline run #${runId} — ${stages.length} stages\n`);

  for (const [i, stage] of stages.entries()) {
    const label = `[${i + 1}/${stages.length}] ${stage.id}`;
    console.log(`\n${"─".repeat(60)}\n${label}  ${stage.gate ? "(gate) " : ""}${stage.script}\n${"─".repeat(60)}`);
    const s0 = Date.now();
    try {
      await runStage(stage);
      done.push(stage.id);
      console.log(`✓ ${stage.id} — ${((Date.now() - s0) / 1000).toFixed(1)}s`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = stage.gate ? "gate-failed" : "failed";
      db.prepare("UPDATE pipeline_runs SET finished_at=?, status=?, stages_run=?, failed_stage=?, error=? WHERE id=?")
        .run(new Date().toISOString(), status, done.join(","), stage.id, msg.slice(0, 1000), runId);
      console.error(`\n✗ ${stage.id} failed: ${msg}`);
      console.error(`\nresume with: npx tsx scripts/pipeline.ts --from=${stage.id}`);
      if (stage.gate) {
        console.error("\n⚠ THIS WAS A VERIFICATION GATE. The data was written but does NOT pass its own checks.");
        console.error("  Investigate before letting it reach the site — do not just re-run.");
      }
      db.close();
      process.exit(stage.gate ? 2 : 1);
    }
  }

  const revalidate = await pingRevalidate();
  db.prepare("UPDATE pipeline_runs SET finished_at=?, status='ok', stages_run=? WHERE id=?")
    .run(new Date().toISOString(), done.join(","), runId);
  db.close();

  console.log(`\n${"═".repeat(60)}`);
  console.log(`✓ pipeline run #${runId} complete — ${done.length} stages in ${((Date.now() - t0) / 60000).toFixed(1)}min`);
  console.log(`  cache revalidation: ${revalidate}`);
  console.log(`${"═".repeat(60)}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});

// referenced in the --from error message
void STAGE_IDS;
