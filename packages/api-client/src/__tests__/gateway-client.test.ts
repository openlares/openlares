/**
 * Unit tests for GatewayClient internals.
 *
 * We test the pure helpers (ID generation, backoff calculation)
 * and use a mock WebSocket to test state transitions and timeouts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateRequestId,
  reconnectDelay,
  resetRequestCounter,
  GatewayClient,
} from '../gateway-client';

// Mock device identity to avoid crypto in tests
vi.mock('../device-identity', () => ({
  getDeviceIdentity: vi.fn().mockResolvedValue({
    deviceId: 'test-device-id',
    publicKey: 'dGVzdC1wdWJsaWMta2V5',
    privateKey: 'dGVzdC1wcml2YXRlLWtleQ',
  }),
  signConnectChallenge: vi.fn().mockResolvedValue({
    id: 'test-device-id',
    publicKey: 'dGVzdC1wdWJsaWMta2V5',
    signature: 'dGVzdC1zaWduYXR1cmU',
    signedAt: 1234567890,
    nonce: 'abc',
  }),
}));

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

/** Minimal mock that captures sent data and lets us simulate server messages. */
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  sentMessages: string[] = [];

  private listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor(_url: string) {
    // Simulate async open — call onopen in the next microtask
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
    });
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type]!.push(handler);
  }

  removeEventListener(type: string, handler: (event: unknown) => void): void {
    const list = this.listeners[type];
    if (!list) return;
    this.listeners[type] = list.filter((h) => h !== handler);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  // -- Test helpers --

  /** Simulate the server sending a message. */
  simulateMessage(data: unknown): void {
    const handlers = this.listeners['message'] ?? [];
    for (const h of handlers) {
      h({ data: JSON.stringify(data) });
    }
  }

  /** Simulate the connection closing. */
  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    const handlers = this.listeners['close'] ?? [];
    for (const h of handlers) {
      h({});
    }
  }

  /** Simulate a WebSocket error. */
  simulateError(): void {
    const handlers = this.listeners['error'] ?? [];
    for (const h of handlers) {
      h(new Error('mock ws error'));
    }
  }
}

// Install mock WebSocket globally
let mockWsInstance: MockWebSocket | null = null;

