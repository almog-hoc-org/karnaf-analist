#!/usr/bin/env tsx
/**
 * Run the data COLLECTION sources, isolated from one another, with a run log.
 *
 * Companion to scripts/pipeline.ts. That one cleans and aggregates what is
 * already here; this one is what brings anything new in. Until this existed the
 * nightly timer re-derived a frozen snapshot every night — see lib/collectors.ts
 * for why that happened and what it cost.
 *
 *   npx tsx scripts/collect.ts                        every source
 *   npx tsx scripts/collect.ts --only=govmap          one source
 *   npx tsx scripts/collect.ts --skip=prefetch-deals  all but one
 *   npx tsx scripts/collect.ts --probe-only           reachability report, collect nothing
 *   npx tsx scripts/collect.ts --dry-run              print the plan and exit
 *   npx tsx scripts/collect.ts --list                 what each source brings in, and why
 *   npx tsx scripts/collect.ts --deadline=75          stop starting sources after N minutes
 *
 * DEADLINE. The cleaning pipeline runs at 02:30 and rewrites the stats table
 * inside one transaction. Collection writing to the same database while that
 * happens is not corruption — SQLite serialises it — but it does mean the
 * aggregation can measure a moving population. The deadline stops STARTING new
 * sources once the budget is spent, so the two never meet. A source already
 * running is allowed to finish; killing a collector mid-city is how you get a
 * half-collected city that looks complete to the manifest.
 *
 * EXIT CODES: 0 everything that could run did · 1 at least one source failed ·
 * 3 no probed host answered at all (a network or geo-blocking problem, which is
 * a different thing from a broken collector and is worth paging differently).
 */
import { spawn } from "child_process";
import Database from "better-sqlite3";
import path from "path";
import { SOURCES, SOURCE_IDS, selectSources, probeHosts, type CollectorSource } from "../lib/collectors";

const APP_DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "app.db");

function ensureRunLog(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at DATETIME NOT NULL,
      finished_at DATETIME,
      status TEXT NOT NULL,              -- running | ok | partial | failed | unreachable
      trigger TEXT NOT NULL DEFAULT 'cli',
      reachability TEXT                  -- host=code, comma separated
    );
    CREATE TABLE IF NOT EXISTS collection_source_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,              -- ok | failed | skipped-browser | skipped-deadline | skipped-unreachable
      started_at DATETIME NOT NULL,
      duration_ms INTEGER,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_collection_runs_started ON collection_runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_collection_source_runs_run ON collection_source_runs(run_id);
  `);
}

/**
 * One request per host. A 403 or a 301 still proves the host is reachable — the
 * question here is "does the network let us out and does the server answer",
 * not "is this specific path public".
 */
async function probe(host: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(host, { method: "GET", signal: AbortSignal.timeout(20_000), redirect: "manual" });
    return { ok: true, detail: `HTTP ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: msg.slice(0, 80) };
  }
}

