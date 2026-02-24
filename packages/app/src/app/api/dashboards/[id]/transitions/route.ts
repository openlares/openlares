import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { createTransition, listTransitions } from '@openlares/db';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  return NextResponse.json(listTransitions(db, id));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: _dashboardId } = await params;
  const body = (await request.json()) as {
    fromQueueId?: string;
    toQueueId?: string;
    actorType?: 'human' | 'assistant' | 'both';
    conditions?: Record<string, unknown> | null;
    autoTrigger?: boolean;
  };

  if (!body.fromQueueId || !body.toQueueId || !body.actorType) {
    return NextResponse.json(
      { error: 'fromQueueId, toQueueId, and actorType are required' },
      { status: 400 },
    );
  }

  const db = getDb();
  const transition = createTransition(db, {
    fromQueueId: body.fromQueueId,
    toQueueId: body.toQueueId,
    actorType: body.actorType,
    conditions: body.conditions,
    autoTrigger: body.autoTrigger,
  });

  return NextResponse.json(transition, { status: 201 });
}
