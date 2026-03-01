'use client';

import { useRef, useCallback } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Task } from './types';

interface TaskCardProps {
  task: Task;
  onSelect?: (task: Task) => void;
}

export function TaskCard({ task, onSelect }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  // Track mouse down position to distinguish click from drag
  const mouseDown = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      mouseDown.current = { x: e.clientX, y: e.clientY };
      listeners?.onPointerDown?.(e);
    },
    [listeners],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!mouseDown.current) return;
      const dx = Math.abs(e.clientX - mouseDown.current.x);
      const dy = Math.abs(e.clientY - mouseDown.current.y);
      mouseDown.current = null;
      // Only open detail if it wasn't a drag (< activation distance)
      if (dx < 8 && dy < 8) {
        onSelect?.(task);
      }
    },
    [task, onSelect],
  );

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  const borderColor = task.error
    ? 'border-l-red-400'
    : task.assignedAgent
      ? 'border-l-cyan-400'
      : 'border-l-slate-500';

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      className={`rounded-lg border-l-4 ${borderColor} bg-slate-800/80 p-3 shadow-md transition-shadow hover:shadow-lg ${
        isDragging ? 'z-50 opacity-75 shadow-xl' : ''
      } cursor-grab active:cursor-grabbing`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium text-slate-100">{task.title}</h4>
        {task.error && <span className="shrink-0 text-xs">⚠️</span>}
      </div>

      {task.description && (
        <p className="mt-1 line-clamp-2 text-xs text-slate-400">{task.description}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {task.priority === 1 && (
          <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
            P1
          </span>
        )}
        {task.priority === 2 && (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            P2
          </span>
        )}
        {task.priority === 3 && (
          <span className="rounded bg-slate-500/30 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
            P3
          </span>
        )}
        {task.assignedAgent && (
          <span className="flex items-center gap-1 rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
            🤖 {task.assignedAgent}
          </span>
        )}
      </div>
    </div>
  );
}
