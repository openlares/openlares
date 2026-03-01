import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listQueueTemplates, createQueueTemplate } from '@openlares/db';
import type { QueueTemplateEntry } from '@openlares/db';

export async function GET() {
  const db = getDb();
  return NextResponse.json(listQueueTemplates(db));
}

export async function POST(req: Request) {
  const body = (await req.json()) as { name?: string; entries?: QueueTemplateEntry[] };
  if (!body.name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!Array.isArray(body.entries)) {
    return NextResponse.json({ error: 'entries must be an array' }, { status: 400 });
  }
  const db = getDb();
  const template = createQueueTemplate(db, { name: body.name, entries: body.entries });
  return NextResponse.json(template, { status: 201 });
}
