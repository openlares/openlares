'use client';

import { useState, useCallback, useRef } from 'react';
import type { Dashboard, Queue, Transition } from './types';
import { useToastStore } from '@/lib/toast-store';

interface ProjectConfigProps {
  dashboard: Dashboard;
  queues: Queue[];
  transitions: Transition[];
  onClose: () => void;
  onQueuesChange: (queues: Queue[], transitions: Transition[]) => void;
}

const ownerOptions: { value: Queue['ownerType']; label: string; icon: string }[] = [
  { value: 'human', label: 'Human', icon: '👤' },
  { value: 'assistant', label: 'Assistant', icon: '🤖' },
];

export function ProjectConfig({
  dashboard,
  queues: initialQueues,
  transitions: initialTransitions,
  onClose,
  onQueuesChange,
}: ProjectConfigProps) {
  const [queues, setQueues] = useState(initialQueues);
  const [transitions, setTransitions] = useState(initialTransitions);
  const [newQueueName, setNewQueueName] = useState('');
  const [newQueueOwner, setNewQueueOwner] = useState<Queue['ownerType']>('human');
  const [deletingQueueId, setDeletingQueueId] = useState<string | null>(null);
  const [deletingTransitionId, setDeletingTransitionId] = useState<string | null>(null);
  const [newQueueDescription, setNewQueueDescription] = useState('');
  const [editingDescriptionId, setEditingDescriptionId] = useState<string | null>(null);
  const [editingDescriptionValue, setEditingDescriptionValue] = useState('');
  const descriptionInputRef = useRef<HTMLInputElement>(null);
  const [strictTransitions, setStrictTransitions] = useState(
    dashboard.config?.strictTransitions ?? false,
  );

  const addToast = useToastStore((s) => s.addToast);

  /** Refetch queues + transitions from API. */
  const refetch = useCallback(async () => {
    const qRes = await fetch(`/api/dashboards/${dashboard.id}/queues`);
    if (qRes.ok) {
      const qData = (await qRes.json()) as { queues: Queue[]; transitions: Transition[] };
      setQueues(qData.queues);
      setTransitions(qData.transitions);
    }
  }, [dashboard.id]);

  // Add a new queue
  const handleAddQueue = useCallback(async () => {
    if (!newQueueName.trim()) return;

    try {
      const res = await fetch(`/api/dashboards/${dashboard.id}/queues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newQueueName.trim(),
          ownerType: newQueueOwner,
          position: queues.length,
        }),
      });

      if (res.ok) {
        await refetch();
        setNewQueueName('');
        setNewQueueDescription('');
      } else {
        const errData = (await res.json()) as { error?: string };
        addToast('error', errData.error ?? 'Failed to add queue');
      }
    } catch {
      addToast('error', 'Network error — check your connection');
    }
  }, [
    dashboard.id,
    newQueueName,
    newQueueOwner,
    newQueueDescription,
    queues.length,
    refetch,
    addToast,
  ]);

  // Delete a queue (with confirmation)
  const handleDeleteQueue = useCallback(
    async (queueId: string) => {
      try {
        const res = await fetch(`/api/queues/${queueId}`, { method: 'DELETE' });
        if (res.ok) {
          addToast('success', 'Queue deleted');
          await refetch();
        } else {
          const errData = (await res.json()) as { error?: string };
          addToast('error', errData.error ?? 'Failed to delete queue');
        }
      } catch {
        addToast('error', 'Network error — check your connection');
      } finally {
        setDeletingQueueId(null);
      }
    },
    [refetch, addToast],
  );

  // Move a queue up or down
  const handleMoveQueue = useCallback(
    async (index: number, direction: 'up' | 'down') => {
      const sorted = [...queues].sort((a, b) => a.position - b.position);
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= sorted.length) return;

      // Swap positions
      const a = sorted[index]!;
      const b = sorted[targetIndex]!;
      const aPos = a.position;
      const bPos = b.position;

      // Optimistic update
      const updated = sorted.map((q) => {
        if (q.id === a.id) return { ...q, position: bPos };
        if (q.id === b.id) return { ...q, position: aPos };
        return q;
      });
      setQueues(updated.sort((x, y) => x.position - y.position));

      // Persist
      try {
        const res = await fetch(`/api/dashboards/${dashboard.id}/queues`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            positions: [
              { id: a.id, position: bPos },
              { id: b.id, position: aPos },
            ],
          }),
        });
        if (!res.ok) {
          const errData = (await res.json()) as { error?: string };
          addToast('error', errData.error ?? 'Failed to reorder queues');
          await refetch(); // Roll back optimistic update
        }
      } catch {
        addToast('error', 'Network error — check your connection');
        await refetch();
      }
    },
    [queues, dashboard.id, refetch, addToast],
  );

  // Start inline description edit
  const handleStartEditDescription = useCallback((queue: Queue) => {
    setEditingDescriptionId(queue.id);
    setEditingDescriptionValue(queue.description ?? '');
    setTimeout(() => descriptionInputRef.current?.focus(), 0);
  }, []);

  // Save inline description edit
  const handleSaveDescription = useCallback(
    async (queueId: string) => {
      const newDesc = editingDescriptionValue.trim() || null;
      setQueues((prev) => prev.map((q) => (q.id === queueId ? { ...q, description: newDesc } : q)));
      setEditingDescriptionId(null);

      try {
        const res = await fetch(`/api/queues/${queueId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: newDesc }),
        });
        if (!res.ok) {
          const errData = (await res.json()) as { error?: string };
          addToast('error', errData.error ?? 'Failed to update description');
          await refetch();
        }
      } catch {
        addToast('error', 'Network error — check your connection');
        await refetch();
      }
    },
    [editingDescriptionValue, refetch, addToast],
  );

  // Add transition
  const handleAddTransition = useCallback(
    async (fromId: string, toId: string, actorType: Transition['actorType']) => {
      try {
        const res = await fetch(`/api/dashboards/${dashboard.id}/transitions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromQueueId: fromId, toQueueId: toId, actorType }),
        });
        if (res.ok) {
          await refetch();
        } else {
          const errData = (await res.json()) as { error?: string };
          addToast('error', errData.error ?? 'Failed to add transition');
        }
      } catch {
        addToast('error', 'Network error — check your connection');
      }
    },
    [dashboard.id, refetch, addToast],
  );

  // Delete a transition (with confirmation)
  const handleDeleteTransition = useCallback(
    async (transitionId: string) => {
      try {
        const res = await fetch(`/api/transitions/${transitionId}`, { method: 'DELETE' });
        if (res.ok) {
          addToast('success', 'Transition deleted');
          await refetch();
        } else {
          const errData = (await res.json()) as { error?: string };
          addToast('error', errData.error ?? 'Failed to delete transition');
        }
      } catch {
        addToast('error', 'Network error — check your connection');
      } finally {
        setDeletingTransitionId(null);
      }
    },
    [refetch, addToast],
  );

  const handleToggleStrict = useCallback(
    async (enabled: boolean) => {
      setStrictTransitions(enabled);
      try {
        const res = await fetch(`/api/dashboards/${dashboard.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config: { ...dashboard.config, strictTransitions: enabled },
          }),
        });
        if (!res.ok) {
          const errData = (await res.json()) as { error?: string };
          addToast('error', errData.error ?? 'Failed to update strict transitions setting');
          setStrictTransitions(!enabled); // revert
        }
      } catch {
        addToast('error', 'Network error — check your connection');
        setStrictTransitions(!enabled); // revert
      }
    },
    [dashboard.id, dashboard.config, addToast],
  );

  const handleSave = useCallback(() => {
    onQueuesChange(queues, transitions);
    onClose();
  }, [queues, transitions, onQueuesChange, onClose]);

  const sortedQueues = [...queues].sort((a, b) => a.position - b.position);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[5vh]">
      <div className="w-full max-w-2xl rounded-xl bg-slate-800 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-3">
          <h3 className="text-lg font-semibold text-slate-100">Dashboard Configuration</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-5">
          {/* Queues */}
          <h4 className="mb-3 text-sm font-semibold text-slate-200">Queues (columns)</h4>
          <div className="mb-4 space-y-2">
            {sortedQueues.map((queue, idx) => (
              <div key={queue.id} className="rounded-lg bg-slate-700/30 px-3 py-2">
                {/* Main row */}
                <div className="flex items-center gap-3">
                  {/* Reorder arrows */}
                  <div className="flex flex-col">
                    <button
                      onClick={() => void handleMoveQueue(idx, 'up')}
                      disabled={idx === 0}
                      className="text-slate-500 hover:text-slate-300 disabled:opacity-20"
                      title="Move up"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => void handleMoveQueue(idx, 'down')}
                      disabled={idx === sortedQueues.length - 1}
                      className="text-slate-500 hover:text-slate-300 disabled:opacity-20"
                      title="Move down"
                    >
                      ▼
                    </button>
                  </div>

                  <span className="w-6 text-center text-xs text-slate-500">{idx + 1}</span>
                  <span className="flex-1 text-sm text-slate-200">{queue.name}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      queue.ownerType === 'human'
                        ? 'bg-blue-500/20 text-blue-300'
                        : 'bg-purple-500/20 text-purple-300'
                    }`}
                  >
                    {queue.ownerType === 'human' ? '👤 Human' : '🤖 Assistant'}
                  </span>
                  <span className="text-xs text-slate-500">
                    limit: {queue.agentLimit === 0 ? '∞' : queue.agentLimit}
                  </span>

                  {/* Delete button with confirmation */}
                  {deletingQueueId === queue.id ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-red-400">Delete?</span>
                      <button
                        onClick={() => void handleDeleteQueue(queue.id)}
                        className="rounded bg-red-500/20 px-1.5 py-0.5 text-xs text-red-400 hover:bg-red-500/40"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setDeletingQueueId(null)}
                        className="rounded bg-slate-600 px-1.5 py-0.5 text-xs text-slate-300 hover:bg-slate-500"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeletingQueueId(queue.id)}
                      title="Delete queue"
                      className="text-slate-500 hover:text-red-400"
                    >
                      🗑️
                    </button>
                  )}
                </div>

                {/* Description row */}
                <div className="ml-[3.25rem] mt-1">
                  {editingDescriptionId === queue.id ? (
                    <input
                      ref={descriptionInputRef}
                      value={editingDescriptionValue}
                      onChange={(e) => setEditingDescriptionValue(e.target.value)}
                      onBlur={() => void handleSaveDescription(queue.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSaveDescription(queue.id);
                        if (e.key === 'Escape') {
                          setEditingDescriptionId(null);
                          setEditingDescriptionValue('');
                        }
                      }}
                      placeholder="Add a description…"
                      className="w-full rounded bg-slate-700/50 px-2 py-1 text-xs text-slate-300 placeholder-slate-600 outline-none ring-1 ring-cyan-400/50 focus:ring-cyan-400"
                    />
                  ) : (
                    <button
                      onClick={() => handleStartEditDescription(queue)}
                      className="group flex items-center gap-1 text-left"
                      title="Edit description"
                    >
                      {queue.description ? (
                        <span className="text-xs text-slate-400 group-hover:text-slate-300">
                          {queue.description}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-600 group-hover:text-slate-500">
                          Add description…
                        </span>
                      )}
                      <span className="text-[10px] text-slate-600 opacity-0 group-hover:opacity-100">
                        ✎
                      </span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Add queue */}
          <div className="mb-6 space-y-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-slate-400">New queue name</label>
                <input
                  value={newQueueName}
                  onChange={(e) => setNewQueueName(e.target.value)}
                  placeholder="e.g. Review, Testing, QA..."
                  className="w-full rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none ring-1 ring-slate-600 focus:ring-cyan-400"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleAddQueue();
                  }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Owner</label>
                <select
                  value={newQueueOwner}
                  onChange={(e) => setNewQueueOwner(e.target.value as Queue['ownerType'])}
                  className="rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-slate-100 outline-none ring-1 ring-slate-600"
                >
                  {ownerOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.icon} {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => void handleAddQueue()}
                disabled={!newQueueName.trim()}
                className="rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
              >
                Add
              </button>
            </div>
            <input
              value={newQueueDescription}
              onChange={(e) => setNewQueueDescription(e.target.value)}
              placeholder="Description (optional)…"
              className="w-full rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-slate-400 placeholder-slate-600 outline-none ring-1 ring-slate-600 focus:ring-cyan-400"
            />
          </div>

          {/* Strict Transitions toggle */}
          <div className="mb-4 flex items-center justify-between rounded-lg bg-slate-700/30 px-4 py-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-200">Strict Transitions</h4>
              <p className="text-xs text-slate-400">
                {strictTransitions
                  ? 'Only defined transitions are allowed'
                  : 'Free movement — tasks can move between any queues'}
              </p>
            </div>
            <button
              onClick={() => void handleToggleStrict(!strictTransitions)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                strictTransitions ? 'bg-cyan-600' : 'bg-slate-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  strictTransitions ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Transitions (only shown when strict mode is on) */}
          {strictTransitions && (
            <>
              <h4 className="mb-3 text-sm font-semibold text-slate-200">
                Transitions (allowed moves)
              </h4>
              <div className="mb-4 space-y-2">
                {transitions.map((t) => {
                  const from = queues.find((q) => q.id === t.fromQueueId);
                  const to = queues.find((q) => q.id === t.toQueueId);
                  return (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 rounded-lg bg-slate-700/30 px-3 py-2 text-sm"
                    >
                      <span className="text-slate-200">{from?.name ?? '?'}</span>
                      <span className="text-slate-500">→</span>
                      <span className="text-slate-200">{to?.name ?? '?'}</span>
                      <span
                        className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          t.actorType === 'human'
                            ? 'bg-blue-500/20 text-blue-300'
                            : t.actorType === 'assistant'
                              ? 'bg-purple-500/20 text-purple-300'
                              : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {t.actorType === 'human'
                          ? '👤'
                          : t.actorType === 'assistant'
                            ? '🤖'
                            : '👤🤖'}{' '}
                        {t.actorType}
                      </span>

                      {/* Delete transition with confirmation */}
                      {deletingTransitionId === t.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-red-400">Delete?</span>
                          <button
                            onClick={() => void handleDeleteTransition(t.id)}
                            className="rounded bg-red-500/20 px-1.5 py-0.5 text-xs text-red-400 hover:bg-red-500/40"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setDeletingTransitionId(null)}
                            className="rounded bg-slate-600 px-1.5 py-0.5 text-xs text-slate-300 hover:bg-slate-500"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeletingTransitionId(t.id)}
                          title="Delete transition"
                          className="text-slate-500 hover:text-red-400"
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  );
                })}
                {transitions.length === 0 && (
                  <p className="text-xs text-slate-500">No transitions defined yet.</p>
                )}
              </div>

              {/* Quick add transition */}
              {queues.length >= 2 && (
                <TransitionAdder queues={sortedQueues} onAdd={handleAddTransition} />
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-slate-700/50 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick add transition inline form
// ---------------------------------------------------------------------------

function TransitionAdder({
  queues,
  onAdd,
}: {
  queues: Queue[];
  onAdd: (from: string, to: string, actor: Transition['actorType']) => Promise<void>;
}) {
  const [from, setFrom] = useState(queues[0]?.id ?? '');
  const [to, setTo] = useState(queues[1]?.id ?? '');
  const [actor, setActor] = useState<Transition['actorType']>('human');

  return (
    <div className="flex items-end gap-2">
      <div>
        <label className="mb-1 block text-xs text-slate-400">From</label>
        <select
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-lg bg-slate-700/50 px-2 py-2 text-sm text-slate-100 outline-none ring-1 ring-slate-600"
        >
          {queues.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}
            </option>
          ))}
        </select>
      </div>
      <span className="pb-2 text-slate-500">→</span>
      <div>
        <label className="mb-1 block text-xs text-slate-400">To</label>
        <select
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-lg bg-slate-700/50 px-2 py-2 text-sm text-slate-100 outline-none ring-1 ring-slate-600"
        >
          {queues.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-400">Actor</label>
        <select
          value={actor}
          onChange={(e) => setActor(e.target.value as Transition['actorType'])}
          className="rounded-lg bg-slate-700/50 px-2 py-2 text-sm text-slate-100 outline-none ring-1 ring-slate-600"
        >
          <option value="human">👤 Human</option>
          <option value="assistant">🤖 Assistant</option>
          <option value="both">👤🤖 Both</option>
        </select>
      </div>
      <button
        onClick={() => void onAdd(from, to, actor)}
        disabled={from === to}
        className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-600 disabled:opacity-50"
      >
        + Add
      </button>
    </div>
  );
}
