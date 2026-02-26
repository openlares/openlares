import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { deleteTransition } from '@openlares/db';
import { emit } from '@/lib/task-events';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const deleted = deleteTransition(db, id);
  if (!deleted) {
    return NextResponse.json({ error: 'Transition not found' }, { status: 404 });
  }

  emit({
    type: 'task:updated',
    data: { transitionId: id, action: 'transition:deleted' },
    timestamp: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
