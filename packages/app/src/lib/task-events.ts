/**
 * Task event emitter singleton — server-side pub/sub for task state changes.
 * Used to push events to connected SSE clients without persistence or replay.
 *
 * Uses globalThis to survive Turbopack/HMR module re-evaluation in dev mode.
 */

export type TaskEventType =
  | 'executor:started'
  | 'executor:stopped'
  | 'task:claimed'
  | 'task:completed'
  | 'task:failed'
  | 'task:moved'
  | 'task:created'
  | 'task:updated'
  | 'task:deleted'
  | 'task:comment';

export interface TaskEvent {
  type: TaskEventType;
  taskId?: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

type TaskEventCallback = (event: TaskEvent) => void;

// Persist subscribers across HMR in dev mode
const g = globalThis as unknown as { __taskEventSubscribers?: Set<TaskEventCallback> };
if (!g.__taskEventSubscribers) {
  g.__taskEventSubscribers = new Set<TaskEventCallback>();
}
const subscribers = g.__taskEventSubscribers;

export function subscribe(callback: TaskEventCallback): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

export function emit(event: TaskEvent): void {
  for (const cb of subscribers) {
    try {
      cb(event);
    } catch {
      // Ignore subscriber errors to avoid breaking other subscribers
    }
  }
}
