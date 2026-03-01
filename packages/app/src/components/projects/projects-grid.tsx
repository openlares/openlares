'use client';

import type { Project } from '@/components/tasks/types';

interface ProjectWithStats extends Project {
  totalTasks: number;
  queueCount: number;
}

interface ProjectsGridProps {
  initialProjects: ProjectWithStats[];
}

// Phase 2: full project cards grid with avatars, pinning, drag-to-reorder
// For now: minimal list view to unblock Phase 1 typecheck
export function ProjectsGrid({ initialProjects }: ProjectsGridProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-slate-500">
      <div className="text-4xl">🗂️</div>
      <p className="text-lg">Projects ({initialProjects.length})</p>
      <p className="text-sm">Multi-project UI coming in Phase 2.</p>
    </div>
  );
}
