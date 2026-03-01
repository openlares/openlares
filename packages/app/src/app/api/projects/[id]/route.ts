import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getProject, updateProject } from '@openlares/db';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const project = getProject(db, id);
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(project);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;
  const db = getDb();

  const updated = updateProject(db, id, {
    name: typeof body.name === 'string' ? body.name : undefined,
    config:
      body.config != null
        ? (body.config as Parameters<typeof updateProject>[2]['config'])
        : undefined,
    pinned: typeof body.pinned === 'boolean' ? body.pinned : undefined,
  });

  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(updated);
}
