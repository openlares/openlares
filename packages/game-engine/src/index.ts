/**
 * OpenLares Game Engine — PixiJS rendering layer.
 *
 * Manages the WebGL canvas, avatar rendering, animations,
 * and visual effects. Communicates with the UI layer via EventBus.
 */

export { PixiCanvas } from './components/PixiCanvas';
export type { SessionSummary } from './canvas-utils';
export {
  getDisplayName,
  getSessionColor,
  getRecencyOpacity,
  isWithinActiveWindow,
  friendlyName,
  hashCode,
} from './canvas-utils';
