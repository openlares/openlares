import { getDb } from '@/lib/db';
import { listProjects, getProjectStats } from '@openlares/db';
import { ProjectsGrid } from '@/components/projects/projects-grid';
import type { Project } from '@/components/tasks/types';

export const dynamic = 'force-dynamic';

export default function ProjectsPage() {
  const db = getDb();
  const rawProjects = listProjects(db);

  const projects: (Project & { totalTasks: number; queueCount: number })[] = rawProjects.map(
    (p) => {
      const stats = getProjectStats(db, p.id);
      return {
        ...p,
        config: p.config ?? null,
        pinned: Boolean(p.pinned),
        lastAccessedAt: p.lastAccessedAt ? p.lastAccessedAt.getTime() : null,
        systemPrompt: p.systemPrompt ?? null,
        createdAt: p.createdAt.getTime(),
        updatedAt: p.updatedAt.getTime(),
        totalTasks: stats.totalTasks,
        queueCount: stats.queueCount,
      };
    },
  );

  return <ProjectsGrid initialProjects={projects} />;
}
