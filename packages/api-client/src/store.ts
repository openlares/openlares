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
import { stripMetadataEnvelope } from '@openlares/core';
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

/** Activity state for a session. */
export interface SessionActivity {
  /** Whether the session has an active run right now. */
  active: boolean;
  /** When the run started (ms since epoch). */
  startedAt: number;
  /** When the run ended (0 if still active). */
  endedAt: number;
  /** Name of the tool currently in use (only while active). */
  toolName?: string;
  /** Timestamp of the last tool event (for badge TTL). */
  toolTs?: number;
}

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
  /** Per-session last tool activity (for canvas badges). */
  sessionActivities: Record<string, SessionActivity>;
  /** Map runId -> sessionKey for correlating agent events. */
  runIdToSession: Record<string, string>;
  /** Whether the chat panel should be visible. */
  showChat: boolean;
  /** Whether older messages exist beyond what is loaded. */
  hasMoreHistory: boolean;
  /** Whether a history load is in progress. */
  historyLoading: boolean;
  /** Current history limit (grows on scroll-up). */
  historyLimit: number;
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
  /** Load older messages (increases limit and re-fetches). */
  loadMoreHistory: () => Promise<void>;
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
  sessionActivities: {},
  runIdToSession: {},
  showChat: false,
  hasMoreHistory: true,
  historyLoading: false,
  historyLimit: 20,

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
    stopAllToolPolls();
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
    set({
      activeSessionKey: sessionKey,
      messages: [],
      activityItems: [],
      isStreaming: false,
      showChat: true,
      hasMoreHistory: true,
      historyLoading: false,
      historyLimit: 20,
    });
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

    // Seed activity state for sessions that are currently active
    // (restores activity indicators after page refresh)
    const recentCutoff = 2 * 60 * 1000; // 2 minutes
    const now = Date.now();
    for (const s of sessions) {
      const isRecentlyActive = s.active || now - s.updatedAt < recentCutoff;
      if (isRecentlyActive && !gatewayStore.getState().sessionActivities[s.sessionKey]?.active) {
        set((state) => ({
          sessionActivities: {
            ...state.sessionActivities,
            [s.sessionKey]: {
              active: true,
              startedAt: s.updatedAt || now,
              endedAt: 0,
            },
          },
        }));
        startToolPoll(s.sessionKey, client, set);
      }
    }
  },

  loadHistory: async (sessionKey) => {
    const client = get().client;
    if (!client) return;

    const limit = get().historyLimit;
    set({ historyLoading: true });

    const result = (await client.request('chat.history', {
      sessionKey,
      limit,
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
        content:
          m.role === 'user'
            ? stripMetadataEnvelope(m.content as string)
            : cleanMessageContent(m.content as string),
      }))
      .filter((m) => (m.content as string).trim().length > 0);
    set({
      messages: filtered,
      historyLoading: false,
      // If we got fewer raw messages than requested, we've reached the start
      hasMoreHistory: result.messages.length >= limit,
    });
  },

  loadMoreHistory: async () => {
    const { activeSessionKey, hasMoreHistory, historyLoading, historyLimit } = get();
    if (!activeSessionKey || !hasMoreHistory || historyLoading) return;

    // Double the limit and re-fetch
    const newLimit = Math.min(historyLimit * 2, 200);
    set({ historyLimit: newLimit });

    await get().loadHistory(activeSessionKey);
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
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
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

// ---------------------------------------------------------------------------
// Live session discovery — debounced refresh after new sessions appear
// ---------------------------------------------------------------------------

let sessionRefreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Schedule a debounced refreshSessions() call (1s). */
function scheduleSessionRefresh(): void {
  if (sessionRefreshTimer) return;
  sessionRefreshTimer = setTimeout(async () => {
    sessionRefreshTimer = null;
    await gatewayStore.getState().refreshSessions();
  }, 1_000);
}

// ---------------------------------------------------------------------------
// Tool activity polling — for sessions without direct tool event subscriptions
// ---------------------------------------------------------------------------

/** Interval handles for active tool polling. */
const toolPollIntervals = new Map<string, ReturnType<typeof setInterval>>();

/** Sessions that receive direct tool events (via chat.send caps). */
const directToolEventSessions = new Set<string>();

/** Last seen message key per session — skip state updates when nothing changed. */
const lastSeenPollKey = new Map<string, string>();

/** Polling interval in ms. */
const TOOL_POLL_INTERVAL_MS = 2_000;

/**
 * Extract the latest tool name from chat history messages.
 *
 * Scans from end to beginning. Handles multiple gateway formats:
 * - `toolResult` role messages (have `toolName` directly)
 * - Content blocks with `type: "toolCall"` / `"tool_use"` / `"tool_call"` and `name`
 */
export function extractLatestToolName(messages: unknown[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown>;
    if (!msg) continue;

    // Gateway stores tool results as role="toolResult" with toolName field
    if (msg.role === 'toolResult' && typeof msg.toolName === 'string') {
      return msg.toolName;
    }

    // Check content blocks for tool call types
    const content = msg.content;
    if (Array.isArray(content)) {
      for (let j = content.length - 1; j >= 0; j--) {
        const block = content[j] as { type?: string; name?: string };
        if (
          block?.type &&
          ['toolcall', 'tool_call', 'tooluse', 'tool_use'].includes(block.type.toLowerCase()) &&
          typeof block.name === 'string'
        ) {
          return block.name;
        }
      }
    }
  }
  return undefined;
}

/** Start polling chat.history for a session's tool activity. */
function startToolPoll(sessionKey: string, client: GatewayClient, set: StoreSetter): void {
  if (toolPollIntervals.has(sessionKey)) return; // already polling
  if (directToolEventSessions.has(sessionKey)) return; // has direct events

  const poll = async () => {
    // Stop if session is no longer active or stale (no lifecycle end received)
    const activity = gatewayStore.getState().sessionActivities[sessionKey];
    if (!activity?.active) {
      stopToolPoll(sessionKey);
      return;
    }
    // Safety: if active for > 90s without lifecycle end, assume session finished.
    // Passive sessions often don't receive lifecycle end events.
    const staleCutoff = 90 * 1000;
    if (activity.startedAt > 0 && Date.now() - activity.startedAt > staleCutoff) {
      // Mark as ended — lifecycle end was probably missed
      set((state) => ({
        sessionActivities: {
          ...state.sessionActivities,
          [sessionKey]: {
            ...state.sessionActivities[sessionKey],
            active: false,
            startedAt: state.sessionActivities[sessionKey]?.startedAt ?? 0,
            endedAt: Date.now(),
          },
        },
      }));
      stopToolPoll(sessionKey);
      return;
    }

    try {
      const result = (await client.request('chat.history', {
        sessionKey,
        limit: 2,
      })) as { messages?: unknown[] };

      if (result?.messages && Array.isArray(result.messages)) {
        // Timestamp guard: skip state updates if nothing changed since last poll
        const lastMsg = result.messages[result.messages.length - 1] as
          | Record<string, unknown>
          | undefined;
        const msgKey = lastMsg
          ? String(lastMsg.id ?? lastMsg.timestamp ?? JSON.stringify(lastMsg))
          : '';
        if (msgKey && lastSeenPollKey.get(sessionKey) === msgKey) return;
        if (msgKey) lastSeenPollKey.set(sessionKey, msgKey);

        const toolName = extractLatestToolName(result.messages);
        if (toolName) {
          set((state) => ({
            sessionActivities: {
              ...state.sessionActivities,
              [sessionKey]: {
                ...state.sessionActivities[sessionKey],
                active: state.sessionActivities[sessionKey]?.active ?? true,
                startedAt: state.sessionActivities[sessionKey]?.startedAt ?? Date.now(),
                endedAt: state.sessionActivities[sessionKey]?.endedAt ?? 0,
                toolName,
                toolTs: Date.now(),
              },
            },
          }));
        }
      }
    } catch {
      // Ignore poll errors — session may have ended
    }
  };

  // Poll immediately, then on interval
  poll();
  toolPollIntervals.set(sessionKey, setInterval(poll, TOOL_POLL_INTERVAL_MS));
}

/** Stop polling for a session. */
function stopToolPoll(sessionKey: string): void {
  const interval = toolPollIntervals.get(sessionKey);
  if (interval) {
    clearInterval(interval);
    toolPollIntervals.delete(sessionKey);
  }
  lastSeenPollKey.delete(sessionKey);
}

/** Stop all active polls (e.g. on disconnect). */
function stopAllToolPolls(): void {
  for (const [sk] of toolPollIntervals) {
    stopToolPoll(sk);
  }
  directToolEventSessions.clear();
  lastSeenPollKey.clear();
  if (sessionRefreshTimer) {
    clearTimeout(sessionRefreshTimer);
    sessionRefreshTimer = null;
  }
}

function wireEvents(client: GatewayClient, set: StoreSetter): void {
  // Chat streaming events
  client.on('chat', (raw) => {
    const payload = raw as ChatEventPayload;

    // Track runId -> sessionKey for correlating agent events
    if (payload.runId && payload.sessionKey) {
      set((state) => ({
        runIdToSession: { ...state.runIdToSession, [payload.runId]: payload.sessionKey },
      }));
    }

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

    // Track per-session activity from lifecycle events
    if (payload.stream === 'lifecycle') {
      const sk = payload.sessionKey || gatewayStore.getState().runIdToSession[payload.runId];
      if (sk && payload.data.phase === 'start') {
        set((state) => {
          const exists = state.sessions.some((s) => s.sessionKey === sk);
          const update: Partial<GatewayState> = {
            sessionActivities: {
              ...state.sessionActivities,
              [sk]: { active: true, startedAt: payload.ts, endedAt: 0 },
            },
          };
          // Live session discovery: add unknown sessions immediately
          if (!exists) {
            update.sessions = [
              ...state.sessions,
              { sessionKey: sk, title: '', active: true, updatedAt: Date.now() },
            ];
            // Schedule a refresh to pick up the proper title
            scheduleSessionRefresh();
          }
          return update;
        });
        // Start polling for tool activity if no direct tool events
        startToolPoll(sk, client, set);
      }
      if (sk && payload.data.phase === 'end') {
        set((state) => ({
          sessionActivities: {
            ...state.sessionActivities,
            [sk]: {
              active: false,
              startedAt: state.sessionActivities[sk]?.startedAt || 0,
              endedAt: payload.ts,
            },
          },
        }));
        stopToolPoll(sk);
      }
    }

    // Track per-session tool names from tool events (direct path)
    if (payload.stream === 'tool' && payload.data.phase === 'start' && payload.data.name) {
      const sk = payload.sessionKey || gatewayStore.getState().runIdToSession[payload.runId];
      if (sk) {
        // Mark as having direct tool events — stop polling
        directToolEventSessions.add(sk);
        stopToolPoll(sk);
        set((state) => ({
          sessionActivities: {
            ...state.sessionActivities,
            [sk]: {
              ...state.sessionActivities[sk],
              active: state.sessionActivities[sk]?.active ?? true,
              startedAt: state.sessionActivities[sk]?.startedAt ?? payload.ts,
              endedAt: state.sessionActivities[sk]?.endedAt ?? 0,
              toolName: payload.data.name,
              toolTs: payload.ts,
            },
          },
        }));
      }
    }

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
