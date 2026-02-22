/**
 * Device Identity — Ed25519 keypair for gateway device authentication.
 *
 * The gateway requires each UI client to present a device identity
 * (Ed25519 public key + signed challenge) during the connect handshake.
 *
 * Identity is persisted in localStorage so it survives page reloads.
 */

import { etc, getPublicKeyAsync, signAsync } from '@noble/ed25519';

// Configure @noble/ed25519 to use WebCrypto for SHA-512
etc.sha512Async = async (message: Uint8Array): Promise<Uint8Array> => {
  const hash = await crypto.subtle.digest('SHA-512', message);
  return new Uint8Array(hash);
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeviceIdentity {
  deviceId: string;
  publicKey: string;   // base64url
  privateKey: string;  // base64url
}

export interface DeviceSignature {
  id: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce?: string;
}

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'openlares:device-identity';

// ---------------------------------------------------------------------------
// Base64url helpers
// ---------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function fromBase64Url(str: string): Uint8Array {
  const b64 = str.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Device ID = SHA-256 hex of raw public key bytes
// ---------------------------------------------------------------------------

async function computeDeviceId(publicKeyBytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', publicKeyBytes.buffer);
  return bytesToHex(new Uint8Array(hash));
}

// ---------------------------------------------------------------------------
// Generate / load identity
// ---------------------------------------------------------------------------

/** Generate a fresh Ed25519 keypair. */
async function generateIdentity(): Promise<DeviceIdentity> {
  const privateKeyBytes = etc.randomBytes(32);
  const publicKeyBytes = await getPublicKeyAsync(privateKeyBytes);
  const deviceId = await computeDeviceId(publicKeyBytes);
  return {
    deviceId,
    publicKey: toBase64Url(publicKeyBytes),
    privateKey: toBase64Url(privateKeyBytes),
  };
}

/**
 * Load existing identity from localStorage, or generate a new one.
 * Validates that the stored deviceId matches the public key hash.
 */
export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as DeviceIdentity;
      if (parsed.deviceId && parsed.publicKey && parsed.privateKey) {
        // Validate: recompute deviceId from stored publicKey
        const pubBytes = fromBase64Url(parsed.publicKey);
        const computedId = await computeDeviceId(pubBytes);
        if (computedId === parsed.deviceId) {
          return parsed;
        }
      }
    }
  } catch {
    // Corrupted storage — regenerate
  }

  const identity = await generateIdentity();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // localStorage might be unavailable — identity still works for this session
  }
  return identity;
}

// ---------------------------------------------------------------------------
// Canonical string for signing (matches gateway's fp() function)
// ---------------------------------------------------------------------------

interface SignParams {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce?: string;
}

function buildCanonicalString(params: SignParams): string {
  const version = params.nonce ? 'v2' : 'v1';
  const scopeStr = params.scopes.join(',');
  const tokenStr = params.token ?? '';
  const parts = [
    version,
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopeStr,
    String(params.signedAtMs),
    tokenStr,
  ];
  if (version === 'v2') {
    parts.push(params.nonce ?? '');
  }
  return parts.join('|');
}

// ---------------------------------------------------------------------------
// Sign for connect handshake
// ---------------------------------------------------------------------------

export async function signConnectChallenge(
  identity: DeviceIdentity,
  params: {
    clientId: string;
    clientMode: string;
    role: string;
    scopes: string[];
    token: string | null;
    nonce?: string;
  },
): Promise<DeviceSignature> {
  const signedAt = Date.now();
  const canonical = buildCanonicalString({
    deviceId: identity.deviceId,
    clientId: params.clientId,
    clientMode: params.clientMode,
    role: params.role,
    scopes: params.scopes,
    signedAtMs: signedAt,
    token: params.token,
    nonce: params.nonce,
  });

  const messageBytes = new TextEncoder().encode(canonical);
  const privateKeyBytes = fromBase64Url(identity.privateKey);
  const signatureBytes = await signAsync(messageBytes, privateKeyBytes);

  return {
    id: identity.deviceId,
    publicKey: identity.publicKey,
    signature: toBase64Url(signatureBytes),
    signedAt,
    nonce: params.nonce,
  };
}
