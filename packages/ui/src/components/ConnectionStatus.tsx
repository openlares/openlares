'use client';

import type { ConnectionStatus as ConnectionStatusType } from '@openlares/core';

/** Visual config for each connection state */
const STATUS_CONFIG: Record<ConnectionStatusType, { color: string; label: string }> = {
  disconnected: { color: 'bg-red-500', label: 'Disconnected' },
  connecting: { color: 'bg-yellow-500', label: 'Connecting…' },
  connected: { color: 'bg-green-500', label: 'Connected' },
  error: { color: 'bg-red-500', label: 'Error' },
};

interface ConnectionStatusProps {
  /** Current connection status */
  status: ConnectionStatusType;
}

/**
 * ConnectionStatus — small indicator showing gateway connection state.
 *
 * Displays a colored dot and label:
 * - 🔴 Disconnected / Error
 * - 🟡 Connecting
 * - 🟢 Connected
 */
export function ConnectionStatus({ status }: ConnectionStatusProps) {
  const config = STATUS_CONFIG[status];

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`h-2 w-2 rounded-full ${config.color}`} />
      <span className="text-gray-500">{config.label}</span>
    </div>
  );
}
