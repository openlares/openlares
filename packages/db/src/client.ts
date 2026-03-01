/**
 * Database client — creates and manages the SQLite connection.
 *
 * Usage:
 *   import { createDb } from '@openlares/db';
 *   const db = createDb('/path/to/openlares.db');
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type OpenlareDb = BetterSQLite3Database<typeof schema>;

/**
 * Create a new database connection. Runs WAL mode for performance and
 * applies migrations (creates tables if they don't exist).
 */
export function createDb(filepath: string): OpenlareDb {
  const sqlite = new Database(filepath);

  // WAL mode for concurrent reads + single writer performance
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  // Bootstrap tables if they don't exist (push-based for simplicity)
  ensureTables(sqlite);

  return db;
}

/**
 * Create tables if they don't exist.
 * Uses CREATE TABLE IF NOT EXISTS for zero-migration simplicity.
 */
function ensureTables(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER,
      system_prompt TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS queues (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      owner_type TEXT NOT NULL CHECK(owner_type IN ('human', 'assistant')),
      description TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      agent_limit INTEGER NOT NULL DEFAULT 1,
      system_prompt TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transitions (
      id TEXT PRIMARY KEY,
      from_queue_id TEXT NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
      to_queue_id TEXT NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
      actor_type TEXT NOT NULL CHECK(actor_type IN ('human', 'assistant', 'both')),
      conditions TEXT,
      auto_trigger INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      queue_id TEXT NOT NULL REFERENCES queues(id),
      title TEXT NOT NULL,
      description TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      session_key TEXT,
      assigned_agent TEXT,
      error TEXT,
      error_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_agents (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      PRIMARY KEY (project_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS queue_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      queues_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      author_type TEXT NOT NULL CHECK(author_type IN ('human', 'agent')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      path TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_history (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      from_queue_id TEXT,
      to_queue_id TEXT,
      actor TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_queue ON tasks(queue_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);
    CREATE INDEX IF NOT EXISTS idx_queues_project ON queues(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_agents_project ON project_agents(project_id);
  `);
}
