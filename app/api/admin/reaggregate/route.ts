import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { isAdminRequest } from "@/lib/adminAuth";
import { spawn } from "child_process";
import { mutationStages, type PipelineStage } from "@/lib/pipeline";
import { TAGS } from "@/lib/cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "החל שינויים על האתר" — reruns the cleaning pipeline, then aggregates.
 *
 * The stage list is NO LONGER DEFINED HERE. It lives in lib/pipeline.ts, shared
 * with scripts/pipeline.ts, because this route used to carry its own shorter
 * copy that had drifted from the documented order — it was missing
 * merge-cross-channel, reclassify-rooms-by-area and classify-sale-channel.
 * That made ten room-area rules inert and, worse, left `class_source` unwritten,
 * which silently excludes every newly collected deal from the site's main price
 * series. See lib/pipeline.ts for the full reasoning and the ordering fix.
 *
 * Verification gates are skipped here: this is an interactive button and the
 * gates add minutes. The scheduled run (scripts/pipeline.ts) runs them.
 */
let running = false;

function runScript(stage: PipelineStage): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("npx", ["tsx", stage.script], { cwd: process.cwd(), env: process.env });
    let buf = "";
    p.stdout.on("data", (d) => (buf += d));
    p.stderr.on("data", (d) => (buf += d));
    const timer = setTimeout(() => { p.kill(); reject(new Error(`${stage.script}: timeout`)); }, stage.timeoutMs);
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(buf);
      } else {
        reject(new Error(`${stage.script}: ${buf.slice(-400)}`));
      }
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
    for (const stage of mutationStages()) {
      last = await runScript(stage);
      steps.push({ step: stage.label, summary: last.trim().split("\n").slice(-1)[0]?.slice(0, 160) ?? "" });
    }

    // The data just changed underneath the cache. Without this the button would
    // rewrite the database and the site would keep serving the previous numbers
    // until a TTL expired — the exact failure this endpoint exists to prevent.
    for (const tag of Object.values(TAGS)) revalidateTag(tag);

    const m = last.match(/wrote (\d+) stat rows across (\d+) cities/);
    return NextResponse.json({ ok: true, steps, statRows: m ? Number(m[1]) : null, cities: m ? Number(m[2]) : null });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }, { status: 500 });
  } finally {
    running = false;
  }
}
