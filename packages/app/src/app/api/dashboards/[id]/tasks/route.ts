import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listDashboardTasks, createTask } from '@openlares/db';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  return NextResponse.json(listDashboardTasks(db, id));
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
  return NextResponse.json(task, { status: 201 });
}
