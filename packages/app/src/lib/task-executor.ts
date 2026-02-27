/**
 * Task executor — connects tasks to OpenClaw agent sessions.
 *
 * Polls for claimable tasks in assistant-owned queues,
 * dispatches them via chat.send, and monitors completion.
 * Agent signals completion via "MOVE TO: <queue name>" in its last message.
 */

import { getDb } from './db';
import { emit } from './task-events';
import {
  getDashboard,
  getNextClaimableTask,
  claimTask,
  setTaskError,
  releaseTask,
  moveTask,
  getTask,
  listTransitions,
  listQueues,
  addComment,
  listComments,
  type OpenlareDb,
} from '@openlares/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExecutorState {
  running: boolean;
  currentTaskId: string | null;
  currentSessionKey: string | null;
  dispatchTime: number | null;
  pollTimer: ReturnType<typeof setTimeout> | null;
  monitorTimer: ReturnType<typeof setTimeout> | null;
}

interface GatewayConfig {
  url: string;
  token: string;
}

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

// Persist state across HMR in dev mode
const g = globalThis as unknown as { __executorState?: ExecutorState };
if (!g.__executorState) {
  g.__executorState = {
    running: false,
    currentTaskId: null,
    currentSessionKey: null,
    dispatchTime: null,
    pollTimer: null,
    monitorTimer: null,
  };
}
const state = g.__executorState;

const POLL_INTERVAL_MS = 5_000;
const MONITOR_INTERVAL_MS = 3_000;
const EXECUTION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const AGENT_ID = 'main';

// ---------------------------------------------------------------------------
// Gateway communication (server-side, WebSocket)
// ---------------------------------------------------------------------------

import { GatewayClient } from '@openlares/api-client';
import { getServerDeviceIdentity } from '@openlares/api-client/server-identity';

let gatewayConfig: GatewayConfig | null = null;
let gatewayClient: GatewayClient | null = null;

export function configureGateway(config: GatewayConfig): void {
  // Disconnect old client if config changed
  if (
    gatewayClient &&
    gatewayConfig &&
    (gatewayConfig.url !== config.url || gatewayConfig.token !== config.token)
  ) {
    gatewayClient.disconnect();
    gatewayClient = null;
  }
  gatewayConfig = config;
}

async function ensureGatewayConnected(): Promise<GatewayClient> {
  if (!gatewayConfig) throw new Error('Gateway not configured');

  if (gatewayClient) {
    // Already connected
    return gatewayClient;
  }

  // Allow self-signed certs for LAN setups
  if (gatewayConfig.url.startsWith('wss://')) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const serverIdentity = await getServerDeviceIdentity();
  const client = new GatewayClient({
    url: gatewayConfig.url,
    token: gatewayConfig.token,
    origin: 'https://localhost:3000',
    serverDeviceIdentity: serverIdentity,
  });

  await client.connect();
  gatewayClient = client;
  return client;
}

async function gatewayRpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const client = await ensureGatewayConnected();
  return client.request(method, params);
}

// ---------------------------------------------------------------------------
// Executor lifecycle
// ---------------------------------------------------------------------------

export function getExecutorStatus() {
  return {
    running: state.running,
    currentTaskId: state.currentTaskId,
    currentSessionKey: state.currentSessionKey,
    dispatchTime: state.dispatchTime,
  };
}

export function startExecutor(dashboardId: string): void {
  // Clear any stale timers (HMR can kill setTimeout chains while globalThis state persists)
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
  if (state.monitorTimer) {
    clearTimeout(state.monitorTimer);
    state.monitorTimer = null;
  }
  state.running = true;
  emit({ type: 'executor:started', timestamp: Date.now() });
  pollForWork(dashboardId);
}

export function stopExecutor(): void {
  state.running = false;
  state.dispatchTime = null;
  if (gatewayClient) {
    gatewayClient.disconnect();
    gatewayClient = null;
  }
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
  if (state.monitorTimer) {
    clearTimeout(state.monitorTimer);
    state.monitorTimer = null;
  }
  emit({ type: 'executor:stopped', timestamp: Date.now() });
}

