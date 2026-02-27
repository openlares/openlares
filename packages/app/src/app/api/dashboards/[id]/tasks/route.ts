import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { emit } from '@/lib/task-events';
import { listDashboardTasks, createTask } from '@openlares/db';
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
  result: string | null;
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
  return NextResponse.json(listDashboardTasks(db, id).map(serializeTask));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as {
    queueId?: string;
    title?: string;
    description?: string;
    priority?: number;
  };

  if (!body.queueId || !body.title) {
    return NextResponse.json({ error: 'queueId and title are required' }, { status: 400 });
  }

  const db = getDb();
  const task = createTask(db, {
    dashboardId: id,
    queueId: body.queueId,
    title: body.title,
    description: body.description,
    priority: body.priority,
  });
  emit({ type: 'task:created', taskId: task.id, timestamp: Date.now() });
  return NextResponse.json(serializeTask(task), { status: 201 });
}
