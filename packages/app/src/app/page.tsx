'use client';

import Link from 'next/link';
import { PixiCanvas } from '@openlares/game-engine';
import { useGatewayStore } from '@openlares/api-client';

export default function Home() {
  const connectionStatus = useGatewayStore((s) => s.connectionStatus);
  const rawSessions = useGatewayStore((s) => s.sessions);
  const sessionActivities = useGatewayStore((s) => s.sessionActivities);
  const activeSessionKey = useGatewayStore((s) => s.activeSessionKey);
  const selectSession = useGatewayStore((s) => s.selectSession);

  // Merge per-session activity into session summaries for the canvas
  const sessions = rawSessions.map((s) => {
    const activity = sessionActivities[s.sessionKey];
    return activity ? { ...s, lastActivity: activity } : s;
  });

  const handleSessionClick = (sessionKey: string) => {
    selectSession(sessionKey);
  };

  return (
    <div className="flex h-full flex-col">
      {connectionStatus === 'disconnected' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-gray-500">
          <p className="text-lg">Not connected to a gateway</p>
          <Link
            href="/settings"
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-amber-600"
          >
            Go to Settings
          </Link>
        </div>
      )}

      {connectionStatus !== 'disconnected' && (
        <PixiCanvas
          sessions={sessions}
          activeSessionKey={activeSessionKey}
          onSessionClick={handleSessionClick}
        />
      )}
    </div>
  );
}
