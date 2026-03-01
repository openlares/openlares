/**
 * Task repository — high-level operations on the tasks database.
 *
 * All mutations return the affected row(s). IDs are generated via randomUUID().
 */

import { eq, and, asc, desc, isNull, isNotNull, count } from 'drizzle-orm';
import type { OpenlareDb } from './client';
import {
  projects,
  queues,
  transitions,
  tasks,
  taskHistory,
  taskComments,
  projectAgents,
  queueTemplates,
} from './schema';
import type { ProjectConfig, TransitionConditions, QueueTemplateEntry } from './schema';

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
// Project operations
// ---------------------------------------------------------------------------

export interface CreateProjectInput {
  name: string;
  config?: ProjectConfig;
  systemPrompt?: string;
}

export function createProject(db: OpenlareDb, input: CreateProjectInput) {
  const id = newId();
  const ts = now();
  return db
    .insert(projects)
    .values({
      id,
      name: input.name,
      config: input.config ?? null,
      systemPrompt: input.systemPrompt ?? null,
      createdAt: ts,
      updatedAt: ts,
    })
    .returning()
    .get();
}

export function getProject(db: OpenlareDb, id: string) {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

export interface UpdateProjectInput {
  name?: string;
  config?: ProjectConfig;
  pinned?: boolean;
  systemPrompt?: string | null;
  lastAccessedAt?: Date;
}

export function updateProject(
  db: OpenlareDb,
  id: string,
  data: UpdateProjectInput,
): typeof projects.$inferSelect | null {
  const existing = getProject(db, id);
  if (!existing) return null;

  const updates: Partial<typeof projects.$inferInsert> = { updatedAt: now() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.config !== undefined) updates.config = data.config;
  if (data.pinned !== undefined) updates.pinned = data.pinned;
  if (data.systemPrompt !== undefined) updates.systemPrompt = data.systemPrompt;
  if (data.lastAccessedAt !== undefined) updates.lastAccessedAt = data.lastAccessedAt;

  db.update(projects).set(updates).where(eq(projects.id, id)).run();

  return getProject(db, id) ?? null;
}

export function listProjects(db: OpenlareDb) {
  return db
    .select()
    .from(projects)
    .orderBy(desc(projects.pinned), desc(projects.lastAccessedAt), desc(projects.createdAt))
    .all();
}

/**
 * Update lastAccessedAt to now for a project.
 */
export function touchProject(
  db: OpenlareDb,
  projectId: string,
): typeof projects.$inferSelect | null {
  const existing = getProject(db, projectId);
  if (!existing) return null;

  db.update(projects)
    .set({ lastAccessedAt: now(), updatedAt: now() })
    .where(eq(projects.id, projectId))
    .run();

  return getProject(db, projectId) ?? null;
}

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

export interface CreateQueueInput {
  projectId: string;
  name: string;
  ownerType: 'human' | 'assistant';
  description?: string;
  position?: number;
  agentLimit?: number;
  systemPrompt?: string;
}

export function createQueue(db: OpenlareDb, input: CreateQueueInput) {
  const id = newId();
  const ts = now();
  return db
    .insert(queues)
    .values({
      id,
      projectId: input.projectId,
      name: input.name,
      ownerType: input.ownerType,
      description: input.description ?? null,
      position: input.position ?? 0,
      agentLimit: input.agentLimit ?? 1,
      systemPrompt: input.systemPrompt ?? null,
      createdAt: ts,
      updatedAt: ts,
    })
    .returning()
    .get();
}

export function listQueues(db: OpenlareDb, projectId: string) {
  return db
    .select()
    .from(queues)
    .where(eq(queues.projectId, projectId))
    .orderBy(asc(queues.position))
    .all();
}

export function getQueue(db: OpenlareDb, id: string) {
  return db.select().from(queues).where(eq(queues.id, id)).get();
}

export interface UpdateQueueInput {
  description?: string | null;
  systemPrompt?: string | null;
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
  if (input.systemPrompt !== undefined) updates.systemPrompt = input.systemPrompt;

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

export function listTransitions(db: OpenlareDb, projectId: string) {
  // Join through queues to filter by project
  return db
    .select()
    .from(transitions)
    .innerJoin(queues, eq(transitions.fromQueueId, queues.id))
    .where(eq(queues.projectId, projectId))
    .all()
    .map((row) => row.transitions);
}

// ---------------------------------------------------------------------------
// Task operations
// ---------------------------------------------------------------------------

export interface CreateTaskInput {
  projectId: string;
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
      projectId: input.projectId,
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

export function listProjectTasks(db: OpenlareDb, projectId: string) {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
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

  // Validate target queue exists and belongs to same project
  const targetQueue = getQueue(db, toQueueId);
  if (!targetQueue || targetQueue.projectId !== task.projectId) return null;

  // Check transition constraint (only when strictTransitions is enabled)
  const project = getProject(db, task.projectId);
  if (project?.config?.strictTransitions) {
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
 * Get the next claimable task from assistant-owned queues in a project.
 * Returns the highest-priority unassigned, error-free task, respecting agent limits.
 * If agentId is provided and the project has agent restrictions, verifies the agent is allowed.
 */
export function getNextClaimableTask(
  db: OpenlareDb,
  projectId: string,
  agentId?: string,
): typeof tasks.$inferSelect | undefined {
  // If agentId provided, check project agent restrictions
  if (agentId !== undefined) {
    const projectAgentList = listProjectAgents(db, projectId);
    if (projectAgentList.length > 0 && !projectAgentList.includes(agentId)) {
      return undefined;
    }
  }

  // Get assistant-owned queues
  const assistantQueues = db
    .select()
    .from(queues)
    .where(and(eq(queues.projectId, projectId), eq(queues.ownerType, 'assistant')))
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
// Create project with defaults
// ---------------------------------------------------------------------------

/**
 * Create a new project with a default Todo → In Progress → Done pipeline.
 * Unlike seedDefaultProject(), this always creates a fresh project and does
 * not check for existing ones — it is the reusable variant for the API.
 */
export function createProjectWithDefaults(
  db: OpenlareDb,
  input: CreateProjectInput,
): { project: typeof projects.$inferSelect; queues: Array<typeof queues.$inferSelect> } {
  const project = createProject(db, input);

  const todo = createQueue(db, {
    projectId: project.id,
    name: 'Todo',
    ownerType: 'human',
    description: 'Tasks waiting to be picked up',
    position: 0,
  });

  const inProgress = createQueue(db, {
    projectId: project.id,
    name: 'In Progress',
    ownerType: 'assistant',
    description: 'Tasks being worked on by the agent',
    position: 1,
  });

  const done = createQueue(db, {
    projectId: project.id,
    name: 'Done',
    ownerType: 'human',
    description: 'Completed tasks',
    position: 2,
  });

  // Transitions: todo → inProgress (human), inProgress → done (assistant)
  createTransition(db, { fromQueueId: todo.id, toQueueId: inProgress.id, actorType: 'human' });
  createTransition(db, { fromQueueId: inProgress.id, toQueueId: done.id, actorType: 'assistant' });

  return { project, queues: [todo, inProgress, done] };
}

// ---------------------------------------------------------------------------
// Seed default project
// ---------------------------------------------------------------------------

/**
 * Create a default project with todo → in-progress → done pipeline.
 * Returns existing project if one already exists.
 */
export function seedDefaultProject(db: OpenlareDb) {
  const existing = listProjects(db);
  if (existing.length > 0) return existing[0]!;

  const project = createProject(db, {
    name: 'Default',
    config: { maxConcurrentAgents: 1, strictTransitions: false },
  });

  const todo = createQueue(db, {
    projectId: project.id,
    name: 'Todo',
    ownerType: 'human',
    description: 'Tasks waiting to be picked up',
    position: 0,
  });

  const inProgress = createQueue(db, {
    projectId: project.id,
    name: 'In Progress',
    ownerType: 'assistant',
    description: 'Tasks being worked on by the agent',
    position: 1,
  });

  const done = createQueue(db, {
    projectId: project.id,
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
  return project;
}

// ---------------------------------------------------------------------------
// Queue delete + reorder
// ---------------------------------------------------------------------------

/**
 * Delete a queue by ID.
 * - Refuses if the queue still has tasks (returns false).
 * - Refuses if this is the last queue in the project (returns false).
 * - Cascades to transitions (handled by FK ON DELETE CASCADE in schema).
 */
export function deleteQueue(db: OpenlareDb, queueId: string): boolean {
  const queue = getQueue(db, queueId);
  if (!queue) return false;

  // Safety: don't allow deleting the last queue in a project
  const projectQueues = listQueues(db, queue.projectId);
  if (projectQueues.length <= 1) return false;

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

// ---------------------------------------------------------------------------
// Project Agent operations
// ---------------------------------------------------------------------------

/**
 * Assign an agent to a project. Idempotent (duplicate assigns are ignored).
 */
export function assignAgent(
  db: OpenlareDb,
  projectId: string,
  agentId: string,
): typeof projectAgents.$inferSelect {
  return (
    db
      .insert(projectAgents)
      .values({ projectId, agentId })
      .onConflictDoNothing()
      .returning()
      .get() ??
    db
      .select()
      .from(projectAgents)
      .where(and(eq(projectAgents.projectId, projectId), eq(projectAgents.agentId, agentId)))
      .get()!
  );
}

/**
 * Remove an agent from a project.
 * Returns true if removed, false if not found.
 */
export function removeAgent(db: OpenlareDb, projectId: string, agentId: string): boolean {
  const existing = db
    .select()
    .from(projectAgents)
    .where(and(eq(projectAgents.projectId, projectId), eq(projectAgents.agentId, agentId)))
    .get();
  if (!existing) return false;

  db.delete(projectAgents)
    .where(and(eq(projectAgents.projectId, projectId), eq(projectAgents.agentId, agentId)))
    .run();
  return true;
}

/**
 * List all agent IDs assigned to a project.
 */
export function listProjectAgents(db: OpenlareDb, projectId: string): string[] {
  return db
    .select()
    .from(projectAgents)
    .where(eq(projectAgents.projectId, projectId))
    .all()
    .map((row) => row.agentId);
}

// ---------------------------------------------------------------------------
// Queue Template operations
// ---------------------------------------------------------------------------

/**
 * Create a queue template from a list of queue entries.
 */
export function createQueueTemplate(
  db: OpenlareDb,
  input: { name: string; entries: QueueTemplateEntry[] },
): typeof queueTemplates.$inferSelect {
  const id = newId();
  return db
    .insert(queueTemplates)
    .values({
      id,
      name: input.name,
      queuesJson: input.entries,
      createdAt: now(),
    })
    .returning()
    .get();
}

/**
 * List all queue templates.
 */
export function listQueueTemplates(db: OpenlareDb): Array<typeof queueTemplates.$inferSelect> {
  return db.select().from(queueTemplates).orderBy(asc(queueTemplates.createdAt)).all();
}

/**
 * Delete a queue template by ID.
 * Returns true if deleted, false if not found.
 */
export function deleteQueueTemplate(db: OpenlareDb, id: string): boolean {
  const existing = db.select().from(queueTemplates).where(eq(queueTemplates.id, id)).get();
  if (!existing) return false;

  db.delete(queueTemplates).where(eq(queueTemplates.id, id)).run();
  return true;
}

/**
 * Create a project from a queue template.
 * Returns the created project and its queues, or null if template not found.
 */
export function createProjectFromTemplate(
  db: OpenlareDb,
  input: { name: string; templateId: string },
): { project: typeof projects.$inferSelect; queues: Array<typeof queues.$inferSelect> } | null {
  const template = db
    .select()
    .from(queueTemplates)
    .where(eq(queueTemplates.id, input.templateId))
    .get();
  if (!template) return null;

  const project = createProject(db, { name: input.name });
  const entries = template.queuesJson ?? [];
  const createdQueues = entries.map((entry, index) =>
    createQueue(db, {
      projectId: project.id,
      name: entry.name,
      ownerType: entry.ownerType,
      description: entry.description,
      agentLimit: entry.agentLimit,
      position: index,
    }),
  );

  return { project, queues: createdQueues };
}

// ---------------------------------------------------------------------------
// Project statistics
// ---------------------------------------------------------------------------

export interface ProjectStats {
  totalTasks: number;
  queueCount: number;
}

export function getProjectStats(db: OpenlareDb, projectId: string): ProjectStats {
  const [taskRow] = db
    .select({ total: count() })
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .all();
  const [queueRow] = db
    .select({ total: count() })
    .from(queues)
    .where(eq(queues.projectId, projectId))
    .all();
  return {
    totalTasks: taskRow?.total ?? 0,
    queueCount: queueRow?.total ?? 0,
  };
}
