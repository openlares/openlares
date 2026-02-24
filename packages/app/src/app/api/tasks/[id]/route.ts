import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  getTask,
  moveTask,
  claimTask,
  completeTask,
  failTask,
  updateTask,
  deleteTask,
  getTaskHistory,
} from '@openlares/db';
import type { Task } from '@/components/tasks/types';

/** Convert Drizzle task row (Date fields) to client-safe JSON (number ms). */
function serializeTask(raw: {
  id: string;
  dashboardId: string;
  queueId: string;
  title: string;
  description: string | null;
  priority: number;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  sessionKey: string | null;
  assignedAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}): Task {
  return {
    ...raw,
    createdAt: raw.createdAt.getTime(),
    updatedAt: raw.updatedAt.getTime(),
    completedAt: raw.completedAt?.getTime() ?? null,
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const task = getTask(db, id);
  if (!task) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const history = getTaskHistory(db, id);
  return NextResponse.json({ ...serializeTask(task), history });
}

/**
 * PATCH /api/tasks/:id — task actions
 *
 * Actions:
 *   { action: "move", toQueueId, actor, note? }
 *   { action: "claim", agentId, sessionKey }
 *   { action: "complete" }
 *   { action: "fail" }
 *   { action: "update", title?, description?, priority? }
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
      return NextResponse.json(serializeTask(result));
    }

    case 'claim': {
      if (!body.agentId || !body.sessionKey) {
        return NextResponse.json({ error: 'agentId and sessionKey are required' }, { status: 400 });
      }
      const result = claimTask(db, id, String(body.agentId), String(body.sessionKey));
      if (!result) {
        return NextResponse.json({ error: 'task not claimable' }, { status: 422 });
      }
      return NextResponse.json(serializeTask(result));
    }

    case 'complete': {
      const result = completeTask(db, id);
      if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 });
      return NextResponse.json(serializeTask(result));
    }

    case 'fail': {
      const result = failTask(db, id);
      if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 });
      return NextResponse.json(serializeTask(result));
    }

    case 'update': {
      const result = updateTask(db, id, {
        title: body.title ? String(body.title) : undefined,
        description: body.description !== undefined ? String(body.description) : undefined,
        priority: typeof body.priority === 'number' ? body.priority : undefined,
      });
      if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 });
      return NextResponse.json(serializeTask(result));
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
