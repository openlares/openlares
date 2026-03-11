'use client';

import { useState, useEffect } from 'react';
import { useGatewayStore } from '@openlares/api-client';
import { ConnectionStatus } from '@openlares/ui';
import {
  saveGatewayConfig,
  loadGatewayConfig,
  clearGatewayConfig,
  saveDisplayConfig,
  loadDisplayConfig,
} from '@/lib/storage';

export default function SettingsPage() {
  const connectionStatus = useGatewayStore((s) => s.connectionStatus);
  const error = useGatewayStore((s) => s.error);
  const connect = useGatewayStore((s) => s.connect);
  const disconnect = useGatewayStore((s) => s.disconnect);

  const [url, setUrl] = useState('ws://localhost:18789');
  const [token, setToken] = useState('');
  const [showThinking, setShowThinking] = useState(true);

  // Load saved config on mount
  useEffect(() => {
    const saved = loadGatewayConfig();
    if (saved) {
      setUrl(saved.url);
      setToken(saved.auth);
    }
    const displayConfig = loadDisplayConfig();
    setShowThinking(displayConfig.showThinking);
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

        {/* Display settings */}
        <div className="space-y-4 border-t border-gray-800 pt-6">
          <h2 className="text-lg font-semibold text-gray-200">Display</h2>
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-gray-800 bg-gray-900 p-4">
            <div>
              <p className="text-sm font-medium text-gray-200">Show thinking blocks</p>
              <p className="mt-0.5 text-xs text-gray-500">
                Display the agent’s chain-of-thought before each response
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={showThinking}
              onClick={() => {
                const next = !showThinking;
                setShowThinking(next);
                saveDisplayConfig({ showThinking: next });
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-gray-950 ${
                showThinking ? 'bg-amber-500' : 'bg-gray-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  showThinking ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </label>
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
