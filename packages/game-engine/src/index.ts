/**
 * OpenLares Game Engine \u2014 PixiJS rendering layer.
 *
 * Manages the WebGL canvas, avatar rendering, animations,
 * and visual effects. Communicates with the UI layer via EventBus.
 */

export { PixiCanvas } from './components/PixiCanvas';
export type { SessionSummary } from './canvas-utils';
export {
  resolveSessionName,
  getDisplayName,
  getFullName,
  getSessionColor,
  getRecencyOpacity,
  isWithinActiveWindow,
  shouldShowActivity,
  toolIcon,
  isToolBadgeFresh,
  TOOL_BADGE_TTL_MS,
  ACTIVITY_LINGER_MS,
  friendlyName,
  hashCode,
} from './canvas-utils';