// ---------------------------------------------------------------------------
// Poll loop — find and claim tasks
// ---------------------------------------------------------------------------

function pollForWork(dashboardId: string): void {
  if (!state.running) return;

  // Don't poll if we're already working on something
  if (state.currentTaskId) {
    state.pollTimer = setTimeout(() => pollForWork(dashboardId), POLL_INTERVAL_MS);
    return;
  }

  const db = getDb();
  const task = getNextClaimableTask(db, dashboardId);

  if (task) {
    const sessionKey = `openlares:task:${task.id}`;
    const claimed = claimTask(db, task.id, AGENT_ID, sessionKey);

    if (claimed) {
      state.currentTaskId = task.id;
      state.currentSessionKey = sessionKey;
      emit({ type: 'task:claimed', taskId: task.id, timestamp: Date.now() });

      // Fire and forget — dispatch async, don't await
      void dispatchTask(db, claimed, sessionKey, dashboardId);
    }
  }

  state.pollTimer = setTimeout(() => pollForWork(dashboardId), POLL_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Task dispatch — send to OpenClaw via chat.send
// ---------------------------------------------------------------------------

interface BuildPromptInput {
  title: string;
  description: string | null;
  comments: Array<{ authorType: string; content: string }>;
  currentQueueName: string;
  destinations: Array<{ name: string; description: string | null }>;
}

function buildPrompt(input: BuildPromptInput): string {
  let prompt = `# Task: ${input.title}\n\n`;
  if (input.description) {
    prompt += `${input.description}\n\n`;
  }

  // Add conversation history
  if (input.comments.length > 0) {
    prompt += `## Previous conversation:\n`;
    for (const c of input.comments) {
      prompt += `[${c.authorType}]: ${c.content}\n`;
    }
    prompt += `\n`;
  }

  // Add routing instructions
  if (input.destinations.length > 0) {
    prompt += `## Available destinations from "${input.currentQueueName}":\n`;
    for (const d of input.destinations) {
      prompt += `- **${d.name}**${d.description ? ` \u2014 ${d.description}` : ''}\n`;
    }
    prompt += `\nWhen finished, end your message with: MOVE TO: <queue name>\n`;
    prompt += `If you cannot determine the right destination, end with: MOVE TO: STUCK\n`;
  } else {
    prompt += `When you have completed this task, end your message with: MOVE TO: DONE\n`;
  }

  return prompt;
}

async function dispatchTask(
  db: OpenlareDb,
  task: {
    id: string;
    title: string;
    description: string | null;
    dashboardId: string;
    queueId: string;
  },
  sessionKey: string,
  dashboardId: string,
): Promise<void> {
  try {
    const allQueues = listQueues(db, dashboardId);
    const currentQueue = allQueues.find((q) => q.id === task.queueId);
    const dashboardTransitions = listTransitions(db, dashboardId);
    const availableTransitions = dashboardTransitions.filter(
      (t) =>
        t.fromQueueId === task.queueId && (t.actorType === 'assistant' || t.actorType === 'both'),
    );
    const destinations = availableTransitions
      .map((t) => allQueues.find((q) => q.id === t.toQueueId))
      .filter(Boolean)
      .map((q) => ({ name: q!.name, description: q!.description }));

    const comments = listComments(db, task.id);

    const prompt = buildPrompt({
      title: task.title,
      description: task.description,
      comments: comments.map((c) => ({ authorType: c.authorType, content: c.content })),
      currentQueueName: currentQueue?.name ?? 'Unknown',
      destinations,
    });

    await gatewayRpc('chat.send', {
      idempotencyKey: crypto.randomUUID(),
      sessionKey,
      message: prompt,
    });

    state.dispatchTime = Date.now();

    // Start monitoring this session
    monitorSession(db, task.id, sessionKey, dashboardId);
  } catch (err) {
    console.error(`[task-executor] Failed to dispatch task ${task.id}:`, err);
    setTaskError(db, task.id, String(err));
    emit({ type: 'task:updated', taskId: task.id, timestamp: Date.now() });
    state.currentTaskId = null;
    state.currentSessionKey = null;
    state.dispatchTime = null;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Extract plain text from assistant message content (string or content blocks). */
export function extractContent(messageContent: unknown): string {
  if (typeof messageContent === 'string') return messageContent;
  if (Array.isArray(messageContent)) {
    return (messageContent as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text)
      .join('\n');
  }
  return '';
}

/** Parse MOVE TO directive from content. Returns null if not found. */
export function parseMoveDirective(content: string): string | null {
  const match = content.match(/MOVE TO:\s*([\w][\w -]*)/im);
  if (!match) return null;
  return (match[1] ?? '').trim() || null;
}

/** Extract agent response text (everything before MOVE TO:). */
export function extractResponseText(messageContent: unknown): string | null {
  if (typeof messageContent === 'string') {
    return messageContent.replace(/MOVE TO:\s*.+$/im, '').trim() || null;
  }
  if (Array.isArray(messageContent)) {
    const parts = (messageContent as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!.replace(/MOVE TO:\s*.+$/im, '').trim())
      .filter(Boolean);
    return parts.join('\n\n') || null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Session monitor — check if agent finished
// ---------------------------------------------------------------------------

function monitorSession(
  db: OpenlareDb,
  taskId: string,
  sessionKey: string,
  dashboardId: string,
): void {
  if (!state.running) return;

  void checkSessionCompletion(db, taskId, sessionKey, dashboardId);
}

async function checkSessionCompletion(
  db: OpenlareDb,
  taskId: string,
  sessionKey: string,
  dashboardId: string,
): Promise<void> {
  try {
    const result = (await gatewayRpc('chat.history', {
      sessionKey,
      limit: 5,
    })) as { messages?: Array<{ role: string; content: unknown }> } | null;

    const messages = result?.messages ?? [];

    // Look at the last assistant message
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');

    if (lastAssistant) {
      const content = extractContent(lastAssistant.content);

      // Check timeout first
      if (state.dispatchTime && Date.now() - state.dispatchTime > EXECUTION_TIMEOUT_MS) {
        let lastMsg = '';
        const rawContent =
          typeof lastAssistant.content === 'string'
            ? lastAssistant.content
            : Array.isArray(lastAssistant.content)
              ? (lastAssistant.content as Array<{ type: string; text?: string }>)
                  .filter((c) => c.type === 'text' && c.text)
                  .map((c) => c.text)
                  .join('\n')
              : '';
        lastMsg = rawContent.slice(0, 500);
        const errorMsg = `Execution timeout (30m)${lastMsg ? `\n\nLast agent message:\n> ${lastMsg}` : ''}`;
        addComment(db, taskId, 'system', 'agent', `\u26a0\ufe0f ${errorMsg}`);
        emit({ type: 'task:comment', taskId, timestamp: Date.now() });
        setTaskError(db, taskId, errorMsg);
        emit({ type: 'task:updated', taskId, timestamp: Date.now() });
        state.currentTaskId = null;
        state.currentSessionKey = null;
        state.dispatchTime = null;
        return;
      }

      // Parse MOVE TO: <queue name> from content
      const targetName = parseMoveDirective(content);
      if (targetName) {
        // Extract agent response text (everything before MOVE TO:)
        const resultText = extractResponseText(lastAssistant.content);

        // Save agent response as comment
        if (resultText) {
          addComment(db, taskId, AGENT_ID, 'agent', resultText);
          emit({ type: 'task:comment', taskId, timestamp: Date.now() });
        }

        const task = getTask(db, taskId);
        if (!task) {
          state.currentTaskId = null;
          state.currentSessionKey = null;
          state.dispatchTime = null;
          return;
        }

        // Handle STUCK
        if (targetName.toUpperCase() === 'STUCK') {
          setTaskError(db, taskId, "Agent couldn't determine destination queue");
          emit({ type: 'task:updated', taskId, timestamp: Date.now() });
          state.currentTaskId = null;
          state.currentSessionKey = null;
          state.dispatchTime = null;
          return;
        }

        // Find target queue by name FIRST (case-insensitive).
        // Must happen before the DONE fallback so that a real queue
        // named "Done" is matched instead of hitting the fallback path.
        const allQueues = listQueues(db, task.dashboardId);
        const targetQueue = allQueues.find(
          (q) => q.name.toLowerCase() === targetName.toLowerCase(),
        );
        const dashboardTransitions = listTransitions(db, task.dashboardId);

        const dashConfig = getDashboard(db, task.dashboardId);
        const strict = dashConfig?.config?.strictTransitions ?? false;

        // Fallback: DONE with no matching queue (used when no destinations configured)
        if (!targetQueue && targetName.toUpperCase() === 'DONE') {
          releaseTask(db, taskId);
          emit({ type: 'task:updated', taskId, timestamp: Date.now() });
          state.currentTaskId = null;
          state.currentSessionKey = null;
          state.dispatchTime = null;
          return;
        }

        if (targetQueue) {
          if (strict) {
            // Validate transition exists under strict mode
            const validTransition = dashboardTransitions.find(
              (t) =>
                t.fromQueueId === task.queueId &&
                t.toQueueId === targetQueue.id &&
                (t.actorType === 'assistant' || t.actorType === 'both'),
            );

            if (validTransition) {
              moveTask(db, taskId, targetQueue.id, AGENT_ID, `Agent routed to ${targetQueue.name}`);
              emit({ type: 'task:moved', taskId, timestamp: Date.now() });
            } else {
              // Valid queue name but no transition — fallback
              setTaskError(
                db,
                taskId,
                `No valid transition to "${targetQueue.name}" from current queue`,
              );
              emit({ type: 'task:updated', taskId, timestamp: Date.now() });
            }
          } else {
            // Free movement — just move it
            moveTask(db, taskId, targetQueue.id, AGENT_ID, `Agent routed to ${targetQueue.name}`);
            emit({ type: 'task:moved', taskId, timestamp: Date.now() });
          }
        } else {
          if (strict) {
            // Unknown queue name — fallback to first reachable human queue via transitions
            const humanTransition = dashboardTransitions.find(
              (t) =>
                t.fromQueueId === task.queueId &&
                (t.actorType === 'assistant' || t.actorType === 'both') &&
                allQueues.find((q) => q.id === t.toQueueId && q.ownerType === 'human'),
            );
            if (humanTransition) {
              const fallbackQueue = allQueues.find((q) => q.id === humanTransition.toQueueId)!;
              moveTask(
                db,
                taskId,
                fallbackQueue.id,
                AGENT_ID,
                `Agent output: "${targetName}" (unknown queue, routed to ${fallbackQueue.name})`,
              );
              emit({ type: 'task:moved', taskId, timestamp: Date.now() });
            } else {
              setTaskError(db, taskId, `Unknown destination queue: "${targetName}"`);
              emit({ type: 'task:updated', taskId, timestamp: Date.now() });
            }
          } else {
            // Free movement but unknown queue name — error
            setTaskError(db, taskId, `Unknown destination queue: "${targetName}"`);
            emit({ type: 'task:updated', taskId, timestamp: Date.now() });
          }
        }

        releaseTask(db, taskId);
        state.currentTaskId = null;
        state.currentSessionKey = null;
        state.dispatchTime = null;
        return;
      }
    }

    // No completion signal yet — keep polling
  } catch (err) {
    console.error(`[task-executor] Monitor error for task ${taskId}:`, err);
  }

  // Schedule next check
  if (state.running && state.currentTaskId === taskId) {
    state.monitorTimer = setTimeout(
      () => monitorSession(db, taskId, sessionKey, dashboardId),
      MONITOR_INTERVAL_MS,
    );
  }
}
