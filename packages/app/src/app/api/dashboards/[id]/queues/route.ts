import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listQueues, createQueue, listTransitions } from '@openlares/db';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const queueList = listQueues(db, id);
  const transitionList = listTransitions(db, id);
  return NextResponse.json({ queues: queueList, transitions: transitionList });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as {
    name?: string;
    ownerType?: 'human' | 'assistant';
    description?: string;
    position?: number;
    agentLimit?: number;
  };

  if (!body.name || !body.ownerType) {
    return NextResponse.json({ error: 'name and ownerType are required' }, { status: 400 });
  }

  const db = getDb();
  const queue = createQueue(db, {
    dashboardId: id,
    name: body.name,
    ownerType: body.ownerType,
    description: body.description,
    position: body.position,
    agentLimit: body.agentLimit,
  });
  return NextResponse.json(queue, { status: 201 });
}
