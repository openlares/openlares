/**
 * Server-side device identity storage — file-based.
 * Only imported from server-side code (task executor API routes).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { DeviceIdentity } from './device-identity';
import { generateDeviceIdentity } from './device-identity';

let cache: DeviceIdentity | null = null;

export async function getServerDeviceIdentity(): Promise<DeviceIdentity> {
  if (cache) return cache;

  const dir = path.join(os.homedir(), '.openlares', 'data');
  const filePath = path.join(dir, 'device-identity.json');

  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data) as DeviceIdentity;
    if (parsed.deviceId && parsed.publicKey && parsed.privateKey) {
      cache = parsed;
      return parsed;
    }
  } catch {
    // File doesn't exist or is corrupted
  }

  const identity = await generateDeviceIdentity();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(identity, null, 2));
  cache = identity;
  return identity;
}
