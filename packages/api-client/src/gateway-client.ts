/**
 * GatewayClient — WebSocket client for the OpenClaw Gateway.
 *
 * Handles connection, authentication (protocol v3 handshake),
 * request/response matching, event subscriptions, auto-reconnect,
 * and tick keepalive.
 *
 * Usage:
 *   const client = new GatewayClient({ url: 'ws://localhost:18789', token: 'secret' });
 *   client.onStatusChange((status) => console.log(status));
 *   await client.connect();
 *   const sessions = await client.request('sessions.list', { limit: 10 });
 *   client.on('chat', (payload) => console.log(payload));
 *   client.disconnect();
 */

import type { ConnectionStatus } from '@openlares/core';
import { getDeviceIdentity, signConnectChallenge } from './device-identity';
import type { DeviceIdentity } from './device-identity';
import type {
  ConnectChallengePayload,
  ConnectParams,
  EventFrame,
  HelloOkPayload,
  IncomingFrame,
  RequestFrame,
  ResponseFrame,
} from './protocol';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Options passed to the GatewayClient constructor. */
export interface GatewayClientOptions {
  /** WebSocket URL, e.g. "ws://localhost:18789". */
  url: string;
  /** Auth token for the gateway. */
  token: string;
  /** Request timeout in ms (default 10 000). */
  requestTimeoutMs?: number;
  /** Origin header for server-side WebSocket connections. */
  origin?: string;
}

/** Handler for gateway events. */
export type EventHandler = (payload: unknown) => void;

/** Handler that receives connection status changes. */
export type StatusChangeHandler = (status: ConnectionStatus) => void;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Default request timeout in ms. */
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** Reconnect backoff parameters. */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Calculate the delay (in ms) for a given reconnect attempt.
 * Exponential backoff: 1 s → 2 s → 4 s → 8 s → … → max 30 s.
 */
export function reconnectDelay(attempt: number): number {
  const delay = RECONNECT_BASE_MS * Math.pow(2, attempt);
  return Math.min(delay, RECONNECT_MAX_MS);
}

/** Generate a unique request ID. */
let requestCounter = 0;
export function generateRequestId(): string {
  requestCounter += 1;
  return `req-${requestCounter}-${Date.now()}`;
}

/** Reset the request counter (useful in tests). */
export function resetRequestCounter(): void {
  requestCounter = 0;
}

// ---------------------------------------------------------------------------
// Pending request bookkeeping
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// GatewayClient
// ---------------------------------------------------------------------------

export class GatewayClient {
  private readonly url: string;
  private readonly token: string;
  private readonly requestTimeoutMs: number;
  private readonly origin?: string;

  private ws: WebSocket | null = null;
  private _status: ConnectionStatus = 'disconnected';
  private statusListeners = new Set<StatusChangeHandler>();
  private eventListeners = new Map<string, Set<EventHandler>>();
  private pendingRequests = new Map<string, PendingRequest>();

  // Reconnect state
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;

  // Handshake state
  private connectNonce: string | undefined;

  // Device identity for gateway auth
  private deviceIdentity: DeviceIdentity | null = null;

  private connectResolve: ((hello: HelloOkPayload) => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;

  constructor(options: GatewayClientOptions) {
    this.url = options.url;
    this.token = options.token;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.origin = options.origin;
  }

  // -----------------------------------------------------------------------
  // Public API — connection lifecycle
  // -----------------------------------------------------------------------

  /** Current connection status. */
  get status(): ConnectionStatus {
    return this._status;
  }

  /** Register a listener that fires whenever the connection status changes. */
  onStatusChange(handler: StatusChangeHandler): () => void {
    this.statusListeners.add(handler);
    return () => this.statusListeners.delete(handler);
  }

  /**
   * Open a WebSocket, perform the v3 handshake, and resolve with
   * the HelloOk payload once authenticated.
   */
  connect(): Promise<HelloOkPayload> {
    if (this._status === 'connected' || this._status === 'connecting') {
      return Promise.reject(new Error(`Cannot connect: already ${this._status}`));
    }

    this.shouldReconnect = true;
    return this.doConnect();
  }

  /** Close the WebSocket cleanly and stop any reconnect attempts. */
  disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.cleanup();
    this.setStatus('disconnected');
  }

  // -----------------------------------------------------------------------
  // Public API — requests
  // -----------------------------------------------------------------------

