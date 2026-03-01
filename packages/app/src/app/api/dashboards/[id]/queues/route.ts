import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listQueues, createQueue, listTransitions, updateQueuePositions } from '@openlares/db';
import type { Queue, Transition } from '@/components/tasks/types';

/** Serialize Drizzle queue row to client-safe JSON. */
function serializeQueue(raw: {
  id: string;
  projectId: string;
  name: string;
  ownerType: 'human' | 'assistant';
  description: string | null;
  position: number;
  agentLimit: number;
  createdAt: Date;
  updatedAt: Date;
}): Queue {
  return {
    ...raw,
    createdAt: raw.createdAt.getTime(),
    updatedAt: raw.updatedAt.getTime(),
  };
}

/** Serialize Drizzle transition row to client-safe JSON. */
function serializeTransition(raw: {
  id: string;
  fromQueueId: string;
  toQueueId: string;
  actorType: 'human' | 'assistant' | 'both';
  conditions: unknown;
  autoTrigger: boolean | number;
  createdAt: Date;
}): Transition {
  return {
    ...raw,
    autoTrigger: Boolean(raw.autoTrigger),
    conditions: (raw.conditions as Record<string, unknown>) ?? null,
    createdAt: raw.createdAt.getTime(),
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const queueList = listQueues(db, id);
  const transitionList = listTransitions(db, id);
  return NextResponse.json({
    queues: queueList.map(serializeQueue),
    transitions: transitionList.map(serializeTransition),
  });
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
    projectId: id,
    name: body.name,
    ownerType: body.ownerType,
    description: body.description,
    position: body.position,
    agentLimit: body.agentLimit,
  });
  return NextResponse.json(serializeQueue(queue), { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: _dashboardId } = await params;
  const body = (await request.json()) as { positions?: Array<{ id: string; position: number }> };

  if (!Array.isArray(body.positions)) {
    return NextResponse.json({ error: 'positions array required' }, { status: 400 });
  }

  const db = getDb();
  updateQueuePositions(db, body.positions);
  return NextResponse.json({ ok: true });
}
