import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listProjects, createProject } from '@openlares/db';

export async function GET() {
  const db = getDb();
  return NextResponse.json(listProjects(db));
}

export async function POST(request: Request) {
  const body = (await request.json()) as { name?: string };
  if (!body.name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const db = getDb();
  const dashboard = createProject(db, { name: body.name });
  return NextResponse.json(dashboard, { status: 201 });
}