  /**
   * Send a request to the gateway and wait for the response.
   * Rejects if the server returns an error or the request times out.
   */
  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this._status !== 'connected') {
      return Promise.reject(new Error('Not connected'));
    }

    const id = generateRequestId();
    const frame: RequestFrame = { type: 'req', id, method };
    if (params !== undefined) {
      frame.params = params;
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request "${method}" timed out after ${this.requestTimeoutMs} ms`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (payload: unknown) => void,
        reject,
        timer,
      });

      this.send(frame);
    });
  }

  // -----------------------------------------------------------------------
  // Public API — event subscriptions
  // -----------------------------------------------------------------------

  /** Subscribe to a gateway event (e.g. "chat", "tick"). Returns an unsubscribe fn. */
  on(event: string, handler: EventHandler): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  /** Unsubscribe from a gateway event. */
  off(event: string, handler: EventHandler): void {
    this.eventListeners.get(event)?.delete(handler);
  }

  // -----------------------------------------------------------------------
  // Internals — connection
  // -----------------------------------------------------------------------

  private doConnect(): Promise<HelloOkPayload> {
    this.setStatus('connecting');

    return new Promise<HelloOkPayload>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;

      try {
        let ws: WebSocket;
        if (this.origin) {
          // Dynamic require to avoid bundling ws in browser builds.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const WS = require('ws') as { new (url: string, opts?: object): WebSocket };
          ws = new WS(this.url, {
            headers: { Origin: this.origin },
            rejectUnauthorized: false,
          }) as unknown as WebSocket;
        } else {
          ws = new WebSocket(this.url);
        }
        this.ws = ws;

        ws.addEventListener('message', this.handleMessage);
        ws.addEventListener('close', this.handleClose);
        ws.addEventListener('error', this.handleError);
      } catch (err) {
        this.connectReject = null;
        this.connectResolve = null;
        this.setStatus('error');
        reject(err);
      }
    });
  }

  // -----------------------------------------------------------------------
  // Internals — message handling
  // -----------------------------------------------------------------------

  private handleMessage = (event: MessageEvent): void => {
    let frame: IncomingFrame;
    try {
      frame = JSON.parse(event.data as string) as IncomingFrame;
    } catch {
      return; // ignore malformed frames
    }

    if (frame.type === 'event') {
      this.handleEvent(frame);
    } else if (frame.type === 'res') {
      this.handleResponse(frame);
    }
  };

  private handleEvent(frame: EventFrame): void {
    // Step 1 of handshake: server sends "connect.challenge"
    if (frame.event === 'connect.challenge') {
      const challenge = frame.payload as ConnectChallengePayload;
      this.sendConnectRequest(challenge);
      return;
    }

    // Tick keepalive — just acknowledge we're alive (no explicit reply needed,
    // but we emit it so consumers can track freshness).

    // Emit to subscribers
    const handlers = this.eventListeners.get(frame.event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(frame.payload);
        } catch {
          // Don't let a broken handler crash the client
        }
      }
    }
  }

  private handleResponse(frame: ResponseFrame): void {
    // Is this the hello-ok response to our connect request?
    if (this._status === 'connecting' && frame.ok && this.connectResolve) {
      const hello = frame.payload as HelloOkPayload;
      this.reconnectAttempt = 0;
      this.setStatus('connected');
      this.connectResolve(hello);
      this.connectResolve = null;
      this.connectReject = null;
      return;
    }

    // Connect failed?
    if (this._status === 'connecting' && !frame.ok && this.connectReject) {
      const msg = frame.error?.message ?? 'Handshake failed';
      this.connectReject(new Error(msg));
      this.connectResolve = null;
      this.connectReject = null;
      this.cleanup();
      this.setStatus('error');
      return;
    }

    // Normal request/response matching
    const pending = this.pendingRequests.get(frame.id);
    if (!pending) return;

    this.pendingRequests.delete(frame.id);
    clearTimeout(pending.timer);

    if (frame.ok) {
      pending.resolve(frame.payload);
    } else {
      const msg = frame.error?.message ?? 'Request failed';
      pending.reject(new Error(msg));
    }
  }

  // -----------------------------------------------------------------------
  // Internals — handshake
  // -----------------------------------------------------------------------

  private async sendConnectRequest(challenge: ConnectChallengePayload): Promise<void> {
    // Store nonce for signing
    this.connectNonce = challenge.nonce;

    // Ensure we have a device identity
    if (!this.deviceIdentity) {
      this.deviceIdentity = await getDeviceIdentity();
    }

    const clientId = 'openclaw-control-ui';
    const clientMode = 'webchat';
    const role = 'operator';
    const scopes = ['operator.read', 'operator.write'];

    // Sign the connect challenge with our device identity
    const device = await signConnectChallenge(this.deviceIdentity, {
      clientId,
      clientMode,
      role,
      scopes,
      token: this.token,
      nonce: challenge.nonce,
    });

    const params: ConnectParams = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: clientId,
        version: '0.0.0',
        platform: 'web',
        mode: clientMode,
      },
      role,
      scopes,
      device,
      caps: ['tool-events'],
      auth: { token: this.token },
      locale: typeof navigator !== 'undefined' ? navigator.language : 'en',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'openlares',
    };

    const frame: RequestFrame = {
      type: 'req',
      id: generateRequestId(),
      method: 'connect',
      params,
    };

    this.send(frame);
  }

  // -----------------------------------------------------------------------
  // Internals — WebSocket lifecycle
  // -----------------------------------------------------------------------

  private handleClose = (): void => {
    this.rejectAllPending('Connection closed');
    this.cleanup();

    if (this.shouldReconnect) {
      this.setStatus('connecting');
      this.scheduleReconnect();
    } else {
      this.setStatus('disconnected');
    }
  };

  private handleError = (): void => {
    // The "close" event always fires after "error", so we handle cleanup there.
    // We just reject the handshake promise if we're still connecting.
    if (this.connectReject) {
      this.connectReject(new Error('WebSocket error'));
      this.connectResolve = null;
      this.connectReject = null;
    }
  };

  private send(frame: RequestFrame): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  private cleanup(): void {
    if (this.ws) {
      this.ws.removeEventListener('message', this.handleMessage);
      this.ws.removeEventListener('close', this.handleClose);
      this.ws.removeEventListener('error', this.handleError);

      try {
        this.ws.close();
      } catch {
        // already closed — ignore
      }
      this.ws = null;
    }
  }

  // -----------------------------------------------------------------------
  // Internals — reconnection
  // -----------------------------------------------------------------------

  private scheduleReconnect(): void {
    const delay = reconnectDelay(this.reconnectAttempt);
    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect().catch(() => {
        // doConnect rejection is handled by handleClose → scheduleReconnect
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Internals — helpers
  // -----------------------------------------------------------------------

  private setStatus(status: ConnectionStatus): void {
    if (this._status === status) return;
    this._status = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {
        // Don't let a broken listener crash the client
      }
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingRequests.delete(id);
    }
  }
}
