import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';
import {
  createDashboard,
  getDashboard,
  updateDashboard,
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
  setTaskError,
  clearTaskError,
  releaseTask,
  updateTask,
  deleteTask,
  deleteQueue,
  deleteTransition,
  updateQueuePositions,
  getNextClaimableTask,
  getTaskHistory,
  seedDefaultDashboard,
  addComment,
  listComments,
} from '../repository';
import type { OpenlareDb } from '../client';

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
      session_key TEXT, assigned_agent TEXT,
      error TEXT, error_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      filename TEXT NOT NULL, path TEXT NOT NULL, mime_type TEXT, size INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE task_comments (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      author TEXT NOT NULL, author_type TEXT NOT NULL,
      content TEXT NOT NULL, created_at INTEGER NOT NULL
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
    expect(task.assignedAgent).toBeNull();
    expect(task.error).toBeNull();
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
    expect(moved?.assignedAgent).toBeNull();
    expect(moved?.error).toBeNull();
  });

  it('allows free movement when strictTransitions is off (default)', () => {
    const task = createTask(db, { dashboardId, queueId: todoId, title: 'Free mover' });
    // No direct transition from todo → done, but strictTransitions is off
    const result = moveTask(db, task.id, doneId, 'human');
    expect(result).not.toBeNull();
    expect(result!.queueId).toBe(doneId);
  });

  it('rejects invalid transitions when strictTransitions is on', () => {
    updateDashboard(db, dashboardId, { config: { strictTransitions: true } });
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

  it('claims and releases a task', () => {
    const task = createTask(db, { dashboardId, queueId: inProgressId, title: 'Work on me' });

    const claimed = claimTask(db, task.id, 'main', 'session-123');
    expect(claimed?.sessionKey).toBe('session-123');
    expect(claimed?.assignedAgent).toBe('main');

    const released = releaseTask(db, task.id);
    expect(released?.assignedAgent).toBeNull();
    expect(released?.sessionKey).toBeNull();
  });

  it('sets error on a task', () => {
    const task = createTask(db, { dashboardId, queueId: inProgressId, title: 'Fail me' });
    claimTask(db, task.id, 'main', 'session-456');

    const errored = setTaskError(db, task.id, 'Something went wrong');
    expect(errored?.error).toBe('Something went wrong');
    expect(errored?.errorAt).toBeTruthy();
    expect(errored?.assignedAgent).toBeNull();
  });

  it('cannot claim an assigned task', () => {
    const task = createTask(db, { dashboardId, queueId: inProgressId, title: 'Busy' });
    claimTask(db, task.id, 'main', 'session-1');
    const again = claimTask(db, task.id, 'main', 'session-2');
    expect(again).toBeNull();
  });

  it('setTaskError marks task and clears assignment', () => {
    const task = createTask(db, { dashboardId, queueId: inProgressId, title: 'Error test' });
    claimTask(db, task.id, 'main', 'session-abc');

    const errored = setTaskError(db, task.id, 'Network failure');
    expect(errored?.error).toBe('Network failure');
    expect(errored?.errorAt).toBeInstanceOf(Date);
    expect(errored?.assignedAgent).toBeNull();
    expect(errored?.sessionKey).toBeNull();
  });

  it('clearTaskError allows task to be claimed again', () => {
    const task = createTask(db, { dashboardId, queueId: inProgressId, title: 'Clear error' });
    setTaskError(db, task.id, 'Some error');

    // Cannot claim when error is set
    const failedClaim = claimTask(db, task.id, 'main', 'session-xyz');
    expect(failedClaim).toBeNull();

    const cleared = clearTaskError(db, task.id);
    expect(cleared?.error).toBeNull();
    expect(cleared?.errorAt).toBeNull();

    // Now can claim
    const claimed = claimTask(db, task.id, 'main', 'session-xyz');
    expect(claimed?.assignedAgent).toBe('main');
  });

  it('moveTask clears error and assignment', () => {
    const task = createTask(db, { dashboardId, queueId: todoId, title: 'Move with error' });
    // Manually set an error by going through inProgress first
    const moved = moveTask(db, task.id, inProgressId, 'human');
    expect(moved).not.toBeNull();
    setTaskError(db, task.id, 'Old error');

    // Now move back (requires transition inProgress -> todo, but we only have inProgress -> done)
    // Use a task that starts in inProgress
    const task2 = createTask(db, { dashboardId, queueId: inProgressId, title: 'Move back' });
    setTaskError(db, task2.id, 'Old error');
    const moved2 = moveTask(db, task2.id, doneId, 'agent');
    expect(moved2?.error).toBeNull();
    expect(moved2?.errorAt).toBeNull();
    expect(moved2?.assignedAgent).toBeNull();
    expect(moved2?.queueId).toBe(doneId);
  });

  it('updates a task title and description', () => {
    const task = createTask(db, { dashboardId, queueId: todoId, title: 'Original' });
    const updated = updateTask(db, task.id, { title: 'Changed', description: 'New desc' });
    expect(updated?.title).toBe('Changed');
    expect(updated?.description).toBe('New desc');
  });

  it('updates only specified fields', () => {
    const task = createTask(db, {
      dashboardId,
      queueId: todoId,
      title: 'Keep',
      priority: 5,
    });
    const updated = updateTask(db, task.id, { priority: 10 });
    expect(updated?.title).toBe('Keep');
    expect(updated?.priority).toBe(10);
  });

  it('returns null when updating non-existent task', () => {
    expect(updateTask(db, 'nope', { title: 'X' })).toBeNull();
  });

  it('deletes a task', () => {
    const task = createTask(db, { dashboardId, queueId: todoId, title: 'Delete me' });
    expect(deleteTask(db, task.id)).toBe(true);
    expect(getTask(db, task.id)).toBeUndefined();
  });

  it('returns false when deleting non-existent task', () => {
    expect(deleteTask(db, 'nope')).toBe(false);
  });

  it('delete cascades to history', () => {
    const task = createTask(db, { dashboardId, queueId: todoId, title: 'Track' });
    moveTask(db, task.id, inProgressId, 'human');
    expect(getTaskHistory(db, task.id)).toHaveLength(1);
    deleteTask(db, task.id);
    expect(getTaskHistory(db, task.id)).toHaveLength(0);
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

    // Agent limit is 1, one task assigned → no more claimable
    const next = getNextClaimableTask(db, dashboardId);
    expect(next).toBeUndefined();
  });

  it('getNextClaimableTask skips tasks with errors', () => {
    const task1 = createTask(db, {
      dashboardId,
      queueId: inProgressId,
      title: 'Errored',
      priority: 10,
    });
    const task2 = createTask(db, {
      dashboardId,
      queueId: inProgressId,
      title: 'Healthy',
      priority: 5,
    });

    setTaskError(db, task1.id, 'Some error');

    const next = getNextClaimableTask(db, dashboardId);
    expect(next?.id).toBe(task2.id);
    expect(next?.title).toBe('Healthy');
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
    expect(ts).toHaveLength(5); // todo→ip, ip→done, ip→todo, done→todo, done→ip
  });

  it('returns existing dashboard on second call', () => {
    const db = createTestDb();
    const first = seedDefaultDashboard(db);
    const second = seedDefaultDashboard(db);
    expect(second.id).toBe(first.id);
  });
});

