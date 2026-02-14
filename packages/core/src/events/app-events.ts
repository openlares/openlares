import type { ActivityItem, ConnectionStatus } from '../types/index.js';

/**
 * Map of all application-level events.
 *
 * Keys are event names, values are the payload types.
 * Used with EventBus<AppEvents> for full type safety.
 */
export interface AppEvents {
  /** Agent connection status changed */
  'agent:status': { status: ConnectionStatus };

  /** New activity item to show in the feed */
  'activity:new': ActivityItem;

  /** Scene is ready (PixiJS finished loading) */
  'scene:ready': undefined;

  /** Scene resize happened */
  'scene:resize': { width: number; height: number };
}
