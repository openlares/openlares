import { getExecutorStatus } from '@/lib/task-executor';
import { subscribe, type TaskEvent } from '@/lib/task-events';

export const dynamic = 'force-dynamic';

/**
 * GET /api/executor/events
 *
 * Server-Sent Events stream. Sends:
 * - An initial `status` event with current executor state
 * - A `task:*` or `executor:*` event on any task/executor change
 * - A heartbeat comment (`: heartbeat`) every 30s to keep the connection alive
 */
export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Helper: enqueue a data frame, ignore if stream is already closed
      function send(payload: string) {
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Stream already closed — nothing to do
        }
      }

      // Send initial executor status so the client can hydrate immediately
      const status = getExecutorStatus();
      send(`data: ${JSON.stringify({ type: 'status', ...status })}\n\n`);

      // Subscribe to future events
      const unsub = subscribe((event: TaskEvent) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
      });

      // Heartbeat to keep connection alive through proxies / load balancers
      const heartbeat = setInterval(() => {
        send(': heartbeat\n\n');
      }, 30_000);

      // Cleanup when the client disconnects
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        unsub();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
