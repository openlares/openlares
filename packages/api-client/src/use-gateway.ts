'use client';

/**
 * React hook for managing a GatewayClient instance.
 *
 * Creates the client on mount, connects automatically,
 * and disconnects on unmount.
 *
 * Usage:
 *   const { status, client, error } = useGateway({ url, auth });
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ConnectionStatus, GatewayConfig } from '@openlares/core';
import { GatewayClient } from './gateway-client';

/** Return value of the useGateway hook. */
export interface UseGatewayResult {
  /** Current connection status. */
  status: ConnectionStatus;
  /** The GatewayClient instance (null until first render). */
  client: GatewayClient | null;
  /** Human-readable error message, or null. */
  error: string | null;
}

/**
 * Hook that creates and manages a GatewayClient.
 *
 * @param config - Gateway URL and auth token.
 * @returns Connection status, client instance, and any error.
 */
export function useGateway(config: GatewayConfig): UseGatewayResult {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<GatewayClient | null>(null);

  // Stable connect function that won't change between renders
  const doConnect = useCallback(() => {
    const client = new GatewayClient({ url: config.url, token: config.auth });
    clientRef.current = client;

    // Listen for status changes
    client.onStatusChange((newStatus) => {
      setStatus(newStatus);
      if (newStatus === 'error') {
        setError('Connection error');
      } else if (newStatus === 'connected') {
        setError(null);
      }
    });

    client.connect().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unknown connection error';
      setError(message);
    });

    return client;
  }, [config.url, config.auth]);

  useEffect(() => {
    const client = doConnect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [doConnect]);

  return { status, client: clientRef.current, error };
}
