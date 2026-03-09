'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { GatewayClient } from '@openlares/api-client';
import { useGatewayStore } from '@openlares/api-client';
import { saveGatewayConfig } from '@/lib/storage';

type WizardStep =
  | 'location'
  | 'probing'
  | 'probe-failed'
  | 'token'
  | 'connecting'
  | 'pairing'
  | 'conn-error';

interface SetupWizardProps {
  onSkip: () => void;
}

async function probeGateway(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(false);
    }, 3000);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
      ws.onmessage = () => {
        clearTimeout(timeout);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        resolve(true);
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
    } catch {
      clearTimeout(timeout);
      resolve(false);
    }
  });
}

async function attemptConnect(
  url: string,
  auth: string,
): Promise<'success' | 'pairing-required' | string> {
  const client = new GatewayClient({ url, token: auth, requestTimeoutMs: 15000 });
  try {
    await client.connect();
    client.disconnect();
    return 'success';
  } catch (err) {
    client.disconnect();
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'pairing-required') return 'pairing-required';
    return msg;
  }
}

export function SetupWizard({ onSkip }: SetupWizardProps) {
  const router = useRouter();
  const connect = useGatewayStore((s) => s.connect);

  const [step, setStep] = useState<WizardStep>('location');
  const [url, setUrl] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [showCustomUrl, setShowCustomUrl] = useState(false);
  const [token, setToken] = useState('');
  const [connError, setConnError] = useState('');

  const pairingIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear pairing interval on unmount
  useEffect(() => {
    return () => {
      if (pairingIntervalRef.current !== null) {
        clearTimeout(pairingIntervalRef.current);
      }
    };
  }, []);

  // Auto-retry connect every 4s during pairing step
  useEffect(() => {
    if (step !== 'pairing') {
      if (pairingIntervalRef.current !== null) {
        clearTimeout(pairingIntervalRef.current);
        pairingIntervalRef.current = null;
      }
      return;
    }

    const scheduleRetry = () => {
      pairingIntervalRef.current = setTimeout(async () => {
        const result = await attemptConnect(url, token);
        if (result === 'success') {
          saveGatewayConfig({ url, auth: token });
          await connect({ url, auth: token });
          router.push('/projects');
        } else if (result === 'pairing-required') {
          scheduleRetry();
        } else {
          setConnError(result);
          setStep('conn-error');
        }
      }, 4000);
    };

    scheduleRetry();

    return () => {
      if (pairingIntervalRef.current !== null) {
        clearTimeout(pairingIntervalRef.current);
        pairingIntervalRef.current = null;
      }
    };
  }, [step, url, token, connect, router]);

  const handleThisComputer = async () => {
    const gatewayUrl = 'ws://localhost:18789';
    setUrl(gatewayUrl);
    setStep('probing');
    const reachable = await probeGateway(gatewayUrl);
    if (reachable) {
      setStep('token');
    } else {
      setStep('probe-failed');
    }
  };

  const handleAnotherMachine = async () => {
    const trimmed = customUrl.trim();
    if (!trimmed) return;
    setUrl(trimmed);
    setStep('probing');
    const reachable = await probeGateway(trimmed);
    if (reachable) {
      setStep('token');
    } else {
      setStep('probe-failed');
    }
  };

  const handleRetryProbe = async () => {
    setStep('probing');
    const reachable = await probeGateway(url);
    if (reachable) {
      setStep('token');
    } else {
      setStep('probe-failed');
    }
  };

  const handleConnect = async () => {
    if (!token.trim()) return;
    setStep('connecting');
    const result = await attemptConnect(url, token.trim());
    if (result === 'success') {
      saveGatewayConfig({ url, auth: token.trim() });
      await connect({ url, auth: token.trim() });
      router.push('/projects');
    } else if (result === 'pairing-required') {
      setStep('pairing');
    } else {
      setConnError(result);
      setStep('conn-error');
    }
  };

  const isLocalhost = url === 'ws://localhost:18789';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        {/* location step */}
        {step === 'location' && (
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="text-xl font-semibold text-slate-100">Connect to OpenClaw</h1>
              <p className="mt-1 text-sm text-slate-400">Where is your gateway running?</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleThisComputer}
                className="flex-1 rounded-lg border border-slate-700 px-4 py-3 text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors"
              >
                💻 This computer
              </button>
              <button
                onClick={() => setShowCustomUrl(true)}
                className="flex-1 rounded-lg border border-slate-700 px-4 py-3 text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors"
              >
                🌐 Another machine
              </button>
            </div>

            {showCustomUrl && (
              <div className="flex flex-col gap-3">
                <input
                  type="text"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="ws://192.168.1.100:18789"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                  onKeyDown={(e) => e.key === 'Enter' && handleAnotherMachine()}
                />
                <button
                  onClick={handleAnotherMachine}
                  disabled={!customUrl.trim()}
                  className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-cyan-400 disabled:opacity-50 transition-colors"
                >
                  Continue
                </button>
              </div>
            )}

            <div className="text-center">
              <button onClick={onSkip} className="text-xs text-slate-600 hover:text-slate-400">
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* probing step */}
        {step === 'probing' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="animate-spin h-5 w-5 border-2 border-cyan-500 border-t-transparent rounded-full" />
            <p className="text-sm text-slate-400">Checking for gateway...</p>
          </div>
        )}

        {/* probe-failed step */}
        {step === 'probe-failed' && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Gateway not found</h2>
              <p className="mt-1 text-sm text-slate-400">
                No OpenClaw gateway detected at{' '}
                <span className="font-mono text-cyan-400">{url}</span>
              </p>
            </div>

            {isLocalhost ? (
              <div className="flex flex-col gap-1">
                <p className="text-sm text-slate-400">Is OpenClaw running? Start it with:</p>
                <code className="rounded bg-slate-800 px-3 py-2 font-mono text-sm text-slate-300">
                  openclaw gateway start
                </code>
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                Check that OpenClaw is running and the URL is correct.
              </p>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={handleRetryProbe}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-cyan-400 transition-colors"
              >
                Try again
              </button>
              <button
                onClick={() => {
                  setShowCustomUrl(false);
                  setCustomUrl('');
                  setStep('location');
                }}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                Enter a different address
              </button>
              <button onClick={onSkip} className="text-xs text-slate-600 hover:text-slate-400">
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* token step */}
        {step === 'token' && (
          <div className="flex flex-col gap-5">
            <div>
              <p className="text-xs text-slate-500">
                Gateway found at <span className="font-mono text-cyan-400">{url}</span> ✓
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-100">Auth Token</h2>
            </div>

            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your token here"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none font-mono"
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              />
              <p className="text-xs text-slate-500">
                Run{' '}
                <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-slate-300">
                  openclaw token show
                </code>{' '}
                in your terminal and paste the token here.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={handleConnect}
                disabled={!token.trim()}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-cyan-400 disabled:opacity-50 transition-colors"
              >
                Connect
              </button>
              <div className="text-center">
                <button onClick={onSkip} className="text-xs text-slate-600 hover:text-slate-400">
                  Skip for now
                </button>
              </div>
            </div>
          </div>
        )}

        {/* connecting step */}
        {step === 'connecting' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="animate-spin h-5 w-5 border-2 border-cyan-500 border-t-transparent rounded-full" />
            <p className="text-sm text-slate-400">Connecting...</p>
          </div>
        )}

        {/* pairing step */}
        {step === 'pairing' && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">🔗 Approve this device</h2>
              <p className="mt-1 text-sm text-slate-400">
                A new device is trying to connect to your gateway. Approve it to continue.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <code className="rounded bg-slate-800 px-3 py-2 font-mono text-sm text-slate-300">
                openclaw devices approve
              </code>
              <p className="text-xs text-slate-500">
                Or open the OpenClaw web UI and approve under Devices.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
              </span>
              <p className="text-sm text-slate-400">Waiting for approval...</p>
            </div>

            <div className="text-center">
              <button
                onClick={() => setStep('token')}
                className="text-xs text-slate-600 hover:text-slate-400"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* conn-error step */}
        {step === 'conn-error' && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Connection failed</h2>
              <p className="mt-1 text-sm text-red-400 break-all">{connError}</p>
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => setStep('token')}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-cyan-400 transition-colors"
              >
                Try again
              </button>
              <div className="text-center">
                <button onClick={onSkip} className="text-xs text-slate-600 hover:text-slate-400">
                  Skip for now
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