describe('deleteQueue', () => {
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

  it('deletes a queue and cascades transitions', () => {
    const deleted = deleteQueue(db, inProgressId);
    expect(deleted).toBe(true);

    const remaining = listQueues(db, dashboardId);
    expect(remaining).toHaveLength(2);
    expect(remaining.map((q) => q.id)).not.toContain(inProgressId);

    // Transitions referencing the deleted queue should be gone (cascade)
    const ts = listTransitions(db, dashboardId);
    expect(ts).toHaveLength(0);
  });

  it('returns false when queue not found', () => {
    expect(deleteQueue(db, 'nonexistent')).toBe(false);
  });

  it('refuses to delete the last queue in a dashboard', () => {
    // Delete two of the three queues first (using the DB directly to bypass safety)
    deleteQueue(db, inProgressId);
    deleteQueue(db, doneId);
    // Only todoId remains
    const result = deleteQueue(db, todoId);
    expect(result).toBe(false);
    expect(listQueues(db, dashboardId)).toHaveLength(1);
  });

  it('refuses to delete a queue that has tasks', () => {
    createTask(db, { dashboardId, queueId: todoId, title: 'Blocking task' });
    const result = deleteQueue(db, todoId);
    expect(result).toBe(false);
    expect(listQueues(db, dashboardId)).toHaveLength(3);
  });
});

