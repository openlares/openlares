import type { GatewayClient } from '@openlares/api-client';

declare const global: typeof globalThis & { __gatewayClient?: GatewayClient | null };

export function getGatewayClient(): GatewayClient | null {
  return global.__gatewayClient ?? null;
}
