'use client';

import type { ActivityItem } from '@openlares/core';
import { PixiCanvas } from '@openlares/game-engine';
import { ConnectionStatus, ActivityFeed } from '@openlares/ui';

/** Mock activity items so the feed isn't empty */
const MOCK_ACTIVITY: ActivityItem[] = [
  {
    id: '1',
    type: 'status',
    title: 'Agent initialized',
    detail: 'OpenLares v0.0.0 ready',
    timestamp: Date.now() - 120_000,
  },
  {
    id: '2',
    type: 'message',
    title: 'Hello from the agent!',
    detail: 'First message in the activity feed',
    timestamp: Date.now() - 60_000,
  },
  {
    id: '3',
    type: 'tool_call',
    title: 'web_search',
    detail: 'Searching for "PixiJS tutorials"',
    timestamp: Date.now() - 30_000,
  },
  {
    id: '4',
    type: 'tool_result',
    title: 'Search complete',
    detail: 'Found 5 results',
    timestamp: Date.now() - 25_000,
  },
  {
    id: '5',
    type: 'error',
    title: 'Connection lost',
    detail: 'Gateway unreachable — retrying in 5s',
    timestamp: Date.now() - 10_000,
  },
];

export default function Home() {
  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-gray-800 bg-gray-900 p-4">
        <h1 className="mb-6 text-xl font-bold tracking-tight">
          <span className="text-amber-400">Open</span>Lares
        </h1>
        <nav className="flex flex-col gap-2 text-sm text-gray-400">
          <span className="rounded bg-gray-800 px-2 py-1 text-gray-100">Dashboard</span>
          <span className="rounded px-2 py-1 hover:bg-gray-800">Personality</span>
          <span className="rounded px-2 py-1 hover:bg-gray-800">Activity</span>
          <span className="rounded px-2 py-1 hover:bg-gray-800">Settings</span>
        </nav>
        <div className="mt-auto">
          <ConnectionStatus status="disconnected" />
        </div>
      </aside>

      {/* Main canvas area */}
      <main className="flex-1">
        <PixiCanvas />
      </main>

      {/* Activity panel */}
      <aside className="flex w-80 flex-col border-l border-gray-800 bg-gray-900 p-4">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">
          Activity
        </h2>
        <ActivityFeed items={MOCK_ACTIVITY} />
      </aside>
    </div>
  );
}
