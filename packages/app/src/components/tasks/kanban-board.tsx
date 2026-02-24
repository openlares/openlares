'use client';

import { useState, useCallback } from 'react';
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { QueueColumn } from './queue-column';
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
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

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

  return (
    <div className="flex h-full flex-col">
      {/* Board header */}
      <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
        <h2 className="text-lg font-semibold text-slate-100">{dashboard.name}</h2>
        <span className="text-xs text-slate-500">{tasks.length} tasks</span>
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
    </div>
  );
}
