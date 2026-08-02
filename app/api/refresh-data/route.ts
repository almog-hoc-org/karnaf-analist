/**
 * POST /api/refresh-data — starts (or re-attaches to) the background scan and
 * streams its event buffer as SSE. The scan itself runs in lib/refresh-runner
 * and SURVIVES client disconnects — closing the tab no longer kills it, and
 * the route's own duration limit no longer caps the scan.
 *
 * No cooldown (user directive: EVERY click must scan). Single-flight only —
 * a click while a scan runs simply attaches to the live progress.
 */
import { getRefreshJob, startRefreshJob } from "@/lib/refresh-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60; // caps the SSE attachment only, not the scan

export async function POST() {
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
