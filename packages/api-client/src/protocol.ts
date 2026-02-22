/**
 * OpenClaw Gateway WebSocket Protocol v3 — Type Definitions
 *
 * This file defines every frame type, event payload, and method
 * param/result used to talk to an OpenClaw Gateway over WebSocket.
 */

// ---------------------------------------------------------------------------
// Frame types — the three shapes a WebSocket message can take
// ---------------------------------------------------------------------------

/** A request sent from the client to the gateway. */
export interface RequestFrame {
  type: 'req';
  /** Unique ID so we can match the response back to this request. */
  id: string;
  /** The RPC method name, e.g. "connect", "chat.send". */
  method: string;
  /** Optional parameters for the method. */
  params?: unknown;
}

/** A response the gateway sends back after we send a request. */
export interface ResponseFrame {
  type: 'res';
  /** Matches the `id` from the original request. */
  id: string;
  /** `true` if the request succeeded. */
  ok: boolean;
  /** The result data (only when `ok` is true). */
  payload?: unknown;
  /** Error details (only when `ok` is false). */
  error?: GatewayError;
}

/** A server-initiated event (not a response to a request). */
export interface EventFrame {
  type: 'event';
  /** Event name, e.g. "chat", "tick", "shutdown". */
  event: string;
  /** Event-specific data. */
  payload?: unknown;
  /** Monotonic sequence number for ordering. */
  seq?: number;
  /** State version counters for cache invalidation. */
  stateVersion?: { presence: number; health: number };
}

/** Union of every possible frame the gateway can send us. */
export type IncomingFrame = ResponseFrame | EventFrame;

/** Error object attached to a failed response. */
export interface GatewayError {
  code: string;
  message: string;
  details?: unknown;
  /** If true, the client can safely retry the request. */
  retryable?: boolean;
}

// ---------------------------------------------------------------------------
// Handshake — connect flow
// ---------------------------------------------------------------------------

/** Payload inside the `connect.challenge` event the server sends first. */
export interface ConnectChallengePayload {
  nonce: string;
  ts: number;
}

/** What we send as `params` in the `connect` request. */
export interface ConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: string;
    version: string;
    platform: string;
    mode: string;
  };
  role: string;
  scopes: string[];
  auth: { token: string };
  device?: {
    id: string;
    publicKey: string;
    signature: string;
    signedAt: number;
    nonce?: string;
  };
  locale: string;
  userAgent: string;
}

/** The `payload` we get back when the connect request succeeds. */
export interface HelloOkPayload {
  type: 'hello-ok';
  protocol: number;
  server: Record<string, unknown>;
  features: {
    methods: string[];
    events: string[];
  };
  snapshot: {
    presence: unknown[];
    health: unknown;
    sessionDefaults?: {
      defaultAgentId: string;
      mainKey: string;
      mainSessionKey: string;
    };
  };
  policy: {
    tickIntervalMs: number;
  };
}

// ---------------------------------------------------------------------------
// Event payloads — data shapes for each server event
// ---------------------------------------------------------------------------

/** Possible states of a streaming chat event. */
export type ChatEventState = 'delta' | 'final' | 'aborted' | 'error';

/** Payload for the `chat` event (streaming responses). */
export interface ChatEventPayload {
  runId: string;
  sessionKey: string;
  seq: number;
  state: ChatEventState;
  /** The text content (a fragment for "delta", full text for "final"). */
  message?: string;
  /** Human-readable error (only when state is "error"). */
  errorMessage?: string;
  /** Token usage stats (only on "final"). */
  usage?: Record<string, unknown>;
}

/** Payload for the `agent` event (tool calls, etc.). */
export interface AgentEventPayload {
  runId: string;
  /** Session this event belongs to (may be absent for global events). */
  sessionKey?: string;
  seq: number;
  /** Event stream: "tool", "lifecycle", "compaction", "fallback". */
  stream: string;
  ts: number;
  data: AgentEventData;
}

/** Structured data inside an agent event. */
export interface AgentEventData {
  /** Unique ID for the tool call (present when stream is "tool"). */
  toolCallId?: string;
  /** Tool name, e.g. "exec", "read", "web_search" (present when stream is "tool"). */
  name?: string;
  /** Lifecycle phase of the tool call: "start", "update", "result". */
  phase?: string;
  /** Tool arguments (only on phase "start"). */
  args?: unknown;
  /** Partial result (only on phase "update"). */
  partialResult?: unknown;
  /** Final result (only on phase "result"). */
  result?: unknown;
  /** Catch-all for other fields. */
  [key: string]: unknown;
}

/** Payload for the `tick` keepalive event. */
export interface TickPayload {
  ts: number;
}

/** Payload for the `shutdown` event. */
export interface ShutdownPayload {
  reason?: string;
}

/** Payload for `system-presence` events. */
export interface SystemPresencePayload {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Method params & results — what we send / receive for each RPC method
// ---------------------------------------------------------------------------

/** Params for `chat.send`. Non-blocking — the response streams via `chat` events. */
export interface ChatSendParams {
  sessionKey: string;
  message: string;
  idempotencyKey: string;
}

/** Result of `chat.send` (just an acknowledgement). */
export interface ChatSendResult {
  runId: string;
}

/** Params for `chat.history`. */
export interface ChatHistoryParams {
  sessionKey: string;
  limit?: number;
}

/** A single message in chat history. */
export interface ChatHistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

/** Result of `chat.history`. */
export interface ChatHistoryResult {
  messages: ChatHistoryMessage[];
}

/** Params for `chat.abort`. */
export interface ChatAbortParams {
  sessionKey: string;
}

/** Params for `sessions.list`. */
export interface SessionsListParams {
  limit?: number;
  activeMinutes?: number;
  includeDerivedTitles?: boolean;
  includeLastMessage?: boolean;
}

/** A single session summary. */
export interface SessionSummary {
  sessionKey: string;
  title?: string;
  lastMessage?: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Result of `sessions.list`. */
export interface SessionsListResult {
  sessions: SessionSummary[];
}

/** Result of `status` (no params needed). */
export interface StatusResult {
  [key: string]: unknown;
}
