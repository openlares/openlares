/**
 * Zustand store for gateway connection state.
 *
 * Tracks connection status, sessions, active session,
 * chat messages, and activity items. Wires incoming gateway
 * events to update the store automatically.
 *
 * Usage:
 *   const status = useGatewayStore((s) => s.connectionStatus);
 *   const connect = useGatewayStore((s) => s.connect);
 *   connect({ url: 'ws://localhost:18789', auth: 'token' });
 */

import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

import type { ActivityItem, ChatMessage, ConnectionStatus, GatewayConfig } from '@openlares/core';
import { GatewayClient } from './gateway-client';
import type {
  ChatEventPayload,
  ChatHistoryResult,
  AgentEventPayload,
  SessionSummary,
} from './protocol';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface GatewayState {
  /** Current connection status. */
  connectionStatus: ConnectionStatus;
  /** The active GatewayClient instance, if any. */
  client: GatewayClient | null;
  /** Human-readable error string, if any. */
  error: string | null;

  /** All known sessions. */
  sessions: SessionSummary[];
  /** The currently selected session key. */
  activeSessionKey: string | null;

  /** Chat messages for the active session. */
  messages: ChatMessage[];
  /** Whether an assistant response is currently streaming. */
  isStreaming: boolean;
  /** Activity feed items (tool calls, status changes, etc.). */
  activityItems: ActivityItem[];
}

export interface GatewayActions {
  /** Open a connection to the gateway. */
  connect: (config: GatewayConfig) => Promise<void>;
  /** Disconnect from the gateway. */
  disconnect: () => void;

  /** Send a chat message in the active session. */
  sendMessage: (text: string) => Promise<void>;
  /** Switch the active session. */
  selectSession: (sessionKey: string) => void;
  /** Refresh the session list from the gateway. */
  refreshSessions: () => Promise<void>;
  /** Load chat history for a given session. */
  loadHistory: (sessionKey: string) => Promise<void>;
}

export type GatewayStore = GatewayState & GatewayActions;

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

let activityIdCounter = 0;

function nextActivityId(): string {
  activityIdCounter += 1;
  return `act-${activityIdCounter}`;
}

export const gatewayStore = createStore<GatewayStore>((set, get) => ({
  // State
  connectionStatus: 'disconnected',
  client: null,
  error: null,
  sessions: [],
  activeSessionKey: null,
  messages: [],
  isStreaming: false,
  activityItems: [],

  // Actions
  connect: async (config) => {
    const existing = get().client;
    if (existing) {
      existing.disconnect();
    }

    const client = new GatewayClient({ url: config.url, token: config.auth });

    // Track status changes
    client.onStatusChange((status) => {
      set({ connectionStatus: status });
      if (status === 'error') {
        set({ error: 'Connection error' });
      }
    });

    // Wire up events
    wireEvents(client, set);

    set({ client, connectionStatus: 'connecting', error: null });

    try {
      const hello = await client.connect();
      const mainSessionKey = hello.snapshot.sessionDefaults?.mainSessionKey ?? null;
      set({
        connectionStatus: 'connected',
        error: null,
        activeSessionKey: mainSessionKey,
      });

      // Auto-load chat history for the main session
      if (mainSessionKey) {
        get()
          .loadHistory(mainSessionKey)
          .catch(() => {
            // History load is best-effort; connection is already live
          });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      set({ error: message, connectionStatus: 'error' });
    }
  },

  disconnect: () => {
    const client = get().client;
    if (client) {
      client.disconnect();
    }
    set({
      client: null,
      connectionStatus: 'disconnected',
      error: null,
      isStreaming: false,
    });
  },

  sendMessage: async (text) => {
    const { client, activeSessionKey } = get();
    if (!client || !activeSessionKey) {
      throw new Error('No active session or not connected');
    }

    // Optimistically add the user message to the list
    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    set((state) => ({ messages: [...state.messages, userMsg] }));

    // Send via gateway (non-blocking — response streams via chat events)
    const idempotencyKey = `${activeSessionKey}-${Date.now()}`;
    await client.request('chat.send', {
      sessionKey: activeSessionKey,
      message: text,
      idempotencyKey,
    });
  },

  selectSession: (sessionKey) => {
    set({ activeSessionKey: sessionKey, messages: [], activityItems: [] });
  },

  refreshSessions: async () => {
    const client = get().client;
    if (!client) return;

    const result = (await client.request('sessions.list', {
      includeDerivedTitles: true,
      includeLastMessage: true,
    })) as { sessions: SessionSummary[] };

    set({ sessions: result.sessions });
  },

  loadHistory: async (sessionKey) => {
    const client = get().client;
    if (!client) return;

    const result = (await client.request('chat.history', {
      sessionKey,
      limit: 50,
    })) as ChatHistoryResult;

    // Normalise content — gateway may return array-of-blocks format
    const normalised = result.messages.map((m) => ({
      ...m,
      content: normaliseContent(m.content),
    }));
    set({ messages: normalised });
  },
}));

// ---------------------------------------------------------------------------
// Event wiring — connects gateway events to store updates
// ---------------------------------------------------------------------------

type StoreSetter = (
  partial: Partial<GatewayState> | ((state: GatewayStore) => Partial<GatewayState>),
) => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise message content from the gateway.
 *
 * OpenClaw may return `content` as a string **or** as an array of
 * `{ type: "text", text: "..." }` blocks (OpenAI/Anthropic format).
 * We flatten it to a plain string so the rest of the app doesn't
 * need to care.
 */
function normaliseContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: Record<string, unknown>) => b.type === 'text')
      .map((b: Record<string, unknown>) => b.text)
      .join('');
  }
  return String(content ?? '');
}

