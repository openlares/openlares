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
    set({ activeSessionKey: sessionKey, messages: [], activityItems: [], isStreaming: false, showChat: true });
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
      activeMinutes: 1440, // Last 24 hours
      limit: 20,
    })) as { sessions: Record<string, unknown>[] };

    // Gateway returns `key` but our type uses `sessionKey` — normalise
    const sessions: SessionSummary[] = result.sessions.map((s) => ({
      sessionKey: (s.sessionKey ?? s.key ?? '') as string,
      title: (s.title ?? s.displayName ?? '') as string,
      lastMessage: (s.lastMessage ?? '') as string,
      active: Boolean(s.active),
      createdAt: (s.createdAt ?? 0) as number,
      updatedAt: (s.updatedAt ?? 0) as number,
    }));

    set({ sessions });
  },

  loadHistory: async (sessionKey) => {
    const client = get().client;
    if (!client) return;

    const result = (await client.request('chat.history', {
      sessionKey,
      limit: 50,
    })) as ChatHistoryResult;

    // Normalise and clean content
    const normalised = result.messages.map((m) => ({
      ...m,
      content: normaliseContent(m.content),
    }));

    // Filter out system noise, then clean remaining messages
    const filtered = normalised
      .filter(shouldDisplayMessage)
      .map((m) => ({
        ...m,
        content: m.role === 'user'
          ? stripMetadataEnvelope(m.content as string)
          : cleanMessageContent(m.content as string),
      }))
      .filter((m) => (m.content as string).trim().length > 0);
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
 * Strip OpenClaw metadata envelope from user messages.
 * Gateway stores Discord messages with conversation/sender metadata prepended.
 */
function stripMetadataEnvelope(content: string): string {
  // Match optional Conversation info block, optional Sender block, then capture the rest
  const parts: string[] = [];
  let remaining = content;

  // Try to strip "Conversation info" block
  const convPattern = /^Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*/;
  const convMatch = remaining.match(convPattern);
  if (convMatch) {
    remaining = remaining.slice(convMatch[0].length);
  }

  // Try to strip "Sender" block
  const senderPattern = /^Sender \(untrusted metadata\):\s*```json[\s\S]*?```\s*/;
  const senderMatch = remaining.match(senderPattern);
  if (senderMatch) {
    remaining = remaining.slice(senderMatch[0].length);
  }

  return remaining.trim();
}

/**
 * Clean message content for display.
 *
 * Strips tool call/result markers and metadata that OpenClaw embeds
 * in session transcripts. Mirrors the approach used by OpenClaw's
 * built-in control-ui.
 */
export function cleanMessageContent(content: string): string {
  const lines = content.split('\n');
  const cleaned: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip tool call markers: [Tool: exec], [Tool: read], etc.
    if (/^\[Tool:\s*[^\]]+\]/.test(trimmed)) continue;

    // Skip tool result markers
    if (trimmed.startsWith('[Tool Result]')) continue;

    // Skip tool use blocks (Anthropic format)
    if (trimmed.startsWith('[tool_use:')) continue;
    if (trimmed.startsWith('[tool_result:')) continue;

    cleaned.push(line);
  }

  return cleaned.join('\n').trim();
}

/**
 * Check if content is primarily machine data (JSON, huge tool output)
 * rather than human-readable text.
 */
function isMachineData(content: string): boolean {
  const trimmed = content.trim();

  // Pure JSON object or array
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      // Not valid JSON, might be human text that starts with {
    }
  }

  return false;
}

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

  // Skip system and tool messages
  if (message.role === 'system' || message.role === 'tool') {
    return false;
  }

  // Skip assistant messages that contain tool_calls (not human text)
  if (message.role === 'assistant' && typeof message.content === 'object') {
    return false;
  }

  // Skip heartbeat-related user messages
  if (message.role === 'user') {
    if (content.includes('Read HEARTBEAT.md') || content.includes('HEARTBEAT_OK')) {
      return false;
    }
    // Strip metadata envelope, then check if there's actual user content
    const stripped = stripMetadataEnvelope(content);
    if (!stripped || stripped.length === 0) {
      return false;
    }
  }

  // Skip messages that are pure machine data (JSON dumps, tool output)
  if (message.role === 'assistant') {
    const cleaned = cleanMessageContent(content);
    if (isMachineData(cleaned)) {
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

    // Only process events for the currently viewed session
    const { activeSessionKey } = gatewayStore.getState();
    if (payload.sessionKey !== activeSessionKey) return;

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
