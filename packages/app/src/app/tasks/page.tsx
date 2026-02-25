import { getDb } from '@/lib/db';
import { listDashboards, listQueues, listDashboardTasks, listTransitions } from '@openlares/db';
import { KanbanBoard } from '@/components/tasks/kanban-board';
import type { Dashboard, Queue, Task, Transition } from '@/components/tasks/types';

export const dynamic = 'force-dynamic';

export default function TasksPage() {
  const db = getDb();
  const dashboards = listDashboards(db);

  if (dashboards.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-slate-500">
        <div className="text-4xl">📋</div>
        <p className="text-lg">No dashboards yet</p>
        <p className="text-sm">A default dashboard will be created automatically on first load.</p>
      </div>
    );
  }

  // For MVP: use the first dashboard
  const rawDashboard = dashboards[0]!;
  const rawQueues = listQueues(db, rawDashboard.id);
  const rawTasks = listDashboardTasks(db, rawDashboard.id);
  const rawTransitions = listTransitions(db, rawDashboard.id);

  // Serialize dates to numbers for client components
  const dashboard: Dashboard = {
    ...rawDashboard,
    config: rawDashboard.config ?? null,
    createdAt: rawDashboard.createdAt.getTime(),
    updatedAt: rawDashboard.updatedAt.getTime(),
  };

  const queueList: Queue[] = rawQueues.map((q) => ({
    ...q,
    createdAt: q.createdAt.getTime(),
    updatedAt: q.updatedAt.getTime(),
  }));

  const taskList: Task[] = rawTasks.map((t) => ({
    ...t,
    createdAt: t.createdAt.getTime(),
    updatedAt: t.updatedAt.getTime(),
    completedAt: t.completedAt?.getTime() ?? null,
  }));

  const transitionList: Transition[] = rawTransitions.map((t) => ({
    ...t,
    autoTrigger: Boolean(t.autoTrigger),
    conditions: (t.conditions as Record<string, unknown>) ?? null,
    createdAt: t.createdAt.getTime(),
  }));

  return (
    <KanbanBoard
      dashboard={dashboard}
      initialQueues={queueList}
      initialTasks={taskList}
      initialTransitions={transitionList}
    />
  );
}
