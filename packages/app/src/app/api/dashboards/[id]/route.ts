import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getProject, updateProject } from '@openlares/db';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const dashboard = getProject(db, id);
  if (!dashboard) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(dashboard);
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
  });

  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(updated);
}
