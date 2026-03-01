/**
 * Task executor — connects tasks to OpenClaw agent sessions.
 *
 * Polls for claimable tasks in assistant-owned queues,
 * dispatches them via HTTP /v1/chat/completions, and processes
 * the response directly. Agent signals completion via
 * "MOVE TO: <queue name>" in its response message.
 */

import { getDb } from './db';
import { emit } from './task-events';
import {
  getProject,
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
  abortController: AbortController | null;
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
    abortController: null,
  };
}
const state = g.__executorState;

const POLL_INTERVAL_MS = 5_000;
const EXECUTION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const AGENT_ID = 'main';

// ---------------------------------------------------------------------------
// Gateway configuration
// ---------------------------------------------------------------------------

let gatewayConfig: GatewayConfig | null = null;

export function configureGateway(config: GatewayConfig): void {
  gatewayConfig = config;
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

export function startExecutor(projectId: string): void {
  // Clear any stale timers (HMR can kill setTimeout chains while globalThis state persists)
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
  state.running = true;
  emit({ type: 'executor:started', timestamp: Date.now() });
  pollForWork(projectId);
}

export function stopExecutor(): void {
  state.running = false;
  state.dispatchTime = null;
  // Abort any in-flight fetch request
  state.abortController?.abort();
  state.abortController = null;
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
  emit({ type: 'executor:stopped', timestamp: Date.now() });
}

// ---------------------------------------------------------------------------
// Poll loop — find and claim tasks
// ---------------------------------------------------------------------------

function pollForWork(projectId: string): void {
  if (!state.running) return;

  // Don't poll if we're already working on something
  if (state.currentTaskId) {
    state.pollTimer = setTimeout(() => pollForWork(projectId), POLL_INTERVAL_MS);
    return;
  }

  const db = getDb();
  const task = getNextClaimableTask(db, projectId, AGENT_ID);

  if (task) {
    const sessionKey = `openlares:task:${task.id}`;
    const claimed = claimTask(db, task.id, AGENT_ID, sessionKey);

    if (claimed) {
      state.currentTaskId = task.id;
      state.currentSessionKey = sessionKey;
      emit({ type: 'task:claimed', taskId: task.id, timestamp: Date.now() });

      // Fire and forget — dispatch async, don't await
      void dispatchTask(db, claimed, sessionKey, projectId);
    }
  }

  state.pollTimer = setTimeout(() => pollForWork(projectId), POLL_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Task dispatch — send to OpenClaw via HTTP /v1/chat/completions
// ---------------------------------------------------------------------------

interface BuildPromptInput {
  title: string;
  description: string | null;
  comments: Array<{ authorType: string; content: string }>;
  currentQueueName: string;
  destinations: Array<{ name: string; description: string | null }>;
  projectSystemPrompt?: string | null;
  queueSystemPrompt?: string | null;
}

function buildPrompt(input: BuildPromptInput): string {
  let prompt = '';

  // Inject project-level system prompt
  if (input.projectSystemPrompt) {
    prompt += `${input.projectSystemPrompt}\n\n`;
  }

  // Inject queue-level system prompt
  if (input.queueSystemPrompt) {
    prompt += `${input.queueSystemPrompt}\n\n`;
  }

  prompt += `# Task: ${input.title}\n\n`;
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
    projectId: string;
    queueId: string;
  },
  sessionKey: string,
  projectId: string,
): Promise<void> {
  const taskId = task.id;

  try {
    if (!gatewayConfig) throw new Error('Gateway not configured');

    const allQueues = listQueues(db, projectId);
    const currentQueue = allQueues.find((q) => q.id === task.queueId);
    const dashboardTransitions = listTransitions(db, projectId);
    const availableTransitions = dashboardTransitions.filter(
      (t) =>
        t.fromQueueId === task.queueId && (t.actorType === 'assistant' || t.actorType === 'both'),
    );
    const destinations = availableTransitions
      .map((t) => allQueues.find((q) => q.id === t.toQueueId))
      .filter(Boolean)
      .map((q) => ({ name: q!.name, description: q!.description }));

    const comments = listComments(db, taskId);

    const project = getProject(db, projectId);

    const prompt = buildPrompt({
      title: task.title,
      description: task.description,
      comments: comments.map((c) => ({ authorType: c.authorType, content: c.content })),
      currentQueueName: currentQueue?.name ?? 'Unknown',
      destinations,
      projectSystemPrompt: project?.systemPrompt,
      queueSystemPrompt: currentQueue?.systemPrompt,
    });

    state.dispatchTime = Date.now();

    // Convert WebSocket URL to HTTP URL
    const httpUrl = gatewayConfig.url
      .replace(/^wss:\/\//, 'https://')
      .replace(/^ws:\/\//, 'http://');

    // Allow self-signed certs for LAN setups
    const prevTLS = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    const controller = new AbortController();
    state.abortController = controller;

    let content: string;
    try {
      // Combine manual abort signal with execution timeout
      const timeoutSignal = AbortSignal.timeout(EXECUTION_TIMEOUT_MS);
      const signal = AbortSignal.any
        ? AbortSignal.any([controller.signal, timeoutSignal])
        : controller.signal;

      const response = await fetch(`${httpUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gatewayConfig.token}`,
        },
        body: JSON.stringify({
          model: 'openclaw:main',
          messages: [{ role: 'user', content: prompt }],
          sessionKey,
          stream: false,
        }),
        signal,
      });

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      content = data.choices?.[0]?.message?.content ?? '';
    } finally {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTLS;
      state.abortController = null;
    }

    // Parse the MOVE TO directive from the response
    const targetName = parseMoveDirective(extractContent(content));
    const resultText = extractResponseText(content);

    // Save agent response as comment
    if (resultText) {
      addComment(db, taskId, AGENT_ID, 'agent', resultText);
      emit({ type: 'task:comment', taskId, timestamp: Date.now() });
    }

    if (!targetName) {
      setTaskError(db, taskId, 'Agent did not provide routing directive');
      emit({ type: 'task:updated', taskId, timestamp: Date.now() });
      state.currentTaskId = null;
      state.currentSessionKey = null;
      state.dispatchTime = null;
      return;
    }

    const currentTask = getTask(db, taskId);
    if (!currentTask) {
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

    // Find target queue by name (case-insensitive)
    const targetQueue = allQueues.find((q) => q.name.toLowerCase() === targetName.toLowerCase());

    const dashConfig = getProject(db, currentTask.projectId);
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
        const validTransition = dashboardTransitions.find(
          (t) =>
            t.fromQueueId === currentTask.queueId &&
            t.toQueueId === targetQueue.id &&
            (t.actorType === 'assistant' || t.actorType === 'both'),
        );

        if (validTransition) {
          moveTask(db, taskId, targetQueue.id, AGENT_ID, `Agent routed to ${targetQueue.name}`);
          emit({ type: 'task:moved', taskId, timestamp: Date.now() });
        } else {
          setTaskError(
            db,
            taskId,
            `No valid transition to "${targetQueue.name}" from current queue`,
          );
          emit({ type: 'task:updated', taskId, timestamp: Date.now() });
        }
      } else {
        moveTask(db, taskId, targetQueue.id, AGENT_ID, `Agent routed to ${targetQueue.name}`);
        emit({ type: 'task:moved', taskId, timestamp: Date.now() });
      }
    } else {
      if (strict) {
        const humanTransition = dashboardTransitions.find(
          (t) =>
            t.fromQueueId === currentTask.queueId &&
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
        setTaskError(db, taskId, `Unknown destination queue: "${targetName}"`);
        emit({ type: 'task:updated', taskId, timestamp: Date.now() });
      }
    }

    releaseTask(db, taskId);
    state.currentTaskId = null;
    state.currentSessionKey = null;
    state.dispatchTime = null;
  } catch (err) {
    const isAbort =
      err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
    if (isAbort) {
      const errorMsg = `Execution timeout (30m)`;
      addComment(db, taskId, 'system', 'agent', `\u26a0\ufe0f ${errorMsg}`);
      emit({ type: 'task:comment', taskId, timestamp: Date.now() });
      setTaskError(db, taskId, errorMsg);
    } else {
      console.error(`[task-executor] Failed to dispatch task ${taskId}:`, err);
      setTaskError(db, taskId, String(err));
    }
    emit({ type: 'task:updated', taskId, timestamp: Date.now() });
    releaseTask(db, taskId);
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
