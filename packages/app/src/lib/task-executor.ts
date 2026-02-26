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

const state: ExecutorState = {
  running: false,
  currentTaskId: null,
  currentSessionKey: null,
  pollTimer: null,
  monitorTimer: null,
};

const POLL_INTERVAL_MS = 5_000;
const MONITOR_INTERVAL_MS = 3_000;
const AGENT_ID = 'main';

// ---------------------------------------------------------------------------
// Gateway communication (server-side only)
// ---------------------------------------------------------------------------

let gatewayConfig: GatewayConfig | null = null;

export function configureGateway(config: GatewayConfig): void {
  gatewayConfig = config;
}

async function gatewayRpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  if (!gatewayConfig) throw new Error('Gateway not configured');

  // Allow self-signed gateway certs (common in local/LAN setups)
  const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (gatewayConfig.url.startsWith('https://')) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  let res: Response;
  try {
    res = await fetch(gatewayConfig.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gatewayConfig.token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method,
        params,
      }),
    });
  } finally {
    // Restore original TLS setting
    if (prevTls === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
    }
  }

  const data = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (data.error) throw new Error(`Gateway RPC error: ${data.error.message}`);
  return data.result;
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
    const prompt = buildPrompt(task);

    await gatewayRpc('chat.send', {
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

function buildPrompt(task: { title: string; description: string | null }): string {
  let prompt = `# Task: ${task.title}\n\n`;
  if (task.description) {
    prompt += `${task.description}\n\n`;
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
          completeTask(db, taskId);
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
