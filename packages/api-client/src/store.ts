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
// Session name cleaning
// ---------------------------------------------------------------------------

/**
 * Clean session names for display.
 * Extracts meaningful names from gateway session identifiers.
 */
export function cleanSessionName(session: SessionSummary): string {
  const { sessionKey, title } = session;

  // Use title if available, otherwise clean the session key
  const displayName = title || sessionKey;

  // Clean discord sessions
  if (displayName.includes('discord:')) {
    // Extract channel name after #
    const channelMatch = displayName.match(/#([^#]+)$/);
    if (channelMatch) {
      return `#${channelMatch[1]}`;
    }

    // Handle special cases like "discord:g-agent-main-main"
    if (displayName.includes('g-agent-main-main')) {
      return 'Main';
    }
  }

  // Clean cron jobs
  if (displayName.startsWith('Cron: ')) {
    return displayName.substring(6);
  }

  // Add robot emoji for subagents
  if (sessionKey.includes('subagent')) {
    const cleaned = title || sessionKey;
    return `🤖 ${cleaned}`;
  }

  // Fallback to raw display name or session key
  return displayName;
}

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
  /** Whether the chat panel should be visible. */
  showChat: boolean;
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
  /** Show the chat panel. */
  openChat: () => void;
  /** Hide the chat panel. */
  closeChat: () => void;
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
  showChat: false,

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

      // Auto-refresh sessions after successful connection
      get()
        .refreshSessions()
        .catch(() => {
          // Sessions refresh is best-effort
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
    set({ activeSessionKey: sessionKey, messages: [], activityItems: [], showChat: true });
    get()
      .loadHistory(sessionKey)
      .catch(() => {
        // History load is best-effort
      });
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

    // Filter out system noise
    const filtered = normalised.filter(shouldDisplayMessage);
    set({ messages: filtered });
  },

  openChat: () => {
    set({ showChat: true });
  },

  closeChat: () => {
    set({ showChat: false });
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
 * Filter out system noise from chat messages.
 *
 * Removes heartbeat prompts, system events, tool call metadata, and other
 * OpenClaw-internal messages that shouldn't be displayed in the chat UI.
 *
 * @param message The message to check
 * @returns true if the message should be kept, false if it should be filtered out
 */
export function shouldDisplayMessage(message: ChatMessage): boolean {
  const content = normaliseContent(message.content);

  // Skip system messages
  if (message.role === 'system') {
    return false;
  }

  // Skip heartbeat-related user messages
  if (message.role === 'user') {
    if (content.includes('Read HEARTBEAT.md') || content.includes('HEARTBEAT_OK')) {
      return false;
    }
    // Skip metadata envelope messages
    if (content.startsWith('Conversation info (untrusted metadata)')) {
      return false;
    }
  }

  // Skip assistant heartbeat/no-reply responses
  if (message.role === 'assistant') {
    const trimmed = content.trim();
    if (trimmed === 'HEARTBEAT_OK' || trimmed === 'NO_REPLY') {
      return false;
    }
  }

  return true;
}

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
          const newMessage: ChatMessage = {
            role: 'assistant',
            content: payload.message!,
            timestamp: Date.now(),
          };
          // Only add if it would pass the filter (but allow partial content during streaming)
          msgs.push(newMessage);
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

        const finalMessage: ChatMessage = {
          role: 'assistant',
          content: payload.message!,
          timestamp: Date.now(),
        };

        // Check if final message should be displayed
        if (!shouldDisplayMessage(finalMessage)) {
          // Remove the streaming message if the final version shouldn't be displayed
          if (last && last.role === 'assistant') {
            msgs.pop();
          }
          return { messages: msgs, isStreaming: false };
        }

        if (last && last.role === 'assistant') {
          msgs[lastIdx] = finalMessage;
        } else {
          msgs.push(finalMessage);
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
