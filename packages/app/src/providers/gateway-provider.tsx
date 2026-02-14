'use client';

import { useEffect, useRef } from 'react';
import { gatewayStore } from '@openlares/api-client';
import { loadGatewayConfig } from '@/lib/storage';

/**
 * GatewayProvider — auto-connects to the gateway on mount
 * if a saved config exists in localStorage.
 */
export function GatewayProvider({ children }: { children: React.ReactNode }) {
  const didAttempt = useRef(false);

  useEffect(() => {
    if (didAttempt.current) return;
    didAttempt.current = true;

    const { connectionStatus, connect } = gatewayStore.getState();
    if (connectionStatus !== 'disconnected') return;

    const config = loadGatewayConfig();
    if (config) {
      void connect(config);
    }
  }, []);

  return <>{children}</>;
}
