import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';
import {
  createProject,
  getProject,
  updateProject,
  listProjects,
  touchProject,
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
  seedDefaultProject,
  addComment,
  listComments,
  assignAgent,
  removeAgent,
  listProjectAgents,
  createQueueTemplate,
  listQueueTemplates,
  deleteQueueTemplate,
  createProjectFromTemplate,
  createProjectWithDefaults,
} from '../repository';
import type { OpenlareDb } from '../client';

// Use in-memory SQLite for tests
function createTestDb(): OpenlareDb {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  // Create tables
  sqlite.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, config TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER,
      system_prompt TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE queues (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL, owner_type TEXT NOT NULL, description TEXT,
      position INTEGER NOT NULL DEFAULT 0, agent_limit INTEGER NOT NULL DEFAULT 1,
      system_prompt TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE transitions (
      id TEXT PRIMARY KEY, from_queue_id TEXT NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
      to_queue_id TEXT NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
      actor_type TEXT NOT NULL, conditions TEXT, auto_trigger INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      queue_id TEXT NOT NULL REFERENCES queues(id), title TEXT NOT NULL, description TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      session_key TEXT, assigned_agent TEXT,
      error TEXT, error_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE project_agents (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      PRIMARY KEY (project_id, agent_id)
    );
    CREATE TABLE queue_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      queues_json TEXT,
      created_at INTEGER NOT NULL
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

describe('Project', () => {
  let db: OpenlareDb;
  beforeEach(() => {
    db = createTestDb();
  });

  it('creates and retrieves a project', () => {
    const p = createProject(db, { name: 'Test Board' });
    expect(p.name).toBe('Test Board');
    expect(p.id).toBeTruthy();

    const fetched = getProject(db, p.id);
    expect(fetched?.name).toBe('Test Board');
  });

  it('lists projects', () => {
    createProject(db, { name: 'A' });
    createProject(db, { name: 'B' });
    expect(listProjects(db)).toHaveLength(2);
  });

  it('creates a project with systemPrompt', () => {
    const p = createProject(db, { name: 'Prompted', systemPrompt: 'You are helpful.' });
    expect(p.systemPrompt).toBe('You are helpful.');
  });

  it('updates a project name', () => {
    const p = createProject(db, { name: 'Old Name' });
    const updated = updateProject(db, p.id, { name: 'New Name' });
    expect(updated?.name).toBe('New Name');
  });

  it('returns null when updating non-existent project', () => {
    expect(updateProject(db, 'nope', { name: 'X' })).toBeNull();
  });
});

describe('Queues', () => {
  let db: OpenlareDb;
  let projectId: string;

  beforeEach(() => {
    db = createTestDb();
    projectId = createProject(db, { name: 'Board' }).id;
  });

  it('creates queues with correct order', () => {
    createQueue(db, { projectId, name: 'Todo', ownerType: 'human', position: 0 });
    createQueue(db, { projectId, name: 'Done', ownerType: 'human', position: 2 });
    createQueue(db, { projectId, name: 'In Progress', ownerType: 'assistant', position: 1 });

    const qs = listQueues(db, projectId);
    expect(qs).toHaveLength(3);
    expect(qs.map((q) => q.name)).toEqual(['Todo', 'In Progress', 'Done']);
  });
});

describe('Transitions', () => {
  let db: OpenlareDb;
  let projectId: string;
  let todoId: string;
  let inProgressId: string;

  beforeEach(() => {
    db = createTestDb();
    projectId = createProject(db, { name: 'Board' }).id;
    todoId = createQueue(db, { projectId, name: 'Todo', ownerType: 'human', position: 0 }).id;
    inProgressId = createQueue(db, {
      projectId,
      name: 'In Progress',
      ownerType: 'assistant',
      position: 1,
    }).id;
  });

  it('creates and lists transitions', () => {
    createTransition(db, { fromQueueId: todoId, toQueueId: inProgressId, actorType: 'human' });
    const ts = listTransitions(db, projectId);
    expect(ts).toHaveLength(1);
    expect(ts[0]!.fromQueueId).toBe(todoId);
    expect(ts[0]!.toQueueId).toBe(inProgressId);
  });
});

describe('Tasks', () => {
  let db: OpenlareDb;
  let projectId: string;
  let todoId: string;
  let inProgressId: string;
  let doneId: string;

  beforeEach(() => {
    db = createTestDb();
    projectId = createProject(db, { name: 'Board' }).id;
    todoId = createQueue(db, { projectId, name: 'Todo', ownerType: 'human', position: 0 }).id;
    inProgressId = createQueue(db, {
      projectId,
      name: 'In Progress',
      ownerType: 'assistant',
      position: 1,
    }).id;
    doneId = createQueue(db, { projectId, name: 'Done', ownerType: 'human', position: 2 }).id;
    createTransition(db, { fromQueueId: todoId, toQueueId: inProgressId, actorType: 'human' });
    createTransition(db, { fromQueueId: inProgressId, toQueueId: doneId, actorType: 'assistant' });
  });

  it('creates a task in a queue', () => {
    const task = createTask(db, { projectId, queueId: todoId, title: 'Fix bug' });
    expect(task.title).toBe('Fix bug');
    expect(task.queueId).toBe(todoId);
    expect(task.assignedAgent).toBeNull();
    expect(task.error).toBeNull();
  });

  it('lists tasks ordered by priority then creation time', () => {
    createTask(db, { projectId, queueId: todoId, title: 'Low', priority: 0 });
    createTask(db, { projectId, queueId: todoId, title: 'High', priority: 10 });
    createTask(db, { projectId, queueId: todoId, title: 'Medium', priority: 5 });

    const ts = listTasks(db, todoId);
    expect(ts.map((t) => t.title)).toEqual(['High', 'Medium', 'Low']);
  });

  it('moves a task via valid transition', () => {
    const task = createTask(db, { projectId, queueId: todoId, title: 'Move me' });
    const moved = moveTask(db, task.id, inProgressId, 'human');
    expect(moved?.queueId).toBe(inProgressId);
    expect(moved?.assignedAgent).toBeNull();
    expect(moved?.error).toBeNull();
  });

  it('allows free movement when strictTransitions is off (default)', () => {
    const task = createTask(db, { projectId, queueId: todoId, title: 'Free mover' });
    // No direct transition from todo → done, but strictTransitions is off
    const result = moveTask(db, task.id, doneId, 'human');
    expect(result).not.toBeNull();
    expect(result!.queueId).toBe(doneId);
  });

  it('rejects invalid transitions when strictTransitions is on', () => {
    updateProject(db, projectId, { config: { strictTransitions: true } });
    const task = createTask(db, { projectId, queueId: todoId, title: 'Stay put' });
    // No direct transition from todo → done
    const result = moveTask(db, task.id, doneId, 'human');
    expect(result).toBeNull();
  });

  it('records history on move', () => {
    const task = createTask(db, { projectId, queueId: todoId, title: 'Track me' });
    moveTask(db, task.id, inProgressId, 'human', 'Starting work');

    const history = getTaskHistory(db, task.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.fromQueueId).toBe(todoId);
    expect(history[0]!.toQueueId).toBe(inProgressId);
    expect(history[0]!.actor).toBe('human');
    expect(history[0]!.note).toBe('Starting work');
  });

  it('claims and releases a task', () => {
    const task = createTask(db, { projectId, queueId: inProgressId, title: 'Work on me' });

    const claimed = claimTask(db, task.id, 'main', 'session-123');
    expect(claimed?.sessionKey).toBe('session-123');
    expect(claimed?.assignedAgent).toBe('main');

    const released = releaseTask(db, task.id);
    expect(released?.assignedAgent).toBeNull();
    expect(released?.sessionKey).toBeNull();
  });

  it('sets error on a task', () => {
    const task = createTask(db, { projectId, queueId: inProgressId, title: 'Fail me' });
    claimTask(db, task.id, 'main', 'session-456');

    const errored = setTaskError(db, task.id, 'Something went wrong');
    expect(errored?.error).toBe('Something went wrong');
    expect(errored?.errorAt).toBeTruthy();
    expect(errored?.assignedAgent).toBeNull();
  });

  it('cannot claim an assigned task', () => {
    const task = createTask(db, { projectId, queueId: inProgressId, title: 'Busy' });
    claimTask(db, task.id, 'main', 'session-1');
    const again = claimTask(db, task.id, 'main', 'session-2');
    expect(again).toBeNull();
  });

  it('setTaskError marks task and clears assignment', () => {
    const task = createTask(db, { projectId, queueId: inProgressId, title: 'Error test' });
    claimTask(db, task.id, 'main', 'session-abc');

    const errored = setTaskError(db, task.id, 'Network failure');
    expect(errored?.error).toBe('Network failure');
    expect(errored?.errorAt).toBeInstanceOf(Date);
    expect(errored?.assignedAgent).toBeNull();
    expect(errored?.sessionKey).toBeNull();
  });

  it('clearTaskError allows task to be claimed again', () => {
    const task = createTask(db, { projectId, queueId: inProgressId, title: 'Clear error' });
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
    const task = createTask(db, { projectId, queueId: todoId, title: 'Move with error' });
    // Manually set an error by going through inProgress first
    const moved = moveTask(db, task.id, inProgressId, 'human');
    expect(moved).not.toBeNull();
    setTaskError(db, task.id, 'Old error');

    // Now move back (requires transition inProgress -> todo, but we only have inProgress -> done)
    // Use a task that starts in inProgress
    const task2 = createTask(db, { projectId, queueId: inProgressId, title: 'Move back' });
    setTaskError(db, task2.id, 'Old error');
    const moved2 = moveTask(db, task2.id, doneId, 'agent');
    expect(moved2?.error).toBeNull();
    expect(moved2?.errorAt).toBeNull();
    expect(moved2?.assignedAgent).toBeNull();
    expect(moved2?.queueId).toBe(doneId);
  });

  it('updates a task title and description', () => {
    const task = createTask(db, { projectId, queueId: todoId, title: 'Original' });
    const updated = updateTask(db, task.id, { title: 'Changed', description: 'New desc' });
    expect(updated?.title).toBe('Changed');
    expect(updated?.description).toBe('New desc');
  });

  it('updates only specified fields', () => {
    const task = createTask(db, {
      projectId,
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
    const task = createTask(db, { projectId, queueId: todoId, title: 'Delete me' });
    expect(deleteTask(db, task.id)).toBe(true);
    expect(getTask(db, task.id)).toBeUndefined();
  });

  it('returns false when deleting non-existent task', () => {
    expect(deleteTask(db, 'nope')).toBe(false);
  });

  it('delete cascades to history', () => {
    const task = createTask(db, { projectId, queueId: todoId, title: 'Track' });
    moveTask(db, task.id, inProgressId, 'human');
    expect(getTaskHistory(db, task.id)).toHaveLength(1);
    deleteTask(db, task.id);
    expect(getTaskHistory(db, task.id)).toHaveLength(0);
  });
});

describe('getNextClaimableTask', () => {
  let db: OpenlareDb;
  let projectId: string;
  let todoId: string;
  let inProgressId: string;

  beforeEach(() => {
    db = createTestDb();
    projectId = createProject(db, { name: 'Board' }).id;
    todoId = createQueue(db, { projectId, name: 'Todo', ownerType: 'human', position: 0 }).id;
    inProgressId = createQueue(db, {
      projectId,
      name: 'In Progress',
      ownerType: 'assistant',
      position: 1,
      agentLimit: 1,
    }).id;
  });

  it('returns highest priority pending task from assistant queues', () => {
    createTask(db, { projectId, queueId: inProgressId, title: 'Low', priority: 1 });
    createTask(db, { projectId, queueId: inProgressId, title: 'High', priority: 10 });

    const next = getNextClaimableTask(db, projectId);
    expect(next?.title).toBe('High');
  });

  it('skips human-owned queues', () => {
    createTask(db, { projectId, queueId: todoId, title: 'Human task' });
    const next = getNextClaimableTask(db, projectId);
    expect(next).toBeUndefined();
  });

  it('respects agent limit', () => {
    const task1 = createTask(db, {
      projectId,
      queueId: inProgressId,
      title: 'First',
      priority: 10,
    });
    createTask(db, { projectId, queueId: inProgressId, title: 'Second', priority: 5 });

    claimTask(db, task1.id, 'main', 'session-1');

    // Agent limit is 1, one task assigned → no more claimable
    const next = getNextClaimableTask(db, projectId);
    expect(next).toBeUndefined();
  });

  it('getNextClaimableTask skips tasks with errors', () => {
    const task1 = createTask(db, {
      projectId,
      queueId: inProgressId,
      title: 'Errored',
      priority: 10,
    });
    const task2 = createTask(db, {
      projectId,
      queueId: inProgressId,
      title: 'Healthy',
      priority: 5,
    });

    setTaskError(db, task1.id, 'Some error');

    const next = getNextClaimableTask(db, projectId);
    expect(next?.id).toBe(task2.id);
    expect(next?.title).toBe('Healthy');
  });
});

describe('seedDefaultProject', () => {
  it('creates default todo → in-progress → done pipeline', () => {
    const db = createTestDb();
    const project = seedDefaultProject(db);
    expect(project.name).toBe('Default');

    const qs = listQueues(db, project.id);
    expect(qs).toHaveLength(3);
    expect(qs.map((q) => q.name)).toEqual(['Todo', 'In Progress', 'Done']);
    expect(qs.map((q) => q.ownerType)).toEqual(['human', 'assistant', 'human']);

    const ts = listTransitions(db, project.id);
    expect(ts).toHaveLength(5); // todo→ip, ip→done, ip→todo, done→todo, done→ip
  });

  it('returns existing project on second call', () => {
    const db = createTestDb();
    const first = seedDefaultProject(db);
    const second = seedDefaultProject(db);
    expect(second.id).toBe(first.id);
  });
});

describe('deleteQueue', () => {
  let db: OpenlareDb;
  let projectId: string;
  let todoId: string;
  let inProgressId: string;
  let doneId: string;

  beforeEach(() => {
    db = createTestDb();
    projectId = createProject(db, { name: 'Board' }).id;
    todoId = createQueue(db, { projectId, name: 'Todo', ownerType: 'human', position: 0 }).id;
    inProgressId = createQueue(db, {
      projectId,
      name: 'In Progress',
      ownerType: 'assistant',
      position: 1,
    }).id;
    doneId = createQueue(db, { projectId, name: 'Done', ownerType: 'human', position: 2 }).id;
    createTransition(db, { fromQueueId: todoId, toQueueId: inProgressId, actorType: 'human' });
    createTransition(db, { fromQueueId: inProgressId, toQueueId: doneId, actorType: 'assistant' });
  });

  it('deletes a queue and cascades transitions', () => {
    const deleted = deleteQueue(db, inProgressId);
    expect(deleted).toBe(true);

    const remaining = listQueues(db, projectId);
    expect(remaining).toHaveLength(2);
    expect(remaining.map((q) => q.id)).not.toContain(inProgressId);

    // Transitions referencing the deleted queue should be gone (cascade)
    const ts = listTransitions(db, projectId);
    expect(ts).toHaveLength(0);
  });

  it('returns false when queue not found', () => {
    expect(deleteQueue(db, 'nonexistent')).toBe(false);
  });

  it('refuses to delete the last queue in a project', () => {
    // Delete two of the three queues first (using the DB directly to bypass safety)
    deleteQueue(db, inProgressId);
    deleteQueue(db, doneId);
    // Only todoId remains
    const result = deleteQueue(db, todoId);
    expect(result).toBe(false);
    expect(listQueues(db, projectId)).toHaveLength(1);
  });

  it('refuses to delete a queue that has tasks', () => {
    createTask(db, { projectId, queueId: todoId, title: 'Blocking task' });
    const result = deleteQueue(db, todoId);
    expect(result).toBe(false);
    expect(listQueues(db, projectId)).toHaveLength(3);
  });
});

describe('deleteTransition', () => {
  let db: OpenlareDb;
  let projectId: string;
  let todoId: string;
  let inProgressId: string;

  beforeEach(() => {
    db = createTestDb();
    projectId = createProject(db, { name: 'Board' }).id;
    todoId = createQueue(db, { projectId, name: 'Todo', ownerType: 'human', position: 0 }).id;
    inProgressId = createQueue(db, {
      projectId,
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
    expect(listTransitions(db, projectId)).toHaveLength(0);
  });

  it('returns false when transition not found', () => {
    expect(deleteTransition(db, 'nonexistent')).toBe(false);
  });
});

describe('updateQueuePositions', () => {
  let db: OpenlareDb;
  let projectId: string;
  let q1Id: string;
  let q2Id: string;
  let q3Id: string;

  beforeEach(() => {
    db = createTestDb();
    projectId = createProject(db, { name: 'Board' }).id;
    q1Id = createQueue(db, { projectId, name: 'Q1', ownerType: 'human', position: 0 }).id;
    q2Id = createQueue(db, { projectId, name: 'Q2', ownerType: 'human', position: 1 }).id;
    q3Id = createQueue(db, { projectId, name: 'Q3', ownerType: 'human', position: 2 }).id;
  });

  it('batch-updates positions', () => {
    updateQueuePositions(db, [
      { id: q1Id, position: 2 },
      { id: q2Id, position: 0 },
      { id: q3Id, position: 1 },
    ]);

    const qs = listQueues(db, projectId);
    expect(qs.map((q) => q.name)).toEqual(['Q2', 'Q3', 'Q1']);
  });

  it('is a no-op for empty array', () => {
    updateQueuePositions(db, []);
    const qs = listQueues(db, projectId);
    expect(qs.map((q) => q.position)).toEqual([0, 1, 2]);
  });
});

describe('Task Comments', () => {
  let db: OpenlareDb;
  let projectId: string;
  let queueId: string;
  let taskId: string;

  beforeEach(() => {
    db = createTestDb();
    projectId = createProject(db, { name: 'Board' }).id;
    queueId = createQueue(db, { projectId, name: 'Todo', ownerType: 'human', position: 0 }).id;
    taskId = createTask(db, { projectId, queueId, title: 'Comment test' }).id;
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

describe('Project Agents', () => {
  let db: OpenlareDb;
  let projectId: string;

  beforeEach(() => {
    db = createTestDb();
    projectId = createProject(db, { name: 'Board' }).id;
  });

  it('assigns an agent to a project', () => {
    const row = assignAgent(db, projectId, 'agent-1');
    expect(row.projectId).toBe(projectId);
    expect(row.agentId).toBe('agent-1');
  });

  it('lists project agents', () => {
    assignAgent(db, projectId, 'agent-1');
    assignAgent(db, projectId, 'agent-2');
    const agents = listProjectAgents(db, projectId);
    expect(agents).toHaveLength(2);
    expect(agents).toContain('agent-1');
    expect(agents).toContain('agent-2');
  });

  it('removes an agent from a project', () => {
    assignAgent(db, projectId, 'agent-1');
    const removed = removeAgent(db, projectId, 'agent-1');
    expect(removed).toBe(true);
    expect(listProjectAgents(db, projectId)).toHaveLength(0);
  });

  it('returns empty array when no agents assigned', () => {
    expect(listProjectAgents(db, projectId)).toHaveLength(0);
  });

  it('duplicate assign is idempotent', () => {
    assignAgent(db, projectId, 'agent-1');
    assignAgent(db, projectId, 'agent-1'); // should not throw
    expect(listProjectAgents(db, projectId)).toHaveLength(1);
  });

  it('returns false when removing non-existent agent', () => {
    expect(removeAgent(db, projectId, 'nobody')).toBe(false);
  });
});

describe('Queue Templates', () => {
  let db: OpenlareDb;

  beforeEach(() => {
    db = createTestDb();
  });

  it('creates a template from queue entries', () => {
    const template = createQueueTemplate(db, {
      name: 'Basic Pipeline',
      entries: [
        { name: 'Todo', ownerType: 'human' },
        { name: 'In Progress', ownerType: 'assistant', agentLimit: 2 },
        { name: 'Done', ownerType: 'human' },
      ],
    });
    expect(template.id).toBeTruthy();
    expect(template.name).toBe('Basic Pipeline');
    expect(template.queuesJson).toHaveLength(3);
  });

  it('lists templates', () => {
    createQueueTemplate(db, { name: 'T1', entries: [] });
    createQueueTemplate(db, { name: 'T2', entries: [] });
    expect(listQueueTemplates(db)).toHaveLength(2);
  });

  it('deletes a template', () => {
    const template = createQueueTemplate(db, { name: 'Delete Me', entries: [] });
    const deleted = deleteQueueTemplate(db, template.id);
    expect(deleted).toBe(true);
    expect(listQueueTemplates(db)).toHaveLength(0);
  });

  it('returns false when deleting non-existent template', () => {
    expect(deleteQueueTemplate(db, 'nonexistent')).toBe(false);
  });

  it('creates a project from a template with correct queues', () => {
    const template = createQueueTemplate(db, {
      name: 'Dev Pipeline',
      entries: [
        { name: 'Backlog', ownerType: 'human' },
        { name: 'In Dev', ownerType: 'assistant', agentLimit: 3 },
        { name: 'Review', ownerType: 'human' },
      ],
    });

    const result = createProjectFromTemplate(db, {
      name: 'My Project',
      templateId: template.id,
    });

    expect(result).not.toBeNull();
    expect(result!.project.name).toBe('My Project');
    expect(result!.queues).toHaveLength(3);
    expect(result!.queues.map((q) => q.name)).toEqual(['Backlog', 'In Dev', 'Review']);
    expect(result!.queues[1]!.agentLimit).toBe(3);
  });

  it('returns null when template not found', () => {
    const result = createProjectFromTemplate(db, {
      name: 'Ghost Project',
      templateId: 'no-such-template',
    });
    expect(result).toBeNull();
  });
});

describe('Project ordering', () => {
  let db: OpenlareDb;

  beforeEach(() => {
    db = createTestDb();
  });

  it('lists pinned projects first', () => {
    const p1 = createProject(db, { name: 'Unpinned A' });
    const p2 = createProject(db, { name: 'Pinned B' });
    updateProject(db, p2.id, { pinned: true });

    const list = listProjects(db);
    expect(list[0]!.id).toBe(p2.id);
    expect(list[1]!.id).toBe(p1.id);
  });

  it('orders by lastAccessedAt within groups', () => {
    const p1 = createProject(db, { name: 'Old Access' });
    const p2 = createProject(db, { name: 'New Access' });

    // Touch p1 first, then p2 — p2 should appear first (more recent)
    touchProject(db, p1.id);
    // Small delay to ensure different timestamps
    const laterDate = new Date(Date.now() + 1000);
    updateProject(db, p2.id, { lastAccessedAt: laterDate });

    const list = listProjects(db);
    expect(list[0]!.id).toBe(p2.id);
    expect(list[1]!.id).toBe(p1.id);
  });

  it('touchProject updates lastAccessedAt', () => {
    const p = createProject(db, { name: 'Touch Me' });
    expect(p.lastAccessedAt).toBeNull();

    const touched = touchProject(db, p.id);
    expect(touched?.lastAccessedAt).toBeInstanceOf(Date);
  });

  it('unaccessed projects (null lastAccessedAt) come last in DESC ordering', () => {
    const pAccessed = createProject(db, { name: 'Accessed' });
    const pNever = createProject(db, { name: 'Never Accessed' });
    touchProject(db, pAccessed.id);

    const list = listProjects(db);
    // pAccessed has a timestamp (non-null), pNever has null — DESC puts null last
    expect(list[0]!.id).toBe(pAccessed.id);
    expect(list[1]!.id).toBe(pNever.id);
  });
});

describe('getNextClaimableTask with agent filtering', () => {
  let db: OpenlareDb;
  let projectId: string;
  let inProgressId: string;

  beforeEach(() => {
    db = createTestDb();
    projectId = createProject(db, { name: 'Board' }).id;
    inProgressId = createQueue(db, {
      projectId,
      name: 'In Progress',
      ownerType: 'assistant',
      position: 0,
      agentLimit: 5,
    }).id;
  });

  it('returns task when no agent restrictions', () => {
    createTask(db, { projectId, queueId: inProgressId, title: 'Free task' });
    const next = getNextClaimableTask(db, projectId, 'any-agent');
    expect(next?.title).toBe('Free task');
  });

  it('returns task when agent is in project agent list', () => {
    assignAgent(db, projectId, 'allowed-agent');
    createTask(db, { projectId, queueId: inProgressId, title: 'Restricted task' });

    const next = getNextClaimableTask(db, projectId, 'allowed-agent');
    expect(next?.title).toBe('Restricted task');
  });

  it('returns undefined when agent is NOT in project agent list', () => {
    assignAgent(db, projectId, 'allowed-agent');
    createTask(db, { projectId, queueId: inProgressId, title: 'Restricted task' });

    const next = getNextClaimableTask(db, projectId, 'rogue-agent');
    expect(next).toBeUndefined();
  });

  it('returns task when agentId param is not provided (backward compat)', () => {
    assignAgent(db, projectId, 'allowed-agent');
    createTask(db, { projectId, queueId: inProgressId, title: 'Compat task' });

    // No agentId passed — should skip restriction check
    const next = getNextClaimableTask(db, projectId);
    expect(next?.title).toBe('Compat task');
  });
});

describe('createProjectWithDefaults', () => {
  let db: OpenlareDb;

  beforeEach(() => {
    db = createTestDb();
  });

  it('creates a project with 3 default queues', () => {
    const result = createProjectWithDefaults(db, { name: 'My Project' });
    expect(result.project.name).toBe('My Project');
    expect(result.project.id).toBeTruthy();
    expect(result.queues).toHaveLength(3);
  });

  it('creates queues with correct names', () => {
    const { queues } = createProjectWithDefaults(db, { name: 'Test' });
    expect(queues.map((q) => q.name)).toEqual(['Todo', 'In Progress', 'Done']);
  });

  it('creates queues with correct ownerTypes', () => {
    const { queues } = createProjectWithDefaults(db, { name: 'Test' });
    expect(queues.map((q) => q.ownerType)).toEqual(['human', 'assistant', 'human']);
  });

  it('creates queues with correct descriptions', () => {
    const { queues } = createProjectWithDefaults(db, { name: 'Test' });
    expect(queues[0]!.description).toBe('Tasks waiting to be picked up');
    expect(queues[1]!.description).toBe('Tasks being worked on by the agent');
    expect(queues[2]!.description).toBe('Completed tasks');
  });

  it('creates queues with correct positions', () => {
    const { queues } = createProjectWithDefaults(db, { name: 'Test' });
    expect(queues.map((q) => q.position)).toEqual([0, 1, 2]);
  });

  it('creates 2 transitions: todo→inProgress (human) and inProgress→done (assistant)', () => {
    const { project, queues } = createProjectWithDefaults(db, { name: 'Test' });
    const [todo, inProgress, done] = queues as [
      (typeof queues)[0],
      (typeof queues)[0],
      (typeof queues)[0],
    ];
    const ts = listTransitions(db, project.id);
    expect(ts).toHaveLength(2);

    const todoToInProgress = ts.find(
      (t) => t.fromQueueId === todo.id && t.toQueueId === inProgress.id,
    );
    expect(todoToInProgress).toBeDefined();
    expect(todoToInProgress!.actorType).toBe('human');

    const inProgressToDone = ts.find(
      (t) => t.fromQueueId === inProgress.id && t.toQueueId === done.id,
    );
    expect(inProgressToDone).toBeDefined();
    expect(inProgressToDone!.actorType).toBe('assistant');
  });

  it('queues belong to the created project', () => {
    const { project, queues } = createProjectWithDefaults(db, { name: 'Test' });
    expect(queues.every((q) => q.projectId === project.id)).toBe(true);
  });
});
