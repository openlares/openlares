'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { QueueColumn } from './queue-column';
import { TaskDetail } from './task-detail';
import { DashboardConfig } from './dashboard-config';
import type { Dashboard, Queue, Task, Transition } from './types';
import { loadGatewayConfig } from '@/lib/storage';
import { useToastStore } from '@/lib/toast-store';
import { ToastContainer } from '@/components/toast';

interface KanbanBoardProps {
  dashboard: Dashboard;
  initialQueues: Queue[];
  initialTasks: Task[];
  initialTransitions: Transition[];
}

export function KanbanBoard({
  dashboard,
  initialQueues,
  initialTasks,
  initialTransitions,
}: KanbanBoardProps) {
  const [queues] = useState(initialQueues);
  // Avoid hydration mismatch from @dnd-kit aria-describedby counters
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [tasks, setTasks] = useState(initialTasks);
  const [transitions] = useState(initialTransitions);
  const [showAddModal, setShowAddModal] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [executorRunning, setExecutorRunning] = useState(false);
  const [executorTaskId, setExecutorTaskId] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  // Incremented on SSE task:comment — triggers TaskDetail to re-fetch comments
  const [commentRefreshKey, setCommentRefreshKey] = useState(0);

  const addToast = useToastStore((s) => s.addToast);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Escape key to close modals
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (showConfig) {
          setShowConfig(false);
        } else if (selectedTask) {
          setSelectedTask(null);
        } else if (showAddModal) {
          setShowAddModal(null);
          setNewTitle('');
          setNewDescription('');
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTask, showAddModal, showConfig]);

  // Ref to hold fallback poll interval so we can clear it when SSE reconnects
  const fallbackPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshTasks = useCallback(() => {
    fetch(`/api/dashboards/${dashboard.id}/tasks`)
      .then((res) => (res.ok ? (res.json() as Promise<Task[]>) : null))
      .then((freshTasks) => {
        if (freshTasks) setTasks(freshTasks);
      })
      .catch(() => {
        /* ignore */
      });
  }, [dashboard.id]);

  const refreshExecutorStatus = useCallback(() => {
    fetch('/api/executor')
      .then((res) =>
        res.ok ? (res.json() as Promise<{ running: boolean; currentTaskId: string | null }>) : null,
      )
      .then((data) => {
        if (data) {
          setExecutorRunning(data.running);
          setExecutorTaskId(data.currentTaskId);
        }
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  // SSE subscription with fallback polling on error
  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;

    function startFallbackPoll() {
      if (fallbackPollRef.current) return; // already polling
      fallbackPollRef.current = setInterval(() => {
        refreshExecutorStatus();
        refreshTasks();
      }, 30_000);
    }

    function stopFallbackPoll() {
      if (fallbackPollRef.current) {
        clearInterval(fallbackPollRef.current);
        fallbackPollRef.current = null;
      }
    }

    function connect() {
      if (cancelled) return;

      es = new EventSource('/api/executor/events');

      es.onopen = () => {
        stopFallbackPoll();
      };

      es.onmessage = (e: MessageEvent<string>) => {
        if (cancelled) return;
        let event: { type: string; running?: boolean; currentTaskId?: string | null };
        try {
          event = JSON.parse(e.data) as typeof event;
        } catch {
          return;
        }

        if (event.type === 'status') {
          setExecutorRunning(event.running ?? false);
          setExecutorTaskId(event.currentTaskId ?? null);
          return;
        }

        // Trigger comment refresh in TaskDetail on agent comment events
        if (event.type === 'task:comment') {
          setCommentRefreshKey((k) => k + 1);
        }

        // Any task or executor change — refetch tasks for a consistent view
        if (
          event.type.startsWith('task:') ||
          event.type === 'executor:started' ||
          event.type === 'executor:stopped'
        ) {
          refreshTasks();
          if (event.type === 'executor:started') setExecutorRunning(true);
          if (event.type === 'executor:stopped') {
            setExecutorRunning(false);
            setExecutorTaskId(null);
          }
        }
      };

      es.onerror = () => {
        if (cancelled) return;
        es?.close();
        es = null;
        // Fall back to 30s polling until SSE reconnects
        startFallbackPoll();
        // Retry SSE after 5s
        setTimeout(connect, 5_000);
      };
    }

    connect();

    return () => {
      cancelled = true;
      stopFallbackPoll();
      es?.close();
    };
  }, [dashboard.id, refreshTasks, refreshExecutorStatus]);

  const toggleExecutor = useCallback(async () => {
    try {
      const res = await fetch('/api/executor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          executorRunning
            ? { action: 'stop' }
            : (() => {
                const gw = loadGatewayConfig();
                return {
                  action: 'start',
                  dashboardId: dashboard.id,
                  ...(gw
                    ? {
                        gatewayUrl: gw.url,
                        gatewayToken: gw.auth,
                      }
                    : {}),
                };
              })(),
        ),
      });
      if (res.ok) {
        const data = (await res.json()) as { running: boolean; currentTaskId: string | null };
        setExecutorRunning(data.running);
        setExecutorTaskId(data.currentTaskId);
      } else {
        const err = (await res.json()) as { error?: string };
        addToast('error', err.error ?? 'Failed to toggle agent');
      }
    } catch {
      addToast('error', 'Network error — check your connection');
    }
  }, [executorRunning, dashboard.id, addToast]);

  // Group tasks by queue
  const tasksByQueue = queues.reduce(
    (acc, queue) => {
      acc[queue.id] = tasks.filter((t) => t.queueId === queue.id);
      return acc;
    },
    {} as Record<string, Task[]>,
  );

  // Check if a transition is valid
  const canMove = useCallback(
    (fromQueueId: string, toQueueId: string): boolean => {
      // When strict transitions are disabled, allow any move
      if (!dashboard.config?.strictTransitions) return true;
      return transitions.some(
        (t) =>
          t.fromQueueId === fromQueueId &&
          t.toQueueId === toQueueId &&
          (t.actorType === 'human' || t.actorType === 'both'),
      );
    },
    [dashboard.config?.strictTransitions, transitions],
  );

  // Handle drag end — move task between queues
  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;

      const task = (active.data.current as { task: Task } | undefined)?.task;
      const targetQueueId = String(over.id);

      if (!task || task.queueId === targetQueueId) return;
      if (!canMove(task.queueId, targetQueueId)) return;

      // Optimistic update
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, queueId: targetQueueId } : t)),
      );

      // Persist
      try {
        const res = await fetch(`/api/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'move', toQueueId: targetQueueId, actor: 'human' }),
        });
        if (!res.ok) {
          // Revert on failure
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, queueId: task.queueId } : t)),
          );
          const err = (await res.json()) as { error?: string };
          addToast('error', err.error ?? 'Failed to move task');
        }
      } catch {
        // Revert
        setTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, queueId: task.queueId } : t)),
        );
        addToast('error', 'Network error — check your connection');
      }
    },
    [canMove, addToast],
  );

  // Create a new task
  const handleAddTask = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!showAddModal || !newTitle.trim()) return;

      try {
        const res = await fetch(`/api/dashboards/${dashboard.id}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            queueId: showAddModal,
            title: newTitle.trim(),
            description: newDescription.trim() || undefined,
          }),
        });
        if (res.ok) {
          const task = (await res.json()) as Task;
          setTasks((prev) => [...prev, task]);
          setNewTitle('');
          setNewDescription('');
          setShowAddModal(null);
        } else {
          const err = (await res.json()) as { error?: string };
          addToast('error', err.error ?? 'Failed to create task');
        }
      } catch {
        addToast('error', 'Network error — check your connection');
      }
    },
    [dashboard.id, showAddModal, newTitle, newDescription, addToast],
  );

  // Handle queue/transition config changes
  const handleQueuesChange = useCallback((_newQueues: Queue[], _newTransitions: Transition[]) => {
    // Force page reload to get fresh server-side data
    window.location.reload();
  }, []);

  // Handle task update from detail panel
  const handleUpdateTask = useCallback((updated: Task) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setSelectedTask(null);
  }, []);

  // Handle task deletion
  const handleDeleteTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setSelectedTask(null);
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Board header */}
      <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-100">{dashboard.name}</h2>
          <span className="text-xs text-slate-500">{tasks.length} tasks</span>
        </div>
        <div className="flex items-center gap-3">
          {executorTaskId && (
            <span className="flex items-center gap-1.5 text-xs text-cyan-400">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
              Working...
            </span>
          )}
          <button
            onClick={() => setShowConfig(true)}
            className="rounded-lg bg-slate-700/50 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
          >
            ⚙️ Configure
          </button>
          <button
            onClick={toggleExecutor}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              executorRunning
                ? 'bg-red-600/20 text-red-300 hover:bg-red-600/30'
                : 'bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30'
            }`}
          >
            {executorRunning ? '⏹ Stop Agent' : '▶ Start Agent'}
          </button>
        </div>
      </div>

      {/* Columns */}
      <div className="flex flex-1 gap-4 overflow-x-auto p-4">
        {mounted ? (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            {queues.map((queue) => (
              <QueueColumn
                key={queue.id}
                queue={queue}
                tasks={tasksByQueue[queue.id] ?? []}
                onAddTask={(queueId) => setShowAddModal(queueId)}
                onSelectTask={setSelectedTask}
              />
            ))}
          </DndContext>
        ) : (
          <div className="flex flex-1 gap-4 overflow-x-auto">
            {queues.map((queue) => (
              <div
                key={queue.id}
                className="min-w-[280px] max-w-[320px] shrink-0 rounded-xl bg-slate-900/60 p-3"
              >
                <h3 className="text-sm font-semibold text-slate-200">{queue.name}</h3>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add task modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <form
            onSubmit={handleAddTask}
            className="w-full max-w-md rounded-xl bg-slate-800 p-6 shadow-2xl"
          >
            <h3 className="mb-4 text-lg font-semibold text-slate-100">New Task</h3>

            <label className="mb-1 block text-xs text-slate-400">Title</label>
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="mb-3 w-full rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none ring-1 ring-slate-600 focus:ring-cyan-400"
            />

            <label className="mb-1 block text-xs text-slate-400">Description (optional)</label>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Additional context for the agent..."
              rows={3}
              className="mb-4 w-full resize-none rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none ring-1 ring-slate-600 focus:ring-cyan-400"
            />

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(null);
                  setNewTitle('');
                  setNewDescription('');
                }}
                className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newTitle.trim()}
                className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Dashboard config modal */}
      {showConfig && (
        <DashboardConfig
          dashboard={dashboard}
          queues={queues}
          transitions={transitions}
          onClose={() => setShowConfig(false)}
          onQueuesChange={handleQueuesChange}
        />
      )}

      {/* Task detail modal */}
      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          queue={queues.find((q) => q.id === selectedTask.queueId)}
          queues={queues}
          onClose={() => setSelectedTask(null)}
          onUpdate={handleUpdateTask}
          onDelete={handleDeleteTask}
          refreshKey={commentRefreshKey}
        />
      )}

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  );
}
