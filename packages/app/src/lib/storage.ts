import type { GatewayConfig } from '@openlares/core';

const STORAGE_KEY = 'openlares:gateway-config';

/** Save gateway config to localStorage. */
export function saveGatewayConfig(config: GatewayConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage may be unavailable (SSR, private mode, quota exceeded)
  }
}

/** Load gateway config from localStorage. Returns null if missing or invalid. */
export function loadGatewayConfig(): GatewayConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'url' in parsed &&
      'auth' in parsed &&
      typeof (parsed as GatewayConfig).url === 'string' &&
      typeof (parsed as GatewayConfig).auth === 'string'
    ) {
      return parsed as GatewayConfig;
    }
    return null;
  } catch {
    return null;
  }
}

/** Clear saved gateway config from localStorage. */
export function clearGatewayConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}

const DISPLAY_CONFIG_KEY = 'openlares:display-config';

export interface DisplayConfig {
  showThinking: boolean;
}

const DEFAULT_DISPLAY_CONFIG: DisplayConfig = { showThinking: true };

/** Save display preferences to localStorage. */
export function saveDisplayConfig(config: DisplayConfig): void {
  try {
    localStorage.setItem(DISPLAY_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // localStorage may be unavailable (SSR, private mode, quota exceeded)
  }
}

/** Load display preferences from localStorage. Returns defaults if missing or invalid. */
export function loadDisplayConfig(): DisplayConfig {
  try {
    const raw = localStorage.getItem(DISPLAY_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_DISPLAY_CONFIG };
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'showThinking' in parsed &&
      typeof (parsed as DisplayConfig).showThinking === 'boolean'
    ) {
      return parsed as DisplayConfig;
    }
    return { ...DEFAULT_DISPLAY_CONFIG };
  } catch {
    return { ...DEFAULT_DISPLAY_CONFIG };
  }
}
