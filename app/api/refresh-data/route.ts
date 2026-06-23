/**
 * POST /api/refresh-data — streams Server-Sent Events as the refresh job runs.
 *
 * Client usage:
 *   const res = await fetch('/api/refresh-data', { method: 'POST' });
 *   const reader = res.body!.getReader();
 *   // consume SSE lines from reader
 */
import { refreshDataStream } from "@/lib/data-refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Allow long-running refresh
export const maxDuration = 60;

export async function POST() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const gen = refreshDataStream();
        for await (const event of gen) {
          send(event);
        }
      } catch (err) {
        send({
          type: "error",
          message: `שגיאה כללית: ${err instanceof Error ? err.message : String(err)}`,
        });
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
