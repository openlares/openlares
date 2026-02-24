'use client';

import { useDraggable } from '@dnd-kit/core';
import type { Task } from './types';

interface TaskCardProps {
  task: Task;
}

const statusColors: Record<Task['status'], string> = {
  pending: 'border-l-slate-500',
  executing: 'border-l-cyan-400',
  completed: 'border-l-emerald-400',
  failed: 'border-l-red-400',
};

const statusIcons: Record<Task['status'], string> = {
  pending: '⏳',
  executing: '⚡',
  completed: '✅',
  failed: '❌',
};

export function TaskCard({ task }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`rounded-lg border-l-4 ${statusColors[task.status]} bg-slate-800/80 p-3 shadow-md transition-shadow hover:shadow-lg ${
        isDragging ? 'z-50 opacity-75 shadow-xl' : ''
      } cursor-grab active:cursor-grabbing`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium text-slate-100">{task.title}</h4>
        <span className="shrink-0 text-xs">{statusIcons[task.status]}</span>
      </div>

      {task.description && (
        <p className="mt-1 line-clamp-2 text-xs text-slate-400">{task.description}</p>
      )}

      <div className="mt-2 flex items-center gap-2">
        {task.priority > 0 && (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            P{task.priority}
          </span>
        )}
        {task.assignedAgent && (
          <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300">
            🤖 {task.assignedAgent}
          </span>
        )}
      </div>
    </div>
  );
}
