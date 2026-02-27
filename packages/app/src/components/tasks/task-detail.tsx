'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Task, Queue, TaskHistory, TaskComment } from './types';

interface TaskDetailProps {
  task: Task;
  queue: Queue | undefined;
  queues?: Queue[];
  onClose: () => void;
  onUpdate: (task: Task) => void;
  onDelete: (taskId: string) => void;
  onRetry?: (task: Task) => void;
}

const statusLabels: Record<Task['status'], { text: string; color: string }> = {
  pending: { text: 'Pending', color: 'bg-slate-500/20 text-slate-300' },
  executing: { text: 'Executing', color: 'bg-cyan-500/20 text-cyan-300' },
  completed: { text: 'Completed', color: 'bg-emerald-500/20 text-emerald-300' },
  failed: { text: 'Failed', color: 'bg-red-500/20 text-red-300' },
};

export function TaskDetail({
  task,
  queue,
  queues = [],
  onClose,
  onUpdate,
  onRetry,
  onDelete,
}: TaskDetailProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState(task.priority);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [history, setHistory] = useState<TaskHistory[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const commentsEndRef = useRef<HTMLDivElement>(null);

  const isDirty =
    title !== task.title || description !== (task.description ?? '') || priority !== task.priority;

  // Fetch history on mount
  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    fetch(`/api/tasks/${task.id}`)
      .then((res) => {
        if (res.ok) return res.json() as Promise<Task & { history: TaskHistory[] }>;
        return null;
      })
      .then((data) => {
        if (!cancelled && data?.history) {
          setHistory(data.history);
        }
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  // Fetch comments on mount
  useEffect(() => {
    let cancelled = false;
    setCommentsLoading(true);
    fetch(`/api/tasks/${task.id}/comments`)
      .then((res) => {
        if (res.ok) return res.json() as Promise<TaskComment[]>;
        return null;
      })
      .then((data) => {
        if (!cancelled && data) {
          setComments(data);
        }
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  // Scroll to bottom when comments load
  useEffect(() => {
    if (comments.length > 0) {
      commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [comments]);

  const handleSave = useCallback(async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          title: title.trim(),
          description: description.trim() || '',
          priority,
        }),
      });
      if (res.ok) {
        const updated = (await res.json()) as Task;
        onUpdate(updated);
      }
    } finally {
      setSaving(false);
    }
  }, [task.id, title, description, priority, isDirty, saving, onUpdate]);

  const handleDelete = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if (res.ok) {
        onDelete(task.id);
      }
    } catch {
      // TODO: error toast
    }
  }, [task.id, onDelete]);

  const handleAddComment = useCallback(async () => {
    const content = newComment.trim();
    if (!content || postingComment) return;
    setPostingComment(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        const comment = (await res.json()) as TaskComment;
        setComments((prev) => [...prev, comment]);
        setNewComment('');
      }
    } catch {
      // TODO: error toast
    } finally {
      setPostingComment(false);
    }
  }, [task.id, newComment, postingComment]);

  const resolveQueueName = useCallback(
    (queueId: string | null): string => {
      if (!queueId) return 'None';
      return queues.find((q) => q.id === queueId)?.name ?? queueId;
    },
    [queues],
  );

  const status = statusLabels[task.status];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[10vh]">
      <div
        className="flex w-full max-w-lg flex-col rounded-xl bg-slate-800 shadow-2xl"
        style={{ maxHeight: '80vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${status.color}`}>
              {status.text}
            </span>
            {queue && <span className="text-xs text-slate-500">in {queue.name}</span>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          <label className="mb-1 block text-xs text-slate-400">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mb-4 w-full rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-slate-100 outline-none ring-1 ring-slate-600 focus:ring-cyan-400"
          />

          <label className="mb-1 block text-xs text-slate-400">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Task details for the agent..."
            className="mb-4 w-full resize-none rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none ring-1 ring-slate-600 focus:ring-cyan-400"
          />

          <label className="mb-1 block text-xs text-slate-400">Priority</label>
          <input
            type="number"
            min={0}
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="mb-4 w-24 rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-slate-100 outline-none ring-1 ring-slate-600 focus:ring-cyan-400"
          />

          {/* Comments thread */}
          <div className="mb-4">
            <label className="mb-2 block text-xs font-medium text-slate-400">
              💬 Comments {!commentsLoading && `(${comments.length})`}
            </label>

            {commentsLoading ? (
              <p className="text-xs text-slate-500">Loading...</p>
            ) : comments.length === 0 ? (
              <p className="text-xs text-slate-500">No comments yet</p>
            ) : (
              <div className="space-y-2">
                {comments.map((c) => (
                  <div
                    key={c.id}
                    className={`rounded-lg p-3 text-sm ${
                      c.authorType === 'agent'
                        ? 'bg-cyan-500/10 ring-1 ring-cyan-500/20'
                        : 'bg-slate-700/50 ring-1 ring-slate-600/50'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={`text-xs font-medium ${
                          c.authorType === 'agent' ? 'text-cyan-400' : 'text-slate-300'
                        }`}
                      >
                        {c.authorType === 'agent' ? `🤖 ${c.author}` : `👤 ${c.author}`}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {new Date(c.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-slate-200">{c.content}</p>
                  </div>
                ))}
                <div ref={commentsEndRef} />
              </div>
            )}

            {/* Add comment */}
            <div className="mt-3">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                rows={2}
                placeholder="Add a comment..."
                className="w-full resize-none rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none ring-1 ring-slate-600 focus:ring-cyan-400"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    void handleAddComment();
                  }
                }}
              />
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[10px] text-slate-600">Ctrl+Enter to submit</span>
                <button
                  onClick={() => void handleAddComment()}
                  disabled={!newComment.trim() || postingComment}
                  className="rounded bg-cyan-600 px-3 py-1 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  {postingComment ? 'Posting...' : 'Add Comment'}
                </button>
              </div>
            </div>
          </div>

          {/* Metadata */}
          <div className="mb-4 space-y-1 text-xs text-slate-500">
            {task.assignedAgent && <p>Agent: {task.assignedAgent}</p>}
            {task.sessionKey && <p>Session: {task.sessionKey}</p>}
            <p>Created: {new Date(task.createdAt).toLocaleString()}</p>
            {task.completedAt && <p>Completed: {new Date(task.completedAt).toLocaleString()}</p>}
          </div>

          {/* History section */}
          <div className="border-t border-slate-700/50 pt-3">
            <button
              onClick={() => setHistoryOpen((o) => !o)}
              className="flex w-full items-center justify-between text-xs font-medium text-slate-400 hover:text-slate-200"
            >
              <span>History {!historyLoading && `(${history.length})`}</span>
              <span className="text-slate-500">{historyOpen ? '▲' : '▼'}</span>
            </button>

            {historyOpen && (
              <div className="mt-3">
                {historyLoading ? (
                  <p className="text-xs text-slate-500">Loading...</p>
                ) : history.length === 0 ? (
                  <p className="text-xs text-slate-500">No history yet</p>
                ) : (
                  <ol className="relative ml-2 border-l border-slate-700">
                    {history.map((entry) => (
                      <li key={entry.id} className="mb-4 ml-4 last:mb-0">
                        {/* Timeline dot */}
                        <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border border-slate-600 bg-cyan-500/60" />
                        <p className="text-sm text-slate-200">
                          Moved from{' '}
                          <span className="font-medium text-slate-100">
                            {resolveQueueName(entry.fromQueueId)}
                          </span>{' '}
                          →{' '}
                          <span className="font-medium text-slate-100">
                            {resolveQueueName(entry.toQueueId)}
                          </span>{' '}
                          <span className="text-slate-400">by {entry.actor}</span>
                        </p>
                        {entry.note && (
                          <p className="mt-0.5 text-xs text-slate-500">{entry.note}</p>
                        )}
                        <p className="mt-0.5 text-xs text-slate-500">
                          {new Date(entry.createdAt).toLocaleString()}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-700/50 px-5 py-3">
          <div>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-400">Delete this task?</span>
                <button
                  onClick={handleDelete}
                  className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500"
                >
                  Yes, delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Delete
              </button>
            )}
          </div>

          {onRetry && (task.status === 'failed' || task.status === 'completed') && (
            <button
              onClick={() => onRetry(task)}
              className="rounded-lg bg-amber-600/20 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-600/30"
            >
              🔄 Retry
            </button>
          )}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!isDirty || saving || !title.trim()}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
