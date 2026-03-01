import { vi, beforeEach, describe, it, expect } from 'vitest';
import {
  createDb,
  seedDefaultProject,
  listProjects,
  listQueues,
  listTransitions,
  createTransition,
} from '@openlares/db';
import type { OpenlareDb } from '@openlares/db';

// --- DB mock ---
let testDb: OpenlareDb;
vi.mock('@/lib/db', () => ({ getDb: () => testDb }));
vi.mock('@/lib/task-events', () => ({ emit: vi.fn() }));

import {
  GET as listTransitionsRoute,
  POST as createTransitionRoute,
} from '../dashboards/[id]/transitions/route';
import { DELETE as deleteTransitionRoute } from '../transitions/[id]/route';

let projectId: string;
let todoQueueId: string;
let _inProgressQueueId: string;
let doneQueueId: string;

beforeEach(() => {
  testDb = createDb(':memory:');
  const dashboard = seedDefaultProject(testDb)!;
  projectId = dashboard.id;
  const queues = listQueues(testDb, projectId);
  todoQueueId = queues.find((q) => q.name === 'Todo')!.id;
  _inProgressQueueId = queues.find((q) => q.name === 'In Progress')!.id;
  doneQueueId = queues.find((q) => q.name === 'Done')!.id;
});

// ---------------------------------------------------------------------------
// GET /api/dashboards/[id]/transitions
// ---------------------------------------------------------------------------
describe('GET /api/dashboards/[id]/transitions', () => {
  it('returns the seeded transitions list', async () => {
    const req = new Request(`http://localhost/api/dashboards/${projectId}/transitions`);
    const res = await listTransitionsRoute(req, { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  it('transitions have expected fields', async () => {
    const req = new Request(`http://localhost/api/dashboards/${projectId}/transitions`);
    const res = await listTransitionsRoute(req, { params: Promise.resolve({ id: projectId }) });
    const data = await res.json();
    const t = data[0];
    expect(t).toHaveProperty('id');
    expect(t).toHaveProperty('fromQueueId');
    expect(t).toHaveProperty('toQueueId');
    expect(t).toHaveProperty('actorType');
  });
});

// ---------------------------------------------------------------------------
// POST /api/dashboards/[id]/transitions
// ---------------------------------------------------------------------------
describe('POST /api/dashboards/[id]/transitions', () => {
  it('creates a new transition with 201 status', async () => {
    const req = new Request(`http://localhost/api/dashboards/${projectId}/transitions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fromQueueId: todoQueueId,
        toQueueId: doneQueueId,
        actorType: 'both',
        autoTrigger: false,
      }),
    });
    const res = await createTransitionRoute(req, { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toHaveProperty('fromQueueId', todoQueueId);
    expect(data).toHaveProperty('toQueueId', doneQueueId);
    expect(data).toHaveProperty('actorType', 'both');
  });

  it('returns 400 when fromQueueId is missing', async () => {
    const req = new Request(`http://localhost/api/dashboards/${projectId}/transitions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toQueueId: doneQueueId, actorType: 'human' }),
    });
    const res = await createTransitionRoute(req, { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when actorType is missing', async () => {
    const req = new Request(`http://localhost/api/dashboards/${projectId}/transitions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromQueueId: todoQueueId, toQueueId: doneQueueId }),
    });
    const res = await createTransitionRoute(req, { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/transitions/[id]
// ---------------------------------------------------------------------------
describe('DELETE /api/transitions/[id]', () => {
  it('deletes a transition', async () => {
    const transitions = listTransitions(testDb, projectId);
    const transitionId = transitions[0]!.id;

    const req = new Request(`http://localhost/api/transitions/${transitionId}`, {
      method: 'DELETE',
    });
    const res = await deleteTransitionRoute(req, {
      params: Promise.resolve({ id: transitionId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('ok', true);
  });

  it('returns 404 for an unknown transition', async () => {
    const req = new Request('http://localhost/api/transitions/no-such', { method: 'DELETE' });
    const res = await deleteTransitionRoute(req, {
      params: Promise.resolve({ id: 'no-such' }),
    });
    expect(res.status).toBe(404);
  });
});
