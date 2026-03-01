import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { emit } from '@/lib/task-events';
import { listProjectTasks, createTask } from '@openlares/db';
import type { Task } from '@/components/tasks/types';

/** Convert Drizzle task row (Date fields) to client-safe JSON (number ms). */
function serializeTask(raw: {
  id: string;
  projectId: string;
  queueId: string;
  title: string;
  description: string | null;
  priority: number;
  sessionKey: string | null;
  assignedAgent: string | null;
  error: string | null;
  errorAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Task {
  return {
    ...raw,
    errorAt: raw.errorAt?.getTime() ?? null,
    createdAt: raw.createdAt.getTime(),
    updatedAt: raw.updatedAt.getTime(),
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  return NextResponse.json(listProjectTasks(db, id).map(serializeTask));
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
    projectId: id,
    queueId: body.queueId,
    title: body.title,
    description: body.description,
    priority: body.priority,
  });
  emit({ type: 'task:created', taskId: task.id, timestamp: Date.now() });
  return NextResponse.json(serializeTask(task), { status: 201 });
}
