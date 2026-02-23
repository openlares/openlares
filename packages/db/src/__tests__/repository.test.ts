import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema.js';
import {
  createDashboard,
  getDashboard,
  listDashboards,
  createQueue,
  listQueues,
  createTransition,
  listTransitions,
  createTask,
  getTask,
  listTasks,
  moveTask,
  claimTask,
  completeTask,
  failTask,
  getNextClaimableTask,
  getTaskHistory,
  seedDefaultDashboard,
} from '../repository.js';
import type { OpenlareDb } from '../client.js';

// Use in-memory SQLite for tests
function createTestDb(): OpenlareDb {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  // Create tables
  sqlite.exec(`
    CREATE TABLE dashboards (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, config TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE queues (
      id TEXT PRIMARY KEY, dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
      name TEXT NOT NULL, owner_type TEXT NOT NULL, description TEXT,
      position INTEGER NOT NULL DEFAULT 0, agent_limit INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE transitions (
      id TEXT PRIMARY KEY, from_queue_id TEXT NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
      to_queue_id TEXT NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
      actor_type TEXT NOT NULL, conditions TEXT, auto_trigger INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
      queue_id TEXT NOT NULL REFERENCES queues(id), title TEXT NOT NULL, description TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      session_key TEXT, assigned_agent TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER
    );
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      filename TEXT NOT NULL, path TEXT NOT NULL, mime_type TEXT, size INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE task_history (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      from_queue_id TEXT, to_queue_id TEXT, actor TEXT NOT NULL, note TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  return drizzle(sqlite, { schema });
}

describe('Dashboard', () => {
  let db: OpenlareDb;
  beforeEach(() => {
    db = createTestDb();
  });

  it('creates and retrieves a dashboard', () => {
    const d = createDashboard(db, { name: 'Test Board' });
    expect(d.name).toBe('Test Board');
    expect(d.id).toBeTruthy();

    const fetched = getDashboard(db, d.id);
    expect(fetched?.name).toBe('Test Board');
  });

  it('lists dashboards', () => {
    createDashboard(db, { name: 'A' });
    createDashboard(db, { name: 'B' });
    expect(listDashboards(db)).toHaveLength(2);
  });
});

describe('Queues', () => {
  let db: OpenlareDb;
  let dashboardId: string;

  beforeEach(() => {
    db = createTestDb();
    dashboardId = createDashboard(db, { name: 'Board' }).id;
  });

  it('creates queues with correct order', () => {
    createQueue(db, { dashboardId, name: 'Todo', ownerType: 'human', position: 0 });
    createQueue(db, { dashboardId, name: 'Done', ownerType: 'human', position: 2 });
    createQueue(db, { dashboardId, name: 'In Progress', ownerType: 'assistant', position: 1 });

    const qs = listQueues(db, dashboardId);
    expect(qs).toHaveLength(3);
    expect(qs.map((q) => q.name)).toEqual(['Todo', 'In Progress', 'Done']);
  });
});

describe('Transitions', () => {
  let db: OpenlareDb;
  let dashboardId: string;
  let todoId: string;
  let inProgressId: string;

  beforeEach(() => {
    db = createTestDb();
    dashboardId = createDashboard(db, { name: 'Board' }).id;
    todoId = createQueue(db, { dashboardId, name: 'Todo', ownerType: 'human', position: 0 }).id;
    inProgressId = createQueue(db, {
      dashboardId,
      name: 'In Progress',
      ownerType: 'assistant',
      position: 1,
    }).id;
  });

  it('creates and lists transitions', () => {
    createTransition(db, { fromQueueId: todoId, toQueueId: inProgressId, actorType: 'human' });
    const ts = listTransitions(db, dashboardId);
    expect(ts).toHaveLength(1);
    expect(ts[0]!.fromQueueId).toBe(todoId);
    expect(ts[0]!.toQueueId).toBe(inProgressId);
  });
});

describe('Tasks', () => {
  let db: OpenlareDb;
  let dashboardId: string;
  let todoId: string;
  let inProgressId: string;
  let doneId: string;

  beforeEach(() => {
    db = createTestDb();
    dashboardId = createDashboard(db, { name: 'Board' }).id;
    todoId = createQueue(db, { dashboardId, name: 'Todo', ownerType: 'human', position: 0 }).id;
    inProgressId = createQueue(db, {
      dashboardId,
      name: 'In Progress',
      ownerType: 'assistant',
      position: 1,
    }).id;
    doneId = createQueue(db, { dashboardId, name: 'Done', ownerType: 'human', position: 2 }).id;
    createTransition(db, { fromQueueId: todoId, toQueueId: inProgressId, actorType: 'human' });
    createTransition(db, { fromQueueId: inProgressId, toQueueId: doneId, actorType: 'assistant' });
  });

  it('creates a task in a queue', () => {
    const task = createTask(db, { dashboardId, queueId: todoId, title: 'Fix bug' });
    expect(task.title).toBe('Fix bug');
    expect(task.queueId).toBe(todoId);
    expect(task.status).toBe('pending');
  });

  it('lists tasks ordered by priority then creation time', () => {
    createTask(db, { dashboardId, queueId: todoId, title: 'Low', priority: 0 });
    createTask(db, { dashboardId, queueId: todoId, title: 'High', priority: 10 });
    createTask(db, { dashboardId, queueId: todoId, title: 'Medium', priority: 5 });

    const ts = listTasks(db, todoId);
    expect(ts.map((t) => t.title)).toEqual(['High', 'Medium', 'Low']);
  });

  it('moves a task via valid transition', () => {
    const task = createTask(db, { dashboardId, queueId: todoId, title: 'Move me' });
    const moved = moveTask(db, task.id, inProgressId, 'human');
    expect(moved?.queueId).toBe(inProgressId);
    expect(moved?.status).toBe('pending');
  });

  it('rejects invalid transitions', () => {
    const task = createTask(db, { dashboardId, queueId: todoId, title: 'Stay put' });
    // No direct transition from todo → done
    const result = moveTask(db, task.id, doneId, 'human');
    expect(result).toBeNull();
  });

  it('records history on move', () => {
    const task = createTask(db, { dashboardId, queueId: todoId, title: 'Track me' });
    moveTask(db, task.id, inProgressId, 'human', 'Starting work');

    const history = getTaskHistory(db, task.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.fromQueueId).toBe(todoId);
    expect(history[0]!.toQueueId).toBe(inProgressId);
    expect(history[0]!.actor).toBe('human');
    expect(history[0]!.note).toBe('Starting work');
  });

  it('claims and completes a task', () => {
    const task = createTask(db, { dashboardId, queueId: inProgressId, title: 'Work on me' });

    const claimed = claimTask(db, task.id, 'main', 'session-123');
    expect(claimed?.status).toBe('executing');
    expect(claimed?.sessionKey).toBe('session-123');
    expect(claimed?.assignedAgent).toBe('main');

    const completed = completeTask(db, task.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.completedAt).toBeTruthy();
  });

  it('fails a task', () => {
    const task = createTask(db, { dashboardId, queueId: inProgressId, title: 'Fail me' });
    claimTask(db, task.id, 'main', 'session-456');

    const failed = failTask(db, task.id);
    expect(failed?.status).toBe('failed');
  });

  it('cannot claim a non-pending task', () => {
    const task = createTask(db, { dashboardId, queueId: inProgressId, title: 'Busy' });
    claimTask(db, task.id, 'main', 'session-1');
    const again = claimTask(db, task.id, 'main', 'session-2');
    expect(again).toBeNull();
  });
});

describe('getNextClaimableTask', () => {
  let db: OpenlareDb;
  let dashboardId: string;
  let todoId: string;
  let inProgressId: string;

  beforeEach(() => {
    db = createTestDb();
    dashboardId = createDashboard(db, { name: 'Board' }).id;
    todoId = createQueue(db, { dashboardId, name: 'Todo', ownerType: 'human', position: 0 }).id;
    inProgressId = createQueue(db, {
      dashboardId,
      name: 'In Progress',
      ownerType: 'assistant',
      position: 1,
      agentLimit: 1,
    }).id;
  });

  it('returns highest priority pending task from assistant queues', () => {
    createTask(db, { dashboardId, queueId: inProgressId, title: 'Low', priority: 1 });
    createTask(db, { dashboardId, queueId: inProgressId, title: 'High', priority: 10 });

    const next = getNextClaimableTask(db, dashboardId);
    expect(next?.title).toBe('High');
  });

  it('skips human-owned queues', () => {
    createTask(db, { dashboardId, queueId: todoId, title: 'Human task' });
    const next = getNextClaimableTask(db, dashboardId);
    expect(next).toBeUndefined();
  });

  it('respects agent limit', () => {
    const task1 = createTask(db, {
      dashboardId,
      queueId: inProgressId,
      title: 'First',
      priority: 10,
    });
    createTask(db, { dashboardId, queueId: inProgressId, title: 'Second', priority: 5 });

    claimTask(db, task1.id, 'main', 'session-1');

    // Agent limit is 1, one task executing → no more claimable
    const next = getNextClaimableTask(db, dashboardId);
    expect(next).toBeUndefined();
  });
});

describe('seedDefaultDashboard', () => {
  it('creates default todo → in-progress → done pipeline', () => {
    const db = createTestDb();
    const dashboard = seedDefaultDashboard(db);
    expect(dashboard.name).toBe('Default');

    const qs = listQueues(db, dashboard.id);
    expect(qs).toHaveLength(3);
    expect(qs.map((q) => q.name)).toEqual(['Todo', 'In Progress', 'Done']);
    expect(qs.map((q) => q.ownerType)).toEqual(['human', 'assistant', 'human']);

    const ts = listTransitions(db, dashboard.id);
    expect(ts).toHaveLength(3); // todo→ip, ip→done, ip→todo
  });

  it('returns existing dashboard on second call', () => {
    const db = createTestDb();
    const first = seedDefaultDashboard(db);
    const second = seedDefaultDashboard(db);
    expect(second.id).toBe(first.id);
  });
});
