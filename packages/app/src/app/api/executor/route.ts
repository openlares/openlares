import { NextResponse } from 'next/server';
import {
  getExecutorStatus,
  startExecutor,
  stopExecutor,
  configureGateway,
} from '@/lib/task-executor';

/**
 * GET /api/executor — current executor status
 */
export async function GET() {
  return NextResponse.json(getExecutorStatus());
}

/**
 * POST /api/executor — start/stop the executor
 *
 * Body: { action: "start", projectId, gatewayUrl?, gatewayToken? }
 *       { action: "stop" }
 */
export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;

  switch (body.action) {
    case 'start': {
      if (!body.projectId) {
        return NextResponse.json({ error: 'dashboardId is required' }, { status: 400 });
      }

      // Configure gateway if provided
      if (body.gatewayUrl && body.gatewayToken) {
        configureGateway({
          url: String(body.gatewayUrl),
          token: String(body.gatewayToken),
        });
      }

      startExecutor(String(body.projectId));
      return NextResponse.json({ ok: true, ...getExecutorStatus() });
    }

    case 'stop': {
      stopExecutor();
      return NextResponse.json({ ok: true, ...getExecutorStatus() });
    }

    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
}