function wireEvents(client: GatewayClient, set: StoreSetter): void {
  // Chat streaming events
  client.on('chat', (raw) => {
    const payload = raw as ChatEventPayload;

    if (payload.state === 'delta' && payload.message) {
      // Append delta text to the last assistant message, or create one
      set((state) => {
        const msgs = [...state.messages];
        const last = msgs[msgs.length - 1];

        if (last && last.role === 'assistant') {
          msgs[msgs.length - 1] = {
            ...last,
            content: last.content + payload.message,
          };
        } else {
          msgs.push({
            role: 'assistant',
            content: payload.message!,
            timestamp: Date.now(),
          });
        }
        return { messages: msgs, isStreaming: true };
      });
    }

    if (payload.state === 'final' && payload.message) {
      // Replace the streaming message with the final version
      set((state) => {
        const msgs = [...state.messages];
        const lastIdx = msgs.length - 1;
        const last = msgs[lastIdx];

        if (last && last.role === 'assistant') {
          msgs[lastIdx] = { ...last, content: payload.message! };
        } else {
          msgs.push({
            role: 'assistant',
            content: payload.message!,
            timestamp: Date.now(),
          });
        }
        return { messages: msgs, isStreaming: false };
      });
    }

    if (payload.state === 'aborted') {
      set({ isStreaming: false });
    }

    if (payload.state === 'error') {
      set({ isStreaming: false });
      set((state) => ({
        activityItems: [
          ...state.activityItems,
          {
            id: nextActivityId(),
            type: 'error' as const,
            title: 'Chat error',
            detail: payload.errorMessage ?? 'Unknown error',
            timestamp: Date.now(),
          },
        ],
      }));
    }
  });

  // Agent tool-call events
  client.on('agent', (raw) => {
    const payload = raw as AgentEventPayload;

    set((state) => ({
      activityItems: [
        ...state.activityItems,
        {
          id: nextActivityId(),
          type: 'tool_call' as const,
          title: payload.stream,
          detail: JSON.stringify(payload.data),
          timestamp: payload.ts,
        },
      ],
    }));
  });
}

// ---------------------------------------------------------------------------
// React hook wrapper (convenience)
// ---------------------------------------------------------------------------

/**
 * React hook for the gateway store.
 *
 * Usage:
 *   const status = useGatewayStore((s) => s.connectionStatus);
 */
export function useGatewayStore<T>(selector: (state: GatewayStore) => T): T {
  return useStore(gatewayStore, selector);
}
