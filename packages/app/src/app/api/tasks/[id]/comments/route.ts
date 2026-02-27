import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { emit } from '@/lib/task-events';
import { listComments, addComment, getTask } from '@openlares/db';
import type { TaskComment } from '@/components/tasks/types';

/** Convert Drizzle comment row (Date fields) to client-safe JSON (number ms). */
function serializeComment(raw: {
  id: string;
  taskId: string;
  author: string;
  authorType: 'human' | 'agent';
  content: string;
  createdAt: Date;
}): TaskComment {
  return {
    ...raw,
    createdAt: raw.createdAt.getTime(),
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const task = getTask(db, id);
  if (!task) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const comments = listComments(db, id).map(serializeComment);
  return NextResponse.json(comments);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as { content?: string };

  if (!body.content || typeof body.content !== 'string' || !body.content.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  const db = getDb();

  const task = getTask(db, id);
  if (!task) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const comment = addComment(db, id, 'human', 'human', body.content.trim());
  emit({ type: 'task:comment', taskId: id, timestamp: Date.now() });

  return NextResponse.json(serializeComment(comment), { status: 201 });
}
