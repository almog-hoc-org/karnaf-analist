/**
 * POST /api/refresh-data — starts (or re-attaches to) the background scan and
 * streams its event buffer as SSE. The scan itself runs in lib/refresh-runner
 * and SURVIVES client disconnects — closing the tab no longer kills it, and
 * the route's own duration limit no longer caps the scan.
 *
 * No cooldown (user directive: EVERY click must scan). Single-flight only —
 * a click while a scan runs simply attaches to the live progress.
 *
 * ADMIN ONLY. This was the one /api route without a gate, while the button that
 * calls it sits in the root layout on every page. Each call downloads PDFs from
 * CBS and gov.il, spawns python to parse them, and writes into public/reports
 * and data/ — real outbound traffic and real disk writes, triggerable by any
 * anonymous visitor. Single-flight capped the concurrency, not the exposure.
 */
import { NextResponse } from "next/server";
import { getRefreshJob, startRefreshJob } from "@/lib/refresh-runner";
import { isAdminRequest } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60; // caps the SSE attachment only, not the scan

export async function POST() {
  if (!isAdminRequest()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const started = startRefreshJob(); // false → already running, just attach
  const job = getRefreshJob();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      if (!started) {
        send({ type: "log", message: "⟳ סריקה כבר רצה ברקע — מתחבר להתקדמות החיה" });
      }
      try {
        let i = 0;
        // replay existing events, then follow until the job signals done
        for (;;) {
          while (i < job.events.length) {
            send(job.events[i]);
            if (job.events[i].type === "done") return;
            i++;
          }
          if (!job.running) { send({ type: "done", message: "done" }); return; }
          await new Promise((r) => setTimeout(r, 400));
        }
      } catch {
        // client disconnected — the background job keeps running
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
