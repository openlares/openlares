/**
 * Task repository — high-level operations on the tasks database.
 *
 * All mutations return the affected row(s). IDs are generated via randomUUID().
 */

import { eq, and, asc, desc, isNull, isNotNull } from 'drizzle-orm';
import type { OpenlareDb } from './client';
import { dashboards, queues, transitions, tasks, taskHistory, taskComments } from './schema';
import type { DashboardConfig, TransitionConditions } from './schema';

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function newId(): string {
  return crypto.randomUUID();
}

function now(): Date {
  return new Date();
}

// ---------------------------------------------------------------------------
// Dashboard operations
// ---------------------------------------------------------------------------

export interface CreateDashboardInput {
  name: string;
  config?: DashboardConfig;
}

export function createDashboard(db: OpenlareDb, input: CreateDashboardInput) {
  const id = newId();
  const ts = now();
  return db
    .insert(dashboards)
    .values({ id, name: input.name, config: input.config ?? null, createdAt: ts, updatedAt: ts })
    .returning()
    .get();
}

export function getDashboard(db: OpenlareDb, id: string) {
  return db.select().from(dashboards).where(eq(dashboards.id, id)).get();
}

export function updateDashboard(
  db: OpenlareDb,
  id: string,
  data: { name?: string; config?: DashboardConfig },
) {
  const existing = getDashboard(db, id);
  if (!existing) return null;

  db.update(dashboards)
    .set({
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.config !== undefined ? { config: data.config } : {}),
      updatedAt: now(),
    })
    .where(eq(dashboards.id, id))
    .run();

  return getDashboard(db, id) ?? null;
}

export function listDashboards(db: OpenlareDb) {
  return db.select().from(dashboards).orderBy(asc(dashboards.createdAt)).all();
}

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

export interface CreateQueueInput {
  dashboardId: string;
  name: string;
  ownerType: 'human' | 'assistant';
  description?: string;
  position?: number;
  agentLimit?: number;
}

export function createQueue(db: OpenlareDb, input: CreateQueueInput) {
  const id = newId();
  const ts = now();
  return db
    .insert(queues)
    .values({
      id,
      dashboardId: input.dashboardId,
      name: input.name,
      ownerType: input.ownerType,
      description: input.description ?? null,
      position: input.position ?? 0,
      agentLimit: input.agentLimit ?? 1,
      createdAt: ts,
      updatedAt: ts,
    })
    .returning()
    .get();
}

export function listQueues(db: OpenlareDb, dashboardId: string) {
  return db
    .select()
    .from(queues)
    .where(eq(queues.dashboardId, dashboardId))
    .orderBy(asc(queues.position))
    .all();
}

export function getQueue(db: OpenlareDb, id: string) {
  return db.select().from(queues).where(eq(queues.id, id)).get();
}

export interface UpdateQueueInput {
  description?: string | null;
}

export function updateQueue(
  db: OpenlareDb,
  id: string,
  input: UpdateQueueInput,
): typeof queues.$inferSelect | null {
  const existing = getQueue(db, id);
  if (!existing) return null;

  const updates: Partial<typeof queues.$inferInsert> = {
    updatedAt: now(),
  };
  if (input.description !== undefined) updates.description = input.description;

  return db.update(queues).set(updates).where(eq(queues.id, id)).returning().get() ?? null;
}

// ---------------------------------------------------------------------------
// Transition operations
// ---------------------------------------------------------------------------

export interface CreateTransitionInput {
  fromQueueId: string;
  toQueueId: string;
  actorType: 'human' | 'assistant' | 'both';
  conditions?: TransitionConditions | null;
  autoTrigger?: boolean;
}

export function createTransition(db: OpenlareDb, input: CreateTransitionInput) {
  const id = newId();
  return db
    .insert(transitions)
    .values({
      id,
      fromQueueId: input.fromQueueId,
      toQueueId: input.toQueueId,
      actorType: input.actorType,
      conditions: input.conditions ?? null,
      autoTrigger: input.autoTrigger ?? false,
      createdAt: now(),
    })
    .returning()
    .get();
}

