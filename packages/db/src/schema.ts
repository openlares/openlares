/**
 * Tasks Dashboard — SQLite schema (Drizzle ORM).
 *
 * State-machine queue system: queues are states, transitions are edges.
 * Tasks move between queues according to transition rules.
 */

import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// Projects (boards / projects)
// ---------------------------------------------------------------------------

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Global config (JSON): agent concurrency limits, etc. */
  config: text('config', { mode: 'json' }).$type<ProjectConfig>(),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  lastAccessedAt: integer('last_accessed_at', { mode: 'timestamp_ms' }),
  systemPrompt: text('system_prompt'),
  sessionMode: text('session_mode', { enum: ['per-task', 'agent-pool', 'any-free'] })
    .notNull()
    .default('per-task'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export interface ProjectConfig {
  /** When true, only transitions defined in the transitions table are allowed. Default: false (free movement). */
  strictTransitions?: boolean;
  /** Max concurrent agent tasks across the entire project. */
  maxConcurrentAgents?: number;
}

// ---------------------------------------------------------------------------
// Queues (columns in the board — states in the state machine)
// ---------------------------------------------------------------------------

export const queues = sqliteTable('queues', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Who acts on tasks in this queue. */
  ownerType: text('owner_type', { enum: ['human', 'assistant'] }).notNull(),
  description: text('description'),
  /** Display order (0-based column index). */
  position: integer('position').notNull().default(0),
  /** Max concurrent agents working on tasks in this queue (0 = unlimited). */
  agentLimit: integer('agent_limit').notNull().default(1),
  systemPrompt: text('system_prompt'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ---------------------------------------------------------------------------
// Transitions (edges in the state machine graph)
// ---------------------------------------------------------------------------

export const transitions = sqliteTable('transitions', {
  id: text('id').primaryKey(),
  fromQueueId: text('from_queue_id')
    .notNull()
    .references(() => queues.id, { onDelete: 'cascade' }),
  toQueueId: text('to_queue_id')
    .notNull()
    .references(() => queues.id, { onDelete: 'cascade' }),
  /** Who can trigger this transition. */
  actorType: text('actor_type', { enum: ['human', 'assistant', 'both'] }).notNull(),
  /** Conditions that must be met (extensible JSON). null = unconditional. */
  conditions: text('conditions', { mode: 'json' }).$type<TransitionConditions | null>(),
  /** If true, transition happens automatically when conditions are met. */
  autoTrigger: integer('auto_trigger', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export interface TransitionConditions {
  /** Placeholder for future condition types. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  queueId: text('queue_id')
    .notNull()
    .references(() => queues.id),
  title: text('title').notNull(),
  description: text('description'),
  /** Higher = more urgent. Default 0. */
  priority: integer('priority').notNull().default(0),
  /** OpenClaw session key working on this task (null if not executing). */
  sessionKey: text('session_key'),
  /** Agent ID assigned to this task. */
  assignedAgent: text('assigned_agent'),
  /** Error message if task failed. null = healthy, non-null = error. */
  error: text('error'),
  /** When the error occurred. */
  errorAt: integer('error_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ---------------------------------------------------------------------------
// Project Agents (agents assigned to a project)
// ---------------------------------------------------------------------------

export const projectAgents = sqliteTable(
  'project_agents',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.agentId] }),
  }),
);

// ---------------------------------------------------------------------------
// Queue Templates
// ---------------------------------------------------------------------------

export const queueTemplates = sqliteTable('queue_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  queuesJson: text('queues_json', { mode: 'json' }).$type<QueueTemplateEntry[]>(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export interface QueueTemplateEntry {
  name: string;
  ownerType: 'human' | 'assistant';
  description?: string;
  agentLimit?: number;
}

// ---------------------------------------------------------------------------
// Task Comments (conversation thread per task)
// ---------------------------------------------------------------------------

export const taskComments = sqliteTable('task_comments', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  /** 'human' or agent ID like 'main'. */
  author: text('author').notNull(),
  authorType: text('author_type', { enum: ['human', 'agent'] }).notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ---------------------------------------------------------------------------
// Attachments (metadata — actual files stored on filesystem)
// ---------------------------------------------------------------------------

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  /** Absolute filesystem path to the file. */
  path: text('path').notNull(),
  mimeType: text('mime_type'),
  /** File size in bytes. */
  size: integer('size'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ---------------------------------------------------------------------------
// Task History (audit trail)
// ---------------------------------------------------------------------------

export const taskHistory = sqliteTable('task_history', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  fromQueueId: text('from_queue_id'),
  toQueueId: text('to_queue_id'),
  /** Who triggered this: 'human' or an agent ID. */
  actor: text('actor').notNull(),
  note: text('note'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});
