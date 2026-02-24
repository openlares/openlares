'use client';

import { useState, useCallback, useEffect } from 'react';
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { QueueColumn } from './queue-column';
import { TaskDetail } from './task-detail';
import type { Dashboard, Queue, Task, Transition } from './types';

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
  const [tasks, setTasks] = useState(initialTasks);
  const [transitions] = useState(initialTransitions);
  const [showAddModal, setShowAddModal] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [executorRunning, setExecutorRunning] = useState(false);
  const [executorTaskId, setExecutorTaskId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Poll executor status + refresh tasks
  useEffect(() => {
    let cancelled = false;

    async function checkStatus() {
      try {
        // Executor status
        const statusRes = await fetch('/api/executor');
        if (statusRes.ok && !cancelled) {
          const data = (await statusRes.json()) as {
            running: boolean;
            currentTaskId: string | null;
          };
          setExecutorRunning(data.running);
          setExecutorTaskId(data.currentTaskId);
        }

        // Refresh tasks (agent may have moved them)
        const tasksRes = await fetch(`/api/dashboards/${dashboard.id}/tasks`);
        if (tasksRes.ok && !cancelled) {
          const freshTasks = (await tasksRes.json()) as Task[];
          setTasks(freshTasks);
        }
      } catch {
        /* ignore */
      }
    }

    void checkStatus();
    const timer = setInterval(checkStatus, 5_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [dashboard.id]);

  const toggleExecutor = useCallback(async () => {
    try {
      const res = await fetch('/api/executor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          executorRunning
            ? { action: 'stop' }
            : { action: 'start', dashboardId: dashboard.id },
        ),
      });
      if (res.ok) {
        const data = (await res.json()) as { running: boolean; currentTaskId: string | null };
        setExecutorRunning(data.running);
        setExecutorTaskId(data.currentTaskId);
      }
    } catch {
      /* ignore */
    }
  }, [executorRunning, dashboard.id]);

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
      return transitions.some(
        (t) =>
          t.fromQueueId === fromQueueId &&
          t.toQueueId === toQueueId &&
          (t.actorType === 'human' || t.actorType === 'both'),
      );
    },
    [transitions],
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
        }
      } catch {
        // Revert
        setTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, queueId: task.queueId } : t)),
        );
      }
    },
    [canMove],
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
        }
      } catch {
        // TODO: show error
      }
    },
    [dashboard.id, showAddModal, newTitle, newDescription],
  );

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

      {/* Task detail modal */}
      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          queue={queues.find((q) => q.id === selectedTask.queueId)}
          onClose={() => setSelectedTask(null)}
          onUpdate={handleUpdateTask}
          onDelete={handleDeleteTask}
        />
      )}
    </div>
  );
}