export function listTransitions(db: OpenlareDb, dashboardId: string) {
  // Join through queues to filter by dashboard
  return db
    .select()
    .from(transitions)
    .innerJoin(queues, eq(transitions.fromQueueId, queues.id))
    .where(eq(queues.dashboardId, dashboardId))
    .all()
    .map((row) => row.transitions);
}

// ---------------------------------------------------------------------------
// Task operations
// ---------------------------------------------------------------------------

export interface CreateTaskInput {
  dashboardId: string;
  queueId: string;
  title: string;
  description?: string;
  priority?: number;
}

export function createTask(db: OpenlareDb, input: CreateTaskInput) {
  const id = newId();
  const ts = now();
  return db
    .insert(tasks)
    .values({
      id,
      dashboardId: input.dashboardId,
      queueId: input.queueId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 0,
      createdAt: ts,
      updatedAt: ts,
    })
    .returning()
    .get();
}

export function getTask(db: OpenlareDb, id: string) {
  return db.select().from(tasks).where(eq(tasks.id, id)).get();
}

export function listTasks(db: OpenlareDb, queueId: string) {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.queueId, queueId))
    .orderBy(desc(tasks.priority), asc(tasks.createdAt))
    .all();
}

export function listDashboardTasks(db: OpenlareDb, dashboardId: string) {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.dashboardId, dashboardId))
    .orderBy(desc(tasks.priority), asc(tasks.createdAt))
    .all();
}

/**
 * Move a task to a different queue. Validates the transition exists and
 * records history. Returns the updated task or null if the move is invalid.
 * Clears assignedAgent, sessionKey, error, and errorAt for a clean slate.
 */
export function moveTask(
  db: OpenlareDb,
  taskId: string,
  toQueueId: string,
  actor: string,
  note?: string,
): typeof tasks.$inferSelect | null {
  const task = getTask(db, taskId);
  if (!task) return null;

  // Validate target queue exists and belongs to same dashboard
  const targetQueue = getQueue(db, toQueueId);
  if (!targetQueue || targetQueue.dashboardId !== task.dashboardId) return null;

  // Check transition constraint (only when strictTransitions is enabled)
  const dashboard = getDashboard(db, task.dashboardId);
  if (dashboard?.config?.strictTransitions) {
    const transition = db
      .select()
      .from(transitions)
      .where(and(eq(transitions.fromQueueId, task.queueId), eq(transitions.toQueueId, toQueueId)))
      .get();

    if (!transition) return null; // Invalid move under strict mode
  }

  const ts = now();

  // Record history
  db.insert(taskHistory)
    .values({
      id: newId(),
      taskId,
      fromQueueId: task.queueId,
      toQueueId,
      actor,
      note: note ?? null,
      createdAt: ts,
    })
    .run();

  // Move the task, clean slate for the new queue
  db.update(tasks)
    .set({
      queueId: toQueueId,
      assignedAgent: null,
      sessionKey: null,
      error: null,
      errorAt: null,
      updatedAt: ts,
    })
    .where(eq(tasks.id, taskId))
    .run();

  return getTask(db, taskId) ?? null;
}

/**
 * Claim a task for agent execution. Sets assignedAgent and sessionKey.
 * Returns the task or null if it's not claimable (already assigned or has error).
 */
export function claimTask(
  db: OpenlareDb,
  taskId: string,
  agentId: string,
  sessionKey: string,
): typeof tasks.$inferSelect | null {
  const task = getTask(db, taskId);
  if (!task || task.assignedAgent || task.error) return null;

  db.update(tasks)
    .set({
      assignedAgent: agentId,
      sessionKey,
      updatedAt: now(),
    })
    .where(eq(tasks.id, taskId))
    .run();

  return getTask(db, taskId) ?? null;
}

/**
 * Set error on a task. Agent will skip it until cleared.
 */
