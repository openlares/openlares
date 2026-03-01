import { vi, beforeEach, describe, it, expect } from 'vitest';
import { createDb, seedDefaultProject, listProjects } from '@openlares/db';
import type { OpenlareDb } from '@openlares/db';

// --- DB mock (hoisted above all imports) ---
let testDb: OpenlareDb;
vi.mock('@/lib/db', () => ({ getDb: () => testDb }));
vi.mock('@/lib/task-events', () => ({ emit: vi.fn() }));

// Route handlers imported AFTER mocks are declared
import { GET as listProjectsRoute, POST as createProjectRoute } from '../dashboards/route';
import { GET as getProjectRoute, PATCH as patchDashboardRoute } from '../dashboards/[id]/route';

beforeEach(() => {
  testDb = createDb(':memory:');
  seedDefaultProject(testDb);
});

// ---------------------------------------------------------------------------
// GET /api/dashboards
// ---------------------------------------------------------------------------
describe('GET /api/dashboards', () => {
  it('returns a list of dashboards', async () => {
    const res = await listProjectsRoute();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('includes the seeded default dashboard', async () => {
    const res = await listProjectsRoute();
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0]).toHaveProperty('name', 'Default');
  });
});

// ---------------------------------------------------------------------------
// POST /api/dashboards
// ---------------------------------------------------------------------------
describe('POST /api/dashboards', () => {
  it('creates a new dashboard with 201 status', async () => {
    const req = new Request('http://localhost/api/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'My Board' }),
    });
    const res = await createProjectRoute(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toHaveProperty('name', 'My Board');
    expect(data).toHaveProperty('id');
  });

  it('returns 400 when name is missing', async () => {
    const req = new Request('http://localhost/api/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await createProjectRoute(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// GET /api/dashboards/[id]
// ---------------------------------------------------------------------------
describe('GET /api/dashboards/[id]', () => {
  it('returns a specific dashboard by id', async () => {
    const dashboards = listProjects(testDb);
    const id = dashboards[0]!.id;
    const req = new Request(`http://localhost/api/dashboards/${id}`);
    const res = await getProjectRoute(req, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('id', id);
    expect(data).toHaveProperty('name', 'Default');
  });

  it('returns 404 for an unknown dashboard id', async () => {
    const req = new Request('http://localhost/api/dashboards/nope');
    const res = await getProjectRoute(req, { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/dashboards/[id]
// ---------------------------------------------------------------------------
describe('PATCH /api/dashboards/[id]', () => {
  it('updates the dashboard name', async () => {
    const dashboards = listProjects(testDb);
    const id = dashboards[0]!.id;
    const req = new Request(`http://localhost/api/dashboards/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed Board' }),
    });
    const res = await patchDashboardRoute(req, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('name', 'Renamed Board');
  });

  it('returns 404 when patching unknown dashboard', async () => {
    const req = new Request('http://localhost/api/dashboards/bad', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    const res = await patchDashboardRoute(req, { params: Promise.resolve({ id: 'bad' }) });
    expect(res.status).toBe(404);
  });
});
