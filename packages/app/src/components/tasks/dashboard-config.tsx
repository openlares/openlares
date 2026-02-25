'use client';

import { useState, useCallback } from 'react';
import type { Dashboard, Queue, Transition } from './types';

interface DashboardConfigProps {
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

export function DashboardConfig({
  dashboard,
  queues: initialQueues,
  transitions: initialTransitions,
  onClose,
  onQueuesChange,
}: DashboardConfigProps) {
  const [queues, setQueues] = useState(initialQueues);
  const [transitions, setTransitions] = useState(initialTransitions);
  const [newQueueName, setNewQueueName] = useState('');
  const [newQueueOwner, setNewQueueOwner] = useState<Queue['ownerType']>('human');
  const [error, setError] = useState<string | null>(null);

  // Add a new queue
  const handleAddQueue = useCallback(async () => {
    if (!newQueueName.trim()) return;
    setError(null);

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
        // Refetch all queues + transitions to get correct state
        const qRes = await fetch(`/api/dashboards/${dashboard.id}/queues`);
        if (qRes.ok) {
          const qData = (await qRes.json()) as { queues: Queue[]; transitions: Transition[] };
          setQueues(qData.queues);
          setTransitions(qData.transitions);
        }
        setNewQueueName('');
      } else {
        const errData = (await res.json()) as { error?: string };
        setError(errData.error ?? 'Failed to add queue');
      }
    } catch {
      setError('Network error');
    }
  }, [dashboard.id, newQueueName, newQueueOwner, queues.length]);

  // Add transition
  const handleAddTransition = useCallback(
    async (fromId: string, toId: string, actorType: Transition['actorType']) => {
      setError(null);
      try {
        const res = await fetch(`/api/dashboards/${dashboard.id}/transitions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromQueueId: fromId, toQueueId: toId, actorType }),
        });
        if (res.ok) {
          // Refetch transitions
          const qRes = await fetch(`/api/dashboards/${dashboard.id}/queues`);
          if (qRes.ok) {
            const qData = (await qRes.json()) as { queues: Queue[]; transitions: Transition[] };
            setTransitions(qData.transitions);
          }
        }
      } catch {
        setError('Failed to add transition');
      }
    },
    [dashboard.id],
  );

  const handleSave = useCallback(() => {
    onQueuesChange(queues, transitions);
    onClose();
  }, [queues, transitions, onQueuesChange, onClose]);

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
          {error && (
            <div className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Queues */}
          <h4 className="mb-3 text-sm font-semibold text-slate-200">Queues (columns)</h4>
          <div className="mb-4 space-y-2">
            {queues.map((queue, idx) => (
              <div
                key={queue.id}
                className="flex items-center gap-3 rounded-lg bg-slate-700/30 px-3 py-2"
              >
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
              </div>
            ))}
          </div>

          {/* Add queue */}
          <div className="mb-6 flex items-end gap-2">
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

          {/* Transitions */}
          <h4 className="mb-3 text-sm font-semibold text-slate-200">Transitions (allowed moves)</h4>
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
                    {t.actorType === 'human' ? '👤' : t.actorType === 'assistant' ? '🤖' : '👤🤖'}{' '}
                    {t.actorType}
                  </span>
                </div>
              );
            })}
            {transitions.length === 0 && (
              <p className="text-xs text-slate-500">No transitions defined yet.</p>
            )}
          </div>

          {/* Quick add transition */}
          {queues.length >= 2 && <TransitionAdder queues={queues} onAdd={handleAddTransition} />}
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