export function setTaskError(
  db: OpenlareDb,
  taskId: string,
  error: string,
): typeof tasks.$inferSelect | null {
  db.update(tasks)
    .set({ error, errorAt: now(), assignedAgent: null, sessionKey: null, updatedAt: now() })
    .where(eq(tasks.id, taskId))
    .run();
  return getTask(db, taskId) ?? null;
}

/**
 * Clear error on a task so it can be picked up again.
 */
export function clearTaskError(db: OpenlareDb, taskId: string): typeof tasks.$inferSelect | null {
  db.update(tasks)
    .set({ error: null, errorAt: null, updatedAt: now() })
    .where(eq(tasks.id, taskId))
    .run();
  return getTask(db, taskId) ?? null;
}

/**
 * Release a task's agent assignment without setting error (for after successful routing).
 */
export function releaseTask(db: OpenlareDb, taskId: string): typeof tasks.$inferSelect | null {
  db.update(tasks)
    .set({ assignedAgent: null, sessionKey: null, updatedAt: now() })
    .where(eq(tasks.id, taskId))
    .run();
  return getTask(db, taskId) ?? null;
}

/**
 * Update a task's title, description, or priority.
 */
export interface UpdateTaskInput {
  title?: string;
  description?: string;
  priority?: number;
}

export function updateTask(
  db: OpenlareDb,
  taskId: string,
  input: UpdateTaskInput,
): typeof tasks.$inferSelect | null {
  const task = getTask(db, taskId);
  if (!task) return null;

  const updates: Record<string, unknown> = { updatedAt: now() };
  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.priority !== undefined) updates.priority = input.priority;

  db.update(tasks).set(updates).where(eq(tasks.id, taskId)).run();

  return getTask(db, taskId) ?? null;
}

/**
 * Delete a task and all its history/attachments (via CASCADE).
 * Returns true if a task was deleted, false if not found.
 */
export function deleteTask(db: OpenlareDb, taskId: string): boolean {
  const task = getTask(db, taskId);
  if (!task) return false;

  db.delete(tasks).where(eq(tasks.id, taskId)).run();
  return true;
}

/**
 * Get the next claimable task from assistant-owned queues in a dashboard.
 * Returns the highest-priority unassigned, error-free task, respecting agent limits.
 */
export function getNextClaimableTask(
  db: OpenlareDb,
  dashboardId: string,
): typeof tasks.$inferSelect | undefined {
  // Get assistant-owned queues
  const assistantQueues = db
    .select()
    .from(queues)
    .where(and(eq(queues.dashboardId, dashboardId), eq(queues.ownerType, 'assistant')))
    .all();

  for (const queue of assistantQueues) {
    // Check agent limit (count tasks with assignedAgent set)
    const executing = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.queueId, queue.id), isNotNull(tasks.assignedAgent)))
      .all();

    if (queue.agentLimit > 0 && executing.length >= queue.agentLimit) continue;

    // Get highest priority task with no assignedAgent and no error
    const task = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.queueId, queue.id), isNull(tasks.assignedAgent), isNull(tasks.error)))
      .orderBy(desc(tasks.priority), asc(tasks.createdAt))
      .limit(1)
      .get();

    if (task) return task;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Task Comments
// ---------------------------------------------------------------------------

export function addComment(
  db: OpenlareDb,
  taskId: string,
  author: string,
  authorType: 'human' | 'agent',
  content: string,
): typeof taskComments.$inferSelect {
  const id = newId();
  return db
    .insert(taskComments)
    .values({
      id,
      taskId,
      author,
      authorType,
      content,
      createdAt: now(),
    })
    .returning()
    .get();
}

export function listComments(
  db: OpenlareDb,
  taskId: string,
): Array<typeof taskComments.$inferSelect> {
  return db
    .select()
    .from(taskComments)
    .where(eq(taskComments.taskId, taskId))
    .orderBy(asc(taskComments.createdAt))
    .all();
}

// ---------------------------------------------------------------------------
// Task history
// ---------------------------------------------------------------------------

