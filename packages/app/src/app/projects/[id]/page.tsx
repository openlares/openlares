import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import {
  getProject,
  touchProject,
  listQueues,
  listProjectTasks,
  listTransitions,
} from '@openlares/db';
import { KanbanBoard } from '@/components/tasks/kanban-board';
import type { Project, Queue, Task, Transition } from '@/components/tasks/types';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const rawProject = getProject(db, id);

  if (!rawProject) {
    notFound();
  }

  // Update lastAccessedAt
  touchProject(db, rawProject.id);

  const rawQueues = listQueues(db, rawProject.id);
  const rawTasks = listProjectTasks(db, rawProject.id);
  const rawTransitions = listTransitions(db, rawProject.id);

  // Serialize dates to numbers for client components
  const project: Project = {
    ...rawProject,
    config: rawProject.config ?? null,
    pinned: Boolean(rawProject.pinned),
    lastAccessedAt: rawProject.lastAccessedAt ? rawProject.lastAccessedAt.getTime() : null,
    systemPrompt: rawProject.systemPrompt ?? null,
    createdAt: rawProject.createdAt.getTime(),
    updatedAt: rawProject.updatedAt.getTime(),
  };

  const queueList: Queue[] = rawQueues.map((q) => ({
    ...q,
    createdAt: q.createdAt.getTime(),
    updatedAt: q.updatedAt.getTime(),
  }));

  const taskList: Task[] = rawTasks.map((t) => ({
    ...t,
    errorAt: t.errorAt?.getTime() ?? null,
    createdAt: t.createdAt.getTime(),
    updatedAt: t.updatedAt.getTime(),
  }));

  const transitionList: Transition[] = rawTransitions.map((t) => ({
    ...t,
    autoTrigger: Boolean(t.autoTrigger),
    conditions: (t.conditions as Record<string, unknown>) ?? null,
    createdAt: t.createdAt.getTime(),
  }));

  return (
    <KanbanBoard
      dashboard={project}
      initialQueues={queueList}
      initialTasks={taskList}
      initialTransitions={transitionList}
    />
  );
}
