'use client';

import { useDroppable } from '@dnd-kit/core';
import { TaskCard } from './task-card';
import type { Queue, Task } from './types';

interface QueueColumnProps {
  queue: Queue;
  tasks: Task[];
  onAddTask?: (queueId: string) => void;
}

const ownerBadge: Record<Queue['ownerType'], { label: string; color: string }> = {
  human: { label: '👤 Human', color: 'bg-blue-500/20 text-blue-300' },
  assistant: { label: '🤖 Assistant', color: 'bg-purple-500/20 text-purple-300' },
};

export function QueueColumn({ queue, tasks, onAddTask }: QueueColumnProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: queue.id,
    data: { queue },
  });

  const badge = ownerBadge[queue.ownerType];

  return (
    <div
      className={`flex min-w-[280px] max-w-[320px] shrink-0 flex-col rounded-xl bg-slate-900/60 ${
        isOver ? 'ring-2 ring-cyan-400/50' : ''
      }`}
    >
      {/* Header */}
      <div className="border-b border-slate-700/50 p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">{queue.name}</h3>
          <span className="rounded-full bg-slate-700/50 px-2 py-0.5 text-xs text-slate-400">
            {tasks.length}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.color}`}>
            {badge.label}
          </span>
          {queue.description && (
            <span className="truncate text-[10px] text-slate-500">{queue.description}</span>
          )}
        </div>
      </div>

      {/* Task list */}
      <div ref={setNodeRef} className="flex min-h-[100px] flex-1 flex-col gap-2 p-2">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
        {tasks.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-xs text-slate-600">
            No tasks
          </div>
        )}
      </div>

      {/* Add task button (only for human-owned queues) */}
      {queue.ownerType === 'human' && onAddTask && (
        <div className="border-t border-slate-700/50 p-2">
          <button
            onClick={() => onAddTask(queue.id)}
            className="w-full rounded-lg bg-slate-800/50 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-700/50 hover:text-slate-200"
          >
            + Add task
          </button>
        </div>
      )}
    </div>
  );
}
