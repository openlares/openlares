/**
 * Task executor — connects tasks to OpenClaw agent sessions.
 *
 * Polls for claimable tasks in assistant-owned queues,
 * dispatches them via chat.send, and monitors completion.
 */

import { getDb } from './db';
import { emit } from './task-events';
import {
  getNextClaimableTask,
  claimTask,
  completeTask,
  failTask,
  moveTask,
  getTask,
  listTransitions,
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
    pollTimer: null,
    monitorTimer: null,
  };
}
const state = g.__executorState;

const POLL_INTERVAL_MS = 5_000;
const MONITOR_INTERVAL_MS = 3_000;
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
  };
}

export function startExecutor(dashboardId: string): void {
  if (state.running) return;
  state.running = true;
  emit({ type: 'executor:started', timestamp: Date.now() });
  pollForWork(dashboardId);
}

export function stopExecutor(): void {
  state.running = false;
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

async function dispatchTask(
  db: OpenlareDb,
  task: { id: string; title: string; description: string | null; dashboardId: string },
  sessionKey: string,
  dashboardId: string,
): Promise<void> {
  try {
    const comments = listComments(db, task.id);
    const prompt = buildPrompt(task, comments);

    await gatewayRpc('chat.send', {
      idempotencyKey: crypto.randomUUID(),
      sessionKey,
      message: prompt,
    });

    // Start monitoring this session
    monitorSession(db, task.id, sessionKey, dashboardId);
  } catch (err) {
    console.error(`[task-executor] Failed to dispatch task ${task.id}:`, err);
    failTask(db, task.id);
    emit({ type: 'task:failed', taskId: task.id, timestamp: Date.now() });
    state.currentTaskId = null;
    state.currentSessionKey = null;
  }
}

function buildPrompt(
  task: { title: string; description: string | null },
  comments: Array<{ author: string; authorType: string; content: string }> = [],
): string {
  let prompt = `# Task: ${task.title}\n\n`;
  if (task.description) {
    prompt += `${task.description}\n\n`;
  }
  if (comments.length > 0) {
    prompt += `## Previous conversation:\n`;
    for (const c of comments) {
      const label = c.authorType === 'agent' ? `[agent]` : `[human]`;
      prompt += `${label}: ${c.content}\n\n`;
    }
  }
  prompt += `When you have completed this task, your last message should clearly state "TASK COMPLETE" or explain what went wrong.`;
  return prompt;
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
    })) as { messages?: Array<{ role: string; content: string }> } | null;

    const messages = result?.messages ?? [];

    // Look at the last assistant message
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');

    if (lastAssistant) {
      const content =
        typeof lastAssistant.content === 'string'
          ? lastAssistant.content
          : JSON.stringify(lastAssistant.content);

      if (content.includes('TASK COMPLETE')) {
        // Extract readable text from the assistant's response
        let resultText: string | null = null;
        if (typeof lastAssistant.content === 'string') {
          resultText = lastAssistant.content.replace(/TASK COMPLETE/gi, '').trim() || null;
        } else if (Array.isArray(lastAssistant.content)) {
          const textParts = (lastAssistant.content as Array<{ type: string; text?: string }>)
            .filter((c) => c.type === 'text' && c.text)
            .map((c) => c.text!.replace(/TASK COMPLETE/gi, '').trim())
            .filter(Boolean);
          resultText = textParts.join('\n\n') || null;
        }

        // Task completed — try to auto-transition to next queue
        const task = getTask(db, taskId);
        if (task) {
          const transitions = listTransitions(db, dashboardId);
          const nextTransition = transitions.find(
            (t) =>
              t.fromQueueId === task.queueId &&
              (t.actorType === 'assistant' || t.actorType === 'both'),
          );

          if (nextTransition) {
            moveTask(db, taskId, nextTransition.toQueueId, AGENT_ID, 'Auto-completed by agent');
            emit({ type: 'task:moved', taskId, timestamp: Date.now() });
          }
          completeTask(db, taskId, resultText ?? undefined);
          emit({ type: 'task:completed', taskId, timestamp: Date.now() });
        }

        state.currentTaskId = null;
        state.currentSessionKey = null;
        return;
      }
    }

    // Check if session is still active by looking at recent tool calls
    // If no activity for a while, the agent probably finished without the magic phrase
    // For now, just keep polling
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
