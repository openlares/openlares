import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { deleteQueue, getQueue, updateQueue } from '@openlares/db';
import { emit } from '@/lib/task-events';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const queue = getQueue(db, id);
  if (!queue) {
    return NextResponse.json({ error: 'Queue not found' }, { status: 404 });
  }

  const deleted = deleteQueue(db, id);
  if (!deleted) {
    // Could be: has tasks, or last queue in dashboard
    return NextResponse.json(
      { error: 'Cannot delete queue — it either has tasks or is the last queue in this dashboard' },
      { status: 400 },
    );
  }

  emit({
    type: 'task:updated',
    data: { queueId: id, action: 'queue:deleted' },
    timestamp: Date.now(),
  });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as { description?: string | null };

  const db = getDb();
  const queue = getQueue(db, id);
  if (!queue) {
    return NextResponse.json({ error: 'Queue not found' }, { status: 404 });
  }

  const updated = updateQueue(db, id, { description: body.description });
  if (!updated) {
    return NextResponse.json({ error: 'Failed to update queue' }, { status: 500 });
  }

  return NextResponse.json({
    ...updated,
    createdAt: updated.createdAt.getTime(),
    updatedAt: updated.updatedAt.getTime(),
  });
}