function runSource(s: CollectorSource): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(s.cmd, s.args, { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const onData = (d: Buffer) => {
      const str = d.toString();
      process.stdout.write(str);
      // keep only the end: a collector can emit thousands of lines and the run
      // log only needs enough to tell what went wrong.
      tail = (tail + str).slice(-2000);
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    const timer = setTimeout(() => {
      p.kill("SIGTERM");
      reject(new Error(`timeout after ${Math.round(s.timeoutMs / 60000)}min`));
    }, s.timeoutMs);
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`exit ${code}: ${tail.trim().split("\n").slice(-3).join(" | ").slice(0, 300)}`));
    });
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const has = (f: string) => argv.includes(`--${f}`);
  const val = (f: string) => argv.find((a) => a.startsWith(`--${f}=`))?.split("=")[1];
  const list = (f: string) => val(f)?.split(",").map((x) => x.trim()).filter(Boolean);

  if (has("list")) {
    console.log("collection sources, in execution order:\n");
    for (const [i, s] of SOURCES.entries()) {
      console.log(`${String(i + 1).padStart(2)}. ${s.id.padEnd(22)}${s.requiresBrowser ? "[דורש דפדפן] " : ""}${s.label}`);
      console.log(`    ${s.cmd} ${s.args.join(" ")}`);
      console.log(`    ${s.host ?? "— אין רשת —"}`);
      console.log(`    ${s.why}\n`);
    }
    return;
  }

  let sources: CollectorSource[];
  try {
    sources = selectSources(list("only"), list("skip"));
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }

  if (has("dry-run")) {
    console.log(`would run ${sources.length} sources:`);
    for (const s of sources) console.log(`  ${s.id.padEnd(22)}${s.requiresBrowser ? "[דורש דפדפן] " : ""}${s.cmd} ${s.args.join(" ")}`);
    return;
  }

  // ── reachability ────────────────────────────────────────────────────────
  const hosts = probeHosts(sources);
  console.log(`▶ בדיקת נגישות — ${hosts.length} מארחים\n`);
  const reach = new Map<string, { ok: boolean; detail: string }>();
  for (const h of hosts) {
    const r = await probe(h);
    reach.set(h, r);
    console.log(`  ${r.ok ? "✓" : "✗"} ${h.padEnd(38)} ${r.detail}`);
  }
  const anyReachable = [...reach.values()].some((r) => r.ok);
  const reachSummary = [...reach.entries()].map(([h, r]) => `${new URL(h).host}=${r.ok ? r.detail : "FAIL"}`).join(", ");

  if (has("probe-only")) {
    console.log(`\n${anyReachable ? "✓ לפחות מארח אחד עונה" : "✗ אף מארח לא עונה"}`);
    process.exit(anyReachable ? 0 : 3);
  }

  if (!anyReachable && hosts.length > 0) {
    console.error("\n✗ אף מארח לא עונה. זו בעיית רשת או חסימה גיאוגרפית — לא באג בקולקטורים.");
    console.error("  הקולקטורים לא הורצו, כדי לא לרשום כישלונות שאין להם קשר לקוד.");
    // Still logged, so a run that found the network down leaves a trace.
    const db = new Database(APP_DB);
    db.pragma("journal_mode = WAL");
    ensureRunLog(db);
    db.prepare("INSERT INTO collection_runs (started_at, finished_at, status, trigger, reachability) VALUES (?,?,'unreachable',?,?)")
      .run(new Date().toISOString(), new Date().toISOString(), val("trigger") ?? "cli", reachSummary);
    db.close();
    process.exit(3);
  }

  // ── run ─────────────────────────────────────────────────────────────────
  const db = new Database(APP_DB);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 60000");
  ensureRunLog(db);

  const runId = Number(
    db.prepare("INSERT INTO collection_runs (started_at, status, trigger, reachability) VALUES (?,'running',?,?)")
      .run(new Date().toISOString(), val("trigger") ?? "cli", reachSummary).lastInsertRowid
  );

  const deadlineMin = Number(val("deadline") ?? 0);
  const deadlineAt = deadlineMin > 0 ? Date.now() + deadlineMin * 60_000 : Infinity;
  const chromeUrl = process.env.KARNAF_CHROME_URL;

  const record = (source: string, status: string, startedAt: string, ms: number, note?: string) =>
    db.prepare("INSERT INTO collection_source_runs (run_id, source, status, started_at, duration_ms, note) VALUES (?,?,?,?,?,?)")
      .run(runId, source, status, startedAt, ms, note?.slice(0, 1000) ?? null);

  let okCount = 0, failCount = 0, skipCount = 0;
  const t0 = Date.now();
  console.log(`\n▶ איסוף ריצה #${runId} — ${sources.length} מקורות${deadlineMin ? ` · תקציב ${deadlineMin} דק׳` : ""}\n`);

  for (const [i, s] of sources.entries()) {
    const head = `[${i + 1}/${sources.length}] ${s.id}`;
    const startedAt = new Date().toISOString();

    if (s.requiresBrowser && !chromeUrl) {
      console.log(`\n○ ${head} — דילוג: דורש Chrome (KARNAF_CHROME_URL לא מוגדר)`);
      console.log(`  ${s.why}`);
      record(s.id, "skipped-browser", startedAt, 0, "KARNAF_CHROME_URL not set");
      skipCount++;
      continue;
    }
    if (s.host && !reach.get(s.host)?.ok) {
      console.log(`\n○ ${head} — דילוג: ${new URL(s.host).host} לא נגיש`);
      record(s.id, "skipped-unreachable", startedAt, 0, reach.get(s.host)?.detail);
      skipCount++;
      continue;
    }
    if (Date.now() > deadlineAt) {
      console.log(`\n○ ${head} — דילוג: תקציב הזמן נגמר`);
      record(s.id, "skipped-deadline", startedAt, 0, `deadline ${deadlineMin}min`);
      skipCount++;
      continue;
    }

    console.log(`\n${"─".repeat(60)}\n${head}  ${s.label}\n${"─".repeat(60)}`);
    const s0 = Date.now();
    try {
      await runSource(s);
      const ms = Date.now() - s0;
      record(s.id, "ok", startedAt, ms);
      okCount++;
      console.log(`✓ ${s.id} — ${(ms / 1000).toFixed(1)}s`);
    } catch (e) {
      // Isolated on purpose: one government website being down must not cost us
      // every other source that night.
      const msg = e instanceof Error ? e.message : String(e);
      const ms = Date.now() - s0;
      record(s.id, "failed", startedAt, ms, msg);
      failCount++;
      console.error(`✗ ${s.id} נכשל אחרי ${(ms / 1000).toFixed(1)}s: ${msg}`);
      console.error(`  ממשיך למקור הבא.`);
    }
  }

  const status = failCount === 0 ? "ok" : okCount > 0 ? "partial" : "failed";
  db.prepare("UPDATE collection_runs SET finished_at=?, status=? WHERE id=?")
    .run(new Date().toISOString(), status, runId);
  db.close();

  console.log(`\n${"═".repeat(60)}`);
  console.log(`איסוף ריצה #${runId} — ${((Date.now() - t0) / 60000).toFixed(1)} דק׳`);
  console.log(`  הצליחו ${okCount} · נכשלו ${failCount} · דילגו ${skipCount}`);
  if (skipCount && !chromeUrl && sources.some((s) => s.requiresBrowser)) {
    console.log(`\n  ⚠ מקור nadlan דילג — הוא היחיד שמביא שנת בנייה וחוק מכר,`);
    console.log(`    ובלעדיו עסקאות חדשות נשארות ללא סיווג ומחוץ לסדרת "כללי".`);
  }
  console.log(`${"═".repeat(60)}`);

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});

// referenced in the --only/--skip error message
void SOURCE_IDS;
