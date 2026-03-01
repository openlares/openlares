import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { assignAgent, removeAgent, listProjectAgents } from '@openlares/db';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const agents = listProjectAgents(db, id);
  return NextResponse.json(agents);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { agentId?: string };
  if (!body.agentId) {
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
  }
  const db = getDb();
  assignAgent(db, id, body.agentId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { agentId?: string };
  if (!body.agentId) {
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
  }
  const db = getDb();
  const removed = removeAgent(db, id, body.agentId);
  if (!removed) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
