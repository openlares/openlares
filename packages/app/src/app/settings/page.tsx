'use client';

import { useState, useEffect } from 'react';
import { useGatewayStore } from '@openlares/api-client';
import { ConnectionStatus } from '@openlares/ui';
import { saveGatewayConfig, loadGatewayConfig, clearGatewayConfig } from '@/lib/storage';

export default function SettingsPage() {
  const connectionStatus = useGatewayStore((s) => s.connectionStatus);
  const error = useGatewayStore((s) => s.error);
  const connect = useGatewayStore((s) => s.connect);
  const disconnect = useGatewayStore((s) => s.disconnect);

  const [url, setUrl] = useState('ws://localhost:18789');
  const [token, setToken] = useState('');

  // Load saved config on mount
  useEffect(() => {
    const saved = loadGatewayConfig();
    if (saved) {
      setUrl(saved.url);
      setToken(saved.auth);
    }
  }, []);

  const isConnected = connectionStatus === 'connected';
  const isConnecting = connectionStatus === 'connecting';

  function handleConnect() {
    const config = { url, auth: token };
    saveGatewayConfig(config);
    void connect(config);
  }

  function handleDisconnect() {
    disconnect();
    clearGatewayConfig();
  }

  return (
    <div className="flex h-full items-start justify-center p-8">
      <div className="w-full max-w-md space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="text-amber-400">Gateway</span> Settings
        </h1>

        {/* Connection status */}
        <div className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 p-4">
          <ConnectionStatus status={connectionStatus} />
          {error && <span className="ml-auto text-xs text-red-400">{error}</span>}
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label htmlFor="gateway-url" className="mb-1 block text-sm text-gray-400">
              Gateway URL
            </label>
            <input
              id="gateway-url"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isConnected || isConnecting}
              placeholder="ws://localhost:18789"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="gateway-token" className="mb-1 block text-sm text-gray-400">
              Auth Token
            </label>
            <input
              id="gateway-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={isConnected || isConnecting}
              placeholder="Enter token"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 focus:outline-none disabled:opacity-50"
            />
          </div>
        </div>

        {/* Action button */}
        {isConnected ? (
          <button
            type="button"
            onClick={handleDisconnect}
            className="w-full cursor-pointer rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-600"
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            disabled={isConnecting || !url}
            className="w-full cursor-pointer rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isConnecting ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>
    </div>
  );
}
