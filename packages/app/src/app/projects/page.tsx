import { getDb } from '@/lib/db';
import { listProjectsWithStats } from '@openlares/db';
import { ProjectsGrid } from '@/components/projects/projects-grid';
import type { Project } from '@/components/tasks/types';

export const dynamic = 'force-dynamic';

export default function ProjectsPage() {
  const db = getDb();
  const rawProjects = listProjectsWithStats(db);

  const projects: (Project & { totalTasks: number; queueCount: number; activeAgents: string[] })[] =
    rawProjects.map((p) => ({
      ...p,
      config: p.config ?? null,
      pinned: Boolean(p.pinned),
      lastAccessedAt: p.lastAccessedAt ? p.lastAccessedAt.getTime() : null,
      systemPrompt: p.systemPrompt ?? null,
      createdAt: p.createdAt.getTime(),
      updatedAt: p.updatedAt.getTime(),
      activeAgents: p.activeAgents ?? [],
    }));

  return <ProjectsGrid initialProjects={projects} />;
}
