import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  getTask,
  moveTask,
  claimTask,
  completeTask,
  failTask,
  getTaskHistory,
  updateTask,
  deleteTask,
} from '@openlares/db';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const task = getTask(db, id);
  if (!task) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const history = getTaskHistory(db, id);
  return NextResponse.json({ ...task, history });
}

/**
 * PATCH /api/tasks/:id — task actions
 *
 * Actions:
 *   { action: "move", toQueueId, actor, note? }
 *   { action: "claim", agentId, sessionKey }
 *   { action: "complete" }
 *   { action: "fail" }
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const db = getDb();

  switch (body.action) {
    case 'move': {
      if (!body.toQueueId || !body.actor) {
        return NextResponse.json({ error: 'toQueueId and actor are required' }, { status: 400 });
      }
      const result = moveTask(
        db,
        id,
        String(body.toQueueId),
        String(body.actor),
        body.note ? String(body.note) : undefined,
      );
      if (!result) {
        return NextResponse.json({ error: 'invalid transition' }, { status: 422 });
      }
      return NextResponse.json(result);
    }

    case 'claim': {
      if (!body.agentId || !body.sessionKey) {
        return NextResponse.json({ error: 'agentId and sessionKey are required' }, { status: 400 });
      }
      const result = claimTask(db, id, String(body.agentId), String(body.sessionKey));
      if (!result) {
        return NextResponse.json({ error: 'task not claimable' }, { status: 422 });
      }
      return NextResponse.json(result);
    }

    case 'complete': {
      const result = completeTask(db, id);
      if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 });
      return NextResponse.json(result);
    }

    case 'fail': {
      const result = failTask(db, id);
      if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 });
      return NextResponse.json(result);
    }

    case 'update': {
      const result = updateTask(db, id, {
        title: body.title ? String(body.title) : undefined,
        description: body.description !== undefined ? String(body.description) : undefined,
        priority: typeof body.priority === 'number' ? body.priority : undefined,
      });
      if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 });
      return NextResponse.json(result);
    }

    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();
  const deleted = deleteTask(db, id);
  if (!deleted) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
