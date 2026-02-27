import { vi, beforeEach, describe, it, expect } from 'vitest';
import {
  createDb,
  seedDefaultDashboard,
  listDashboards,
  listQueues,
  createTask,
  setTaskError,
} from '@openlares/db';
import type { OpenlareDb } from '@openlares/db';

// --- DB mock ---
let testDb: OpenlareDb;
vi.mock('@/lib/db', () => ({ getDb: () => testDb }));
vi.mock('@/lib/task-events', () => ({ emit: vi.fn() }));

import { GET as listTasksRoute, POST as createTaskRoute } from '../dashboards/[id]/tasks/route';
import {
  GET as getTaskRoute,
  PATCH as patchTaskRoute,
  DELETE as deleteTaskRoute,
} from '../tasks/[id]/route';

let dashboardId: string;
let todoQueueId: string;
let inProgressQueueId: string;

beforeEach(() => {
  testDb = createDb(':memory:');
  const dashboard = seedDefaultDashboard(testDb)!;
  dashboardId = dashboard.id;
  const queues = listQueues(testDb, dashboardId);
  todoQueueId = queues.find((q) => q.name === 'Todo')!.id;
  inProgressQueueId = queues.find((q) => q.name === 'In Progress')!.id;
});

// ---------------------------------------------------------------------------
// GET /api/dashboards/[id]/tasks
// ---------------------------------------------------------------------------
describe('GET /api/dashboards/[id]/tasks', () => {
  it('returns an empty list when no tasks exist', async () => {
    const req = new Request(`http://localhost/api/dashboards/${dashboardId}/tasks`);
    const res = await listTasksRoute(req, { params: Promise.resolve({ id: dashboardId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });

  it('returns tasks after creating one', async () => {
    createTask(testDb, { dashboardId, queueId: todoQueueId, title: 'Existing task' });
    const req = new Request(`http://localhost/api/dashboards/${dashboardId}/tasks`);
    const res = await listTasksRoute(req, { params: Promise.resolve({ id: dashboardId }) });
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0]).toHaveProperty('title', 'Existing task');
  });
});

// ---------------------------------------------------------------------------
// POST /api/dashboards/[id]/tasks
// ---------------------------------------------------------------------------
describe('POST /api/dashboards/[id]/tasks', () => {
  it('creates a task with 201 status', async () => {
    const req = new Request(`http://localhost/api/dashboards/${dashboardId}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queueId: todoQueueId, title: 'New task', priority: 5 }),
    });
    const res = await createTaskRoute(req, { params: Promise.resolve({ id: dashboardId }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toHaveProperty('title', 'New task');
    expect(data).toHaveProperty('queueId', todoQueueId);
    expect(data).toHaveProperty('id');
  });

  it('returns 400 when queueId is missing', async () => {
    const req = new Request(`http://localhost/api/dashboards/${dashboardId}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'No queue' }),
    });
    const res = await createTaskRoute(req, { params: Promise.resolve({ id: dashboardId }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when title is missing', async () => {
    const req = new Request(`http://localhost/api/dashboards/${dashboardId}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queueId: todoQueueId }),
    });
    const res = await createTaskRoute(req, { params: Promise.resolve({ id: dashboardId }) });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/tasks/[id]
// ---------------------------------------------------------------------------
describe('GET /api/tasks/[id]', () => {
  it('returns a task with history', async () => {
    const task = createTask(testDb, { dashboardId, queueId: todoQueueId, title: 'My task' });
    const req = new Request(`http://localhost/api/tasks/${task.id}`);
    const res = await getTaskRoute(req, { params: Promise.resolve({ id: task.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('id', task.id);
    expect(data).toHaveProperty('history');
    expect(Array.isArray(data.history)).toBe(true);
  });

  it('returns 404 for an unknown task', async () => {
    const req = new Request('http://localhost/api/tasks/nope');
    const res = await getTaskRoute(req, { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/tasks/[id] — action: update
// ---------------------------------------------------------------------------
describe('PATCH /api/tasks/[id] action=update', () => {
  it('updates task title and priority', async () => {
    const task = createTask(testDb, { dashboardId, queueId: todoQueueId, title: 'Old title' });
    const req = new Request(`http://localhost/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'update', title: 'New title', priority: 10 }),
    });
    const res = await patchTaskRoute(req, { params: Promise.resolve({ id: task.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('title', 'New title');
    expect(data).toHaveProperty('priority', 10);
  });

  it('returns 404 when updating unknown task', async () => {
    const req = new Request('http://localhost/api/tasks/nope', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'update', title: 'X' }),
    });
    const res = await patchTaskRoute(req, { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/tasks/[id] — action: move
// ---------------------------------------------------------------------------
describe('PATCH /api/tasks/[id] action=move', () => {
  it('moves task to another queue', async () => {
    const task = createTask(testDb, { dashboardId, queueId: todoQueueId, title: 'Movable task' });
    const req = new Request(`http://localhost/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'move', toQueueId: inProgressQueueId, actor: 'human' }),
    });
    const res = await patchTaskRoute(req, { params: Promise.resolve({ id: task.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('queueId', inProgressQueueId);
  });

  it('returns 400 when toQueueId is missing', async () => {
    const task = createTask(testDb, { dashboardId, queueId: todoQueueId, title: 'Task' });
    const req = new Request(`http://localhost/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'move', actor: 'human' }),
    });
    const res = await patchTaskRoute(req, { params: Promise.resolve({ id: task.id }) });
    expect(res.status).toBe(400);
  });

  it('returns 422 when moving to invalid queue', async () => {
    const task = createTask(testDb, { dashboardId, queueId: todoQueueId, title: 'Task' });
    const req = new Request(`http://localhost/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'move', toQueueId: 'no-such-queue', actor: 'human' }),
    });
    const res = await patchTaskRoute(req, { params: Promise.resolve({ id: task.id }) });
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/tasks/[id] — action: claim
// ---------------------------------------------------------------------------
describe('PATCH /api/tasks/[id] action=claim', () => {
  it('claims a task for an agent', async () => {
    const task = createTask(testDb, {
      dashboardId,
      queueId: inProgressQueueId,
      title: 'Claimable',
    });
    const req = new Request(`http://localhost/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'claim', agentId: 'agent-1', sessionKey: 'sess-abc' }),
    });
    const res = await patchTaskRoute(req, { params: Promise.resolve({ id: task.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('assignedAgent', 'agent-1');
    expect(data).toHaveProperty('sessionKey', 'sess-abc');
  });

  it('returns 400 when agentId is missing', async () => {
    const task = createTask(testDb, { dashboardId, queueId: todoQueueId, title: 'Task' });
    const req = new Request(`http://localhost/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'claim', sessionKey: 'sess' }),
    });
    const res = await patchTaskRoute(req, { params: Promise.resolve({ id: task.id }) });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/tasks/[id] — action: clear-error
// ---------------------------------------------------------------------------
describe('PATCH /api/tasks/[id] action=clear-error', () => {
  it('clears task error', async () => {
    const task = createTask(testDb, { dashboardId, queueId: todoQueueId, title: 'Errored task' });
    setTaskError(testDb, task.id, 'Something went wrong');

    const req = new Request(`http://localhost/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'clear-error' }),
    });
    const res = await patchTaskRoute(req, { params: Promise.resolve({ id: task.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.error).toBeNull();
  });

  it('returns 404 when clearing error on unknown task', async () => {
    const req = new Request('http://localhost/api/tasks/nope', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'clear-error' }),
    });
    const res = await patchTaskRoute(req, { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/tasks/[id] — unknown action
// ---------------------------------------------------------------------------
describe('PATCH /api/tasks/[id] unknown action', () => {
  it('returns 400 for an unrecognized action', async () => {
    const task = createTask(testDb, { dashboardId, queueId: todoQueueId, title: 'Task' });
    const req = new Request(`http://localhost/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'fly-to-moon' }),
    });
    const res = await patchTaskRoute(req, { params: Promise.resolve({ id: task.id }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toHaveProperty('error', 'unknown action');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/tasks/[id]
// ---------------------------------------------------------------------------
describe('DELETE /api/tasks/[id]', () => {
  it('deletes a task', async () => {
    const task = createTask(testDb, { dashboardId, queueId: todoQueueId, title: 'Doomed task' });
    const req = new Request(`http://localhost/api/tasks/${task.id}`, { method: 'DELETE' });
    const res = await deleteTaskRoute(req, { params: Promise.resolve({ id: task.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('ok', true);
  });

  it('returns 404 when deleting unknown task', async () => {
    const req = new Request('http://localhost/api/tasks/nope', { method: 'DELETE' });
    const res = await deleteTaskRoute(req, { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });
});
