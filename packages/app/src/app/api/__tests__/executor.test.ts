import { vi, beforeEach, describe, it, expect } from 'vitest';

// Mock task-executor so tests don't try to make real HTTP calls or start timers
const mockStatus = {
  running: false,
  currentTaskId: null,
  currentSessionKey: null,
  dispatchTime: null,
};
vi.mock('@/lib/task-executor', () => ({
  getExecutorStatus: vi.fn(() => ({ ...mockStatus })),
  startExecutor: vi.fn((projectId: string) => {
    mockStatus.running = true;
  }),
  stopExecutor: vi.fn(() => {
    mockStatus.running = false;
  }),
  configureGateway: vi.fn(),
}));

vi.mock('@/lib/task-events', () => ({ emit: vi.fn() }));

import { GET as getExecutorStatus, POST as postExecutor } from '../executor/route';

beforeEach(() => {
  mockStatus.running = false;
  mockStatus.currentTaskId = null;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/executor
// ---------------------------------------------------------------------------
describe('GET /api/executor', () => {
  it('returns executor status', async () => {
    const res = await getExecutorStatus();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('running');
  });
});

// ---------------------------------------------------------------------------
// POST /api/executor
// ---------------------------------------------------------------------------
describe('POST /api/executor action=start', () => {
  it('starts the executor with a projectId', async () => {
    const req = new Request('http://localhost/api/executor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start', projectId: 'dash-1' }),
    });
    const res = await postExecutor(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('ok', true);
  });

  it('returns 400 when projectId is missing', async () => {
    const req = new Request('http://localhost/api/executor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start' }),
    });
    const res = await postExecutor(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toHaveProperty('error');
  });

  it('configures gateway when url and token are provided', async () => {
    const { configureGateway } = await import('@/lib/task-executor');
    const req = new Request('http://localhost/api/executor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'start',
        projectId: 'dash-1',
        gatewayUrl: 'http://gw',
        gatewayToken: 'tok',
      }),
    });
    const res = await postExecutor(req);
    expect(res.status).toBe(200);
    expect(configureGateway).toHaveBeenCalledWith({ url: 'http://gw', token: 'tok' });
  });
});

describe('POST /api/executor action=stop', () => {
  it('stops the executor', async () => {
    const req = new Request('http://localhost/api/executor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    });
    const res = await postExecutor(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('ok', true);
  });
});

describe('POST /api/executor unknown action', () => {
  it('returns 400 for an unrecognized action', async () => {
    const req = new Request('http://localhost/api/executor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'explode' }),
    });
    const res = await postExecutor(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toHaveProperty('error', 'unknown action');
  });
});
