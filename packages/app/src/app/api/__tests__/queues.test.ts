import { vi, beforeEach, describe, it, expect } from 'vitest';
import {
  createDb,
  seedDefaultProject,
  listProjects,
  listQueues,
  createTask,
  createQueue,
} from '@openlares/db';
import type { OpenlareDb } from '@openlares/db';

// --- DB mock ---
let testDb: OpenlareDb;
vi.mock('@/lib/db', () => ({ getDb: () => testDb }));
vi.mock('@/lib/task-events', () => ({ emit: vi.fn() }));

import {
  GET as listQueuesRoute,
  POST as createQueueRoute,
  PATCH as reorderQueuesRoute,
} from '../dashboards/[id]/queues/route';
import { DELETE as deleteQueueRoute } from '../queues/[id]/route';

let projectId: string;
let todoQueueId: string;
let _inProgressQueueId: string;

beforeEach(() => {
  testDb = createDb(':memory:');
  const dashboard = seedDefaultProject(testDb)!;
  projectId = dashboard.id;
  const queues = listQueues(testDb, projectId);
  todoQueueId = queues.find((q) => q.name === 'Todo')!.id;
  _inProgressQueueId = queues.find((q) => q.name === 'In Progress')!.id;
});

// ---------------------------------------------------------------------------
// GET /api/dashboards/[id]/queues
// ---------------------------------------------------------------------------
describe('GET /api/dashboards/[id]/queues', () => {
  it('returns queues and transitions for the dashboard', async () => {
    const req = new Request(`http://localhost/api/dashboards/${projectId}/queues`);
    const res = await listQueuesRoute(req, { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('queues');
    expect(data).toHaveProperty('transitions');
    expect(Array.isArray(data.queues)).toBe(true);
    expect(Array.isArray(data.transitions)).toBe(true);
    expect(data.queues.length).toBeGreaterThanOrEqual(3); // Todo, In Progress, Done
  });

  it('queues have expected fields', async () => {
    const req = new Request(`http://localhost/api/dashboards/${projectId}/queues`);
    const res = await listQueuesRoute(req, { params: Promise.resolve({ id: projectId }) });
    const data = await res.json();
    const queue = data.queues[0];
    expect(queue).toHaveProperty('id');
    expect(queue).toHaveProperty('name');
    expect(queue).toHaveProperty('ownerType');
    expect(typeof queue.createdAt).toBe('number'); // serialized as ms
  });
});

// ---------------------------------------------------------------------------
// POST /api/dashboards/[id]/queues
// ---------------------------------------------------------------------------
describe('POST /api/dashboards/[id]/queues', () => {
  it('creates a new queue with 201 status', async () => {
    const req = new Request(`http://localhost/api/dashboards/${projectId}/queues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Review', ownerType: 'human', position: 3 }),
    });
    const res = await createQueueRoute(req, { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toHaveProperty('name', 'Review');
    expect(data).toHaveProperty('ownerType', 'human');
  });

  it('returns 400 when name is missing', async () => {
    const req = new Request(`http://localhost/api/dashboards/${projectId}/queues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownerType: 'human' }),
    });
    const res = await createQueueRoute(req, { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when ownerType is missing', async () => {
    const req = new Request(`http://localhost/api/dashboards/${projectId}/queues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Orphan' }),
    });
    const res = await createQueueRoute(req, { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/dashboards/[id]/queues (reorder)
// ---------------------------------------------------------------------------
describe('PATCH /api/dashboards/[id]/queues', () => {
  it('reorders queues successfully', async () => {
    const queues = listQueues(testDb, projectId);
    const positions = queues.map((q, i) => ({ id: q.id, position: queues.length - 1 - i }));
    const req = new Request(`http://localhost/api/dashboards/${projectId}/queues`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ positions }),
    });
    const res = await reorderQueuesRoute(req, { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('ok', true);
  });

  it('returns 400 when positions array is missing', async () => {
    const req = new Request(`http://localhost/api/dashboards/${projectId}/queues`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ positions: 'bad' }),
    });
    const res = await reorderQueuesRoute(req, { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/queues/[id]
// ---------------------------------------------------------------------------
describe('DELETE /api/queues/[id]', () => {
  it('deletes a non-last queue that has no tasks', async () => {
    // Create a 4th queue so "Todo" is not the last one if we delete another
    const extra = createQueue(testDb, {
      projectId,
      name: 'Extra',
      ownerType: 'human',
      position: 10,
    });
    const req = new Request(`http://localhost/api/queues/${extra.id}`, { method: 'DELETE' });
    const res = await deleteQueueRoute(req, { params: Promise.resolve({ id: extra.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('ok', true);
  });

  it('returns 404 for an unknown queue', async () => {
    const req = new Request('http://localhost/api/queues/no-such', { method: 'DELETE' });
    const res = await deleteQueueRoute(req, { params: Promise.resolve({ id: 'no-such' }) });
    expect(res.status).toBe(404);
  });

  it('returns 400 when queue has tasks', async () => {
    // Put a task in the Todo queue
    createTask(testDb, { projectId, queueId: todoQueueId, title: 'Blocking task' });
    const req = new Request(`http://localhost/api/queues/${todoQueueId}`, { method: 'DELETE' });
    const res = await deleteQueueRoute(req, { params: Promise.resolve({ id: todoQueueId }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when trying to delete the last queue', async () => {
    // Create fresh dashboard with only one queue
    const { createProject } = await import('@openlares/db');
    const solo = createProject(testDb, { name: 'Solo' });
    const onlyQueue = createQueue(testDb, {
      projectId: solo.id,
      name: 'Only',
      ownerType: 'human',
      position: 0,
    });
    const req = new Request(`http://localhost/api/queues/${onlyQueue.id}`, { method: 'DELETE' });
    const res = await deleteQueueRoute(req, { params: Promise.resolve({ id: onlyQueue.id }) });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/queues/[id] (update description)
// ---------------------------------------------------------------------------
import { PATCH as updateQueueRoute } from '../queues/[id]/route';

describe('PATCH /api/queues/[id]', () => {
  it('updates the description of a queue', async () => {
    const req = new Request(`http://localhost/api/queues/${todoQueueId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Tasks waiting to be picked up' }),
    });
    const res = await updateQueueRoute(req, { params: Promise.resolve({ id: todoQueueId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('description', 'Tasks waiting to be picked up');
    expect(data).toHaveProperty('id', todoQueueId);
  });

  it('clears description when null is passed', async () => {
    const req = new Request(`http://localhost/api/queues/${todoQueueId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: null }),
    });
    const res = await updateQueueRoute(req, { params: Promise.resolve({ id: todoQueueId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.description).toBeNull();
  });

  it('returns 404 for unknown queue', async () => {
    const req = new Request('http://localhost/api/queues/no-such', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'test' }),
    });
    const res = await updateQueueRoute(req, { params: Promise.resolve({ id: 'no-such' }) });
    expect(res.status).toBe(404);
  });
});