beforeEach(() => {
  mockWsInstance = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = class extends MockWebSocket {
    constructor(url: string) {
      super(url);
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      mockWsInstance = this;
    }
  };
  // Also put the static constants on the mock constructor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket.OPEN = MockWebSocket.OPEN;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket.CONNECTING = MockWebSocket.CONNECTING;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket.CLOSING = MockWebSocket.CLOSING;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket.CLOSED = MockWebSocket.CLOSED;
  resetRequestCounter();
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).WebSocket;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Request ID generation
// ---------------------------------------------------------------------------

describe('generateRequestId', () => {
  it('produces unique IDs', () => {
    const a = generateRequestId();
    const b = generateRequestId();
    expect(a).not.toBe(b);
  });

  it('includes a counter prefix', () => {
    const id = generateRequestId();
    expect(id).toMatch(/^req-\d+-\d+$/);
  });

  it('counter increments', () => {
    const a = generateRequestId();
    const b = generateRequestId();
    const counterA = parseInt(a.split('-')[1]!, 10);
    const counterB = parseInt(b.split('-')[1]!, 10);
    expect(counterB).toBe(counterA + 1);
  });
});

// ---------------------------------------------------------------------------
// Reconnect backoff
// ---------------------------------------------------------------------------

describe('reconnectDelay', () => {
  it('starts at 1 second', () => {
    expect(reconnectDelay(0)).toBe(1_000);
  });

  it('doubles each attempt', () => {
    expect(reconnectDelay(1)).toBe(2_000);
    expect(reconnectDelay(2)).toBe(4_000);
    expect(reconnectDelay(3)).toBe(8_000);
  });

  it('caps at 30 seconds', () => {
    expect(reconnectDelay(10)).toBe(30_000);
    expect(reconnectDelay(100)).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

describe('GatewayClient state transitions', () => {
  it('starts as disconnected', () => {
    const client = new GatewayClient({ url: 'ws://test', token: 'tok' });
    expect(client.status).toBe('disconnected');
  });

  it('moves to connecting when connect() is called', () => {
    const client = new GatewayClient({ url: 'ws://test', token: 'tok' });
    const statuses: string[] = [];
    client.onStatusChange((s) => statuses.push(s));

    // Start connecting (don't await — we just want the status change)
    client.connect().catch(() => {});

    expect(client.status).toBe('connecting');
    expect(statuses).toContain('connecting');

    // Clean up
    client.disconnect();
  });

  it('rejects double connect', async () => {
    const client = new GatewayClient({ url: 'ws://test', token: 'tok' });
    client.connect().catch(() => {});

    await expect(client.connect()).rejects.toThrow('already connecting');

    client.disconnect();
  });

  it('moves to disconnected on disconnect()', () => {
    const client = new GatewayClient({ url: 'ws://test', token: 'tok' });
    client.connect().catch(() => {});
    client.disconnect();
    expect(client.status).toBe('disconnected');
  });

  it('completes handshake and moves to connected', async () => {
    const client = new GatewayClient({ url: 'ws://test', token: 'tok' });
    const connectPromise = client.connect();

    // Wait for the mock WebSocket to be created
    await vi.waitFor(() => expect(mockWsInstance).not.toBeNull());
    const ws = mockWsInstance!;

    // Server sends challenge
    ws.simulateMessage({
      type: 'event',
      event: 'connect.challenge',
      payload: { nonce: 'abc', ts: Date.now() },
    });

    // Client should have sent a connect request
    // Wait for async sendConnectRequest to complete
    await vi.waitFor(() => expect(ws.sentMessages.length).toBe(1));
    const req = JSON.parse(ws.sentMessages[0]!) as { id: string };

    // Server responds with hello-ok
    ws.simulateMessage({
      type: 'res',
      id: req.id,
      ok: true,
      payload: {
        type: 'hello-ok',
        protocol: 3,
        server: {},
        features: { methods: [], events: [] },
        snapshot: { presence: [], health: {} },
        policy: { tickIntervalMs: 15000 },
      },
    });

    const hello = await connectPromise;
    expect(hello.type).toBe('hello-ok');
    expect(client.status).toBe('connected');

    client.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Request timeout
// ---------------------------------------------------------------------------

describe('GatewayClient request timeout', () => {
  it('rejects after timeout', async () => {
    vi.useFakeTimers();

    const client = new GatewayClient({
      url: 'ws://test',
      token: 'tok',
      requestTimeoutMs: 500,
    });

    // Perform full handshake so client is "connected"
    const connectPromise = client.connect();
    await vi.waitFor(() => expect(mockWsInstance).not.toBeNull());
    const ws = mockWsInstance!;

    ws.simulateMessage({
      type: 'event',
      event: 'connect.challenge',
      payload: { nonce: 'n', ts: 1 },
    });

    await vi.waitFor(() => expect(ws.sentMessages.length).toBeGreaterThanOrEqual(1));
    const req = JSON.parse(ws.sentMessages[0]!) as { id: string };
    ws.simulateMessage({
      type: 'res',
      id: req.id,
      ok: true,
      payload: {
        type: 'hello-ok',
        protocol: 3,
        server: {},
        features: { methods: [], events: [] },
        snapshot: { presence: [], health: {} },
        policy: { tickIntervalMs: 15000 },
      },
    });
    await connectPromise;

    // Now send a request that will never get a response
    const requestPromise = client.request('status');

    // Advance time past the timeout
    vi.advanceTimersByTime(600);

    await expect(requestPromise).rejects.toThrow('timed out');

    client.disconnect();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Event subscription
// ---------------------------------------------------------------------------

describe('GatewayClient event subscriptions', () => {
  it('fires handlers for matching events', async () => {
    const client = new GatewayClient({ url: 'ws://test', token: 'tok' });
    const connectPromise = client.connect();
    await vi.waitFor(() => expect(mockWsInstance).not.toBeNull());
    const ws = mockWsInstance!;

    // Complete handshake
    ws.simulateMessage({
      type: 'event',
      event: 'connect.challenge',
      payload: { nonce: 'n', ts: 1 },
    });
    await vi.waitFor(() => expect(ws.sentMessages.length).toBeGreaterThanOrEqual(1));
    const req = JSON.parse(ws.sentMessages[0]!) as { id: string };
    ws.simulateMessage({
      type: 'res',
      id: req.id,
      ok: true,
      payload: {
        type: 'hello-ok',
        protocol: 3,
        server: {},
        features: { methods: [], events: [] },
        snapshot: { presence: [], health: {} },
        policy: { tickIntervalMs: 15000 },
      },
    });
    await connectPromise;

    // Subscribe to a test event
    const received: unknown[] = [];
    client.on('tick', (p) => received.push(p));

    // Simulate the event
    ws.simulateMessage({
      type: 'event',
      event: 'tick',
      payload: { ts: 12345 },
    });

    expect(received).toEqual([{ ts: 12345 }]);

    client.disconnect();
  });

  it('unsubscribe removes handler', async () => {
    const client = new GatewayClient({ url: 'ws://test', token: 'tok' });
    const connectPromise = client.connect();
    await vi.waitFor(() => expect(mockWsInstance).not.toBeNull());
    const ws = mockWsInstance!;

    // Complete handshake
    ws.simulateMessage({
      type: 'event',
      event: 'connect.challenge',
      payload: { nonce: 'n', ts: 1 },
    });
    await vi.waitFor(() => expect(ws.sentMessages.length).toBeGreaterThanOrEqual(1));
    const req = JSON.parse(ws.sentMessages[0]!) as { id: string };
    ws.simulateMessage({
      type: 'res',
      id: req.id,
      ok: true,
      payload: {
        type: 'hello-ok',
        protocol: 3,
        server: {},
        features: { methods: [], events: [] },
        snapshot: { presence: [], health: {} },
        policy: { tickIntervalMs: 15000 },
      },
    });
    await connectPromise;

    const received: unknown[] = [];
    const unsub = client.on('tick', (p) => received.push(p));

    // First event should be captured
    ws.simulateMessage({ type: 'event', event: 'tick', payload: { ts: 1 } });
    expect(received).toHaveLength(1);

    // Unsubscribe, second event should NOT be captured
    unsub();
    ws.simulateMessage({ type: 'event', event: 'tick', payload: { ts: 2 } });
    expect(received).toHaveLength(1);

    client.disconnect();
  });
});
