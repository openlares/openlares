import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { deleteQueueTemplate } from '@openlares/db';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const deleted = deleteQueueTemplate(db, id);
  if (!deleted) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
