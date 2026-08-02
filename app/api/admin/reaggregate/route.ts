import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { spawn } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";

/** "החל שינויים על האתר" — reruns the whole classification pipeline, then aggregates.
 *
 *  Aggregation alone was not enough: the flag scripts are what turn a dashboard
 *  rule into `excluded` / `luxury` marks, so editing a rule did nothing visible
 *  until the nightly run. Order matters — duplicates leave first so the anomaly
 *  and luxury cohort medians aren't computed on double-counted prices. */
let running = false;

const PIPELINE: Array<[string, string]> = [
  ["scripts/flag-duplicate-deals.ts", "כפילויות דיווח"],
  ["scripts/flag-outlier-deals.ts", "אנומליות מחיר"],
  ["scripts/flag-luxury-deals.ts", "עסקאות יוקרה"],
  ["scripts/aggregate-nadlan-transactions.ts", "אגרגציה"],
];

function runScript(script: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("npx", ["tsx", script], { cwd: process.cwd(), env: process.env });
    let buf = "";
    p.stdout.on("data", (d) => (buf += d));
    p.stderr.on("data", (d) => (buf += d));
    const timer = setTimeout(() => { p.kill(); reject(new Error(`${script}: timeout`)); }, timeoutMs);
    p.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(buf) : reject(new Error(`${script}: ${buf.slice(-400)}`));
    });
  });
}

export async function POST() {
  if (!isAdminRequest()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (running) return NextResponse.json({ error: "already-running" }, { status: 409 });
  running = true;
  try {
    const steps: Array<{ step: string; summary: string }> = [];
    let last = "";
    for (const [script, label] of PIPELINE) {
      last = await runScript(script, 600_000);
      steps.push({ step: label, summary: last.trim().split("\n").slice(-1)[0]?.slice(0, 160) ?? "" });
    }
    const m = last.match(/wrote (\d+) stat rows across (\d+) cities/);
    return NextResponse.json({ ok: true, steps, statRows: m ? Number(m[1]) : null, cities: m ? Number(m[2]) : null });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }, { status: 500 });
  } finally {
    running = false;
  }
}