describe('deleteTransition', () => {
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

  it('deletes a transition', () => {
    const t = createTransition(db, {
      fromQueueId: todoId,
      toQueueId: inProgressId,
      actorType: 'human',
    });
    const deleted = deleteTransition(db, t.id);
    expect(deleted).toBe(true);
    expect(listTransitions(db, dashboardId)).toHaveLength(0);
  });

  it('returns false when transition not found', () => {
    expect(deleteTransition(db, 'nonexistent')).toBe(false);
  });
});

describe('updateQueuePositions', () => {
  let db: OpenlareDb;
  let dashboardId: string;
  let q1Id: string;
  let q2Id: string;
  let q3Id: string;

  beforeEach(() => {
    db = createTestDb();
    dashboardId = createDashboard(db, { name: 'Board' }).id;
    q1Id = createQueue(db, { dashboardId, name: 'Q1', ownerType: 'human', position: 0 }).id;
    q2Id = createQueue(db, { dashboardId, name: 'Q2', ownerType: 'human', position: 1 }).id;
    q3Id = createQueue(db, { dashboardId, name: 'Q3', ownerType: 'human', position: 2 }).id;
  });

  it('batch-updates positions', () => {
    updateQueuePositions(db, [
      { id: q1Id, position: 2 },
      { id: q2Id, position: 0 },
      { id: q3Id, position: 1 },
    ]);

    const qs = listQueues(db, dashboardId);
    expect(qs.map((q) => q.name)).toEqual(['Q2', 'Q3', 'Q1']);
  });

  it('is a no-op for empty array', () => {
    updateQueuePositions(db, []);
    const qs = listQueues(db, dashboardId);
    expect(qs.map((q) => q.position)).toEqual([0, 1, 2]);
  });
});

describe('Task Comments', () => {
  let db: OpenlareDb;
  let dashboardId: string;
  let queueId: string;
  let taskId: string;

  beforeEach(() => {
    db = createTestDb();
    dashboardId = createDashboard(db, { name: 'Board' }).id;
    queueId = createQueue(db, { dashboardId, name: 'Todo', ownerType: 'human', position: 0 }).id;
    taskId = createTask(db, { dashboardId, queueId, title: 'Comment test' }).id;
  });

  it('adds a comment and retrieves it', () => {
    const comment = addComment(db, taskId, 'main', 'agent', 'Task done!');
    expect(comment.id).toBeTruthy();
    expect(comment.taskId).toBe(taskId);
    expect(comment.author).toBe('main');
    expect(comment.authorType).toBe('agent');
    expect(comment.content).toBe('Task done!');
    expect(comment.createdAt).toBeInstanceOf(Date);
  });

  it('lists comments in chronological order', () => {
    addComment(db, taskId, 'main', 'agent', 'First response');
    addComment(db, taskId, 'human', 'human', 'Not satisfied');
    addComment(db, taskId, 'main', 'agent', 'Second response');

    const comments = listComments(db, taskId);
    expect(comments).toHaveLength(3);
    expect(comments[0]!.content).toBe('First response');
    expect(comments[1]!.content).toBe('Not satisfied');
    expect(comments[2]!.content).toBe('Second response');
  });

  it('returns empty array for task with no comments', () => {
    expect(listComments(db, taskId)).toHaveLength(0);
  });

  it('cascades delete when task is deleted', () => {
    addComment(db, taskId, 'human', 'human', 'A comment');
    expect(listComments(db, taskId)).toHaveLength(1);

    deleteTask(db, taskId);
    expect(listComments(db, taskId)).toHaveLength(0);
  });
});