export function getTaskHistory(db: OpenlareDb, taskId: string) {
  return db
    .select()
    .from(taskHistory)
    .where(eq(taskHistory.taskId, taskId))
    .orderBy(asc(taskHistory.createdAt))
    .all();
}

// ---------------------------------------------------------------------------
// Seed default dashboard
// ---------------------------------------------------------------------------

/**
 * Create a default dashboard with todo → in-progress → done pipeline.
 * Returns existing dashboard if one already exists.
 */
export function seedDefaultDashboard(db: OpenlareDb) {
  const existing = listDashboards(db);
  if (existing.length > 0) return existing[0]!;

  const dashboard = createDashboard(db, {
    name: 'Default',
    config: { maxConcurrentAgents: 1, strictTransitions: false },
  });

  const todo = createQueue(db, {
    dashboardId: dashboard.id,
    name: 'Todo',
    ownerType: 'human',
    description: 'Tasks waiting to be picked up',
    position: 0,
  });

  const inProgress = createQueue(db, {
    dashboardId: dashboard.id,
    name: 'In Progress',
    ownerType: 'assistant',
    description: 'Tasks being worked on by the agent',
    position: 1,
  });

  const done = createQueue(db, {
    dashboardId: dashboard.id,
    name: 'Done',
    ownerType: 'human',
    description: 'Completed tasks',
    position: 2,
  });

  // Transitions: todo → in-progress (human), in-progress → done (assistant)
  createTransition(db, {
    fromQueueId: todo.id,
    toQueueId: inProgress.id,
    actorType: 'human',
  });
  createTransition(db, {
    fromQueueId: inProgress.id,
    toQueueId: done.id,
    actorType: 'assistant',
  });
  // Allow human to move back from in-progress to todo
  createTransition(db, {
    fromQueueId: inProgress.id,
    toQueueId: todo.id,
    actorType: 'human',
  });
  // Allow human to move from done back to todo
  createTransition(db, {
    fromQueueId: done.id,
    toQueueId: todo.id,
    actorType: 'human',
  });

  // Allow human to move from done back to in-progress
  createTransition(db, {
    fromQueueId: done.id,
    toQueueId: inProgress.id,
    actorType: 'human',
  });
  return dashboard;
}

// ---------------------------------------------------------------------------
// Queue delete + reorder
// ---------------------------------------------------------------------------

/**
 * Delete a queue by ID.
 * - Refuses if the queue still has tasks (returns false).
 * - Refuses if this is the last queue in the dashboard (returns false).
 * - Cascades to transitions (handled by FK ON DELETE CASCADE in schema).
 */
export function deleteQueue(db: OpenlareDb, queueId: string): boolean {
  const queue = getQueue(db, queueId);
  if (!queue) return false;

  // Safety: don't allow deleting the last queue in a dashboard
  const dashboardQueues = listQueues(db, queue.dashboardId);
  if (dashboardQueues.length <= 1) return false;

  // Refuse if queue has tasks
  const queueTasks = listTasks(db, queueId);
  if (queueTasks.length > 0) return false;

  db.delete(queues).where(eq(queues.id, queueId)).run();
  return true;
}

/**
 * Delete a transition by ID.
 * Returns true if deleted, false if not found.
 */
export function deleteTransition(db: OpenlareDb, transitionId: string): boolean {
  const existing = db.select().from(transitions).where(eq(transitions.id, transitionId)).get();
  if (!existing) return false;

  db.delete(transitions).where(eq(transitions.id, transitionId)).run();
  return true;
}

/**
 * Batch-update queue positions for reordering.
 * Wraps all updates in a transaction.
 */
export function updateQueuePositions(
  db: OpenlareDb,
  updates: Array<{ id: string; position: number }>,
): void {
  db.transaction((tx) => {
    for (const { id, position } of updates) {
      tx.update(queues).set({ position, updatedAt: now() }).where(eq(queues.id, id)).run();
    }
  });
}
