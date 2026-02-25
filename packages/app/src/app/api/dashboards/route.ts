import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listDashboards, createDashboard } from '@openlares/db';

export async function GET() {
  const db = getDb();
  return NextResponse.json(listDashboards(db));
}

export async function POST(request: Request) {
  const body = (await request.json()) as { name?: string };
  if (!body.name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const db = getDb();
  const dashboard = createDashboard(db, { name: body.name });
  return NextResponse.json(dashboard, { status: 201 });
}
