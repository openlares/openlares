import { vi, beforeEach, describe, it, expect } from 'vitest';
import { createDb, seedDefaultProject, listQueues, createTask } from '@openlares/db';
import type { OpenlareDb } from '@openlares/db';

// --- DB mock ---
let testDb: OpenlareDb;
vi.mock('@/lib/db', () => ({ getDb: () => testDb }));
vi.mock('@/lib/task-events', () => ({ emit: vi.fn() }));

import { GET as listCommentsRoute, POST as addCommentRoute } from '../tasks/[id]/comments/route';

let projectId: string;
let todoQueueId: string;

beforeEach(() => {
  testDb = createDb(':memory:');
  const dashboard = seedDefaultProject(testDb)!;
  projectId = dashboard.id;
  const queues = listQueues(testDb, projectId);
  todoQueueId = queues.find((q) => q.name === 'Todo')!.id;
});

// ---------------------------------------------------------------------------
// GET /api/tasks/[id]/comments
// ---------------------------------------------------------------------------
describe('GET /api/tasks/[id]/comments', () => {
  it('returns an empty list for a new task', async () => {
    const task = createTask(testDb, { projectId, queueId: todoQueueId, title: 'Commented task' });
    const req = new Request(`http://localhost/api/tasks/${task.id}/comments`);
    const res = await listCommentsRoute(req, { params: Promise.resolve({ id: task.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });

  it('returns 404 when task does not exist', async () => {
    const req = new Request('http://localhost/api/tasks/nope/comments');
    const res = await listCommentsRoute(req, { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks/[id]/comments
// ---------------------------------------------------------------------------
describe('POST /api/tasks/[id]/comments', () => {
  it('adds a comment to a task with 201 status', async () => {
    const task = createTask(testDb, { projectId, queueId: todoQueueId, title: 'Task' });
    const req = new Request(`http://localhost/api/tasks/${task.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Great progress!' }),
    });
    const res = await addCommentRoute(req, { params: Promise.resolve({ id: task.id }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toHaveProperty('content', 'Great progress!');
    expect(data).toHaveProperty('id');
    expect(data).toHaveProperty('taskId', task.id);
    expect(typeof data.createdAt).toBe('number');
  });

  it('returns 400 when content is empty', async () => {
    const task = createTask(testDb, { projectId, queueId: todoQueueId, title: 'Task' });
    const req = new Request(`http://localhost/api/tasks/${task.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '   ' }),
    });
    const res = await addCommentRoute(req, { params: Promise.resolve({ id: task.id }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when content is missing', async () => {
    const task = createTask(testDb, { projectId, queueId: todoQueueId, title: 'Task' });
    const req = new Request(`http://localhost/api/tasks/${task.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await addCommentRoute(req, { params: Promise.resolve({ id: task.id }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 when task does not exist', async () => {
    const req = new Request('http://localhost/api/tasks/nope/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Hello' }),
    });
    const res = await addCommentRoute(req, { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });
});
