/**
 * Pure utility functions for the PixiJS canvas.
 *
 * Extracted from PixiCanvas so they can be unit-tested independently.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionSummary {
  sessionKey: string;
  title?: string;
  active: boolean;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------

export function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash);
}

// ---------------------------------------------------------------------------
// Friendly name generation
// ---------------------------------------------------------------------------

const ADJECTIVES = [
  'swift',
  'calm',
  'bold',
  'warm',
  'keen',
  'soft',
  'bright',
  'cool',
  'fair',
  'deep',
  'pure',
  'clear',
  'vivid',
  'quick',
  'gentle',
  'wild',
];

const NOUNS = [
  'fox',
  'owl',
  'star',
  'wave',
  'leaf',
  'fern',
  'moon',
  'wind',
  'spark',
  'cloud',
  'brook',
  'peak',
  'dawn',
  'glow',
  'mist',
  'tide',
];

/**
 * Deterministic friendly name from a session key.
 * Same key always maps to the same name (e.g. "swift fox").
 */
export function friendlyName(sessionKey: string): string {
  const h = hashCode(sessionKey);
  const adj = ADJECTIVES[h % ADJECTIVES.length]!;
  const noun = NOUNS[(h >>> 4) % NOUNS.length]!;
  return `${adj} ${noun}`;
}

// ---------------------------------------------------------------------------
// Display name
// ---------------------------------------------------------------------------

/** Maximum display name length for canvas labels. */
const MAX_NAME_LENGTH = 18;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 2)}\u2026` : s;
}

/**
 * Produce a short, human-readable display name for a session.
 *
 * Priority:
 * 1. Recognisable patterns (main, discord channels, cron jobs, subagents)
 * 2. Title if short enough
 * 3. Deterministic friendly name as fallback for technical IDs
 */
export function getDisplayName(session: SessionSummary): string {
  const { sessionKey, title } = session;
  const raw = title || sessionKey;

  // Main session
  if (sessionKey.endsWith(':main') || raw.includes('g-agent-main-main')) {
    return 'Main';
  }

  // Discord channels: extract #channel-name
  const channelMatch = raw.match(/#([^#]+)$/);
  if (channelMatch) {
    return truncate(`#${channelMatch[1]}`, MAX_NAME_LENGTH);
  }

  // Cron jobs
  if (raw.startsWith('Cron: ')) {
    return truncate(raw.substring(6), MAX_NAME_LENGTH);
  }

  // Subagents
  if (sessionKey.includes('subagent')) {
    const label = title || friendlyName(sessionKey);
    return `\uD83E\uDD16 ${truncate(label, MAX_NAME_LENGTH - 3)}`;
  }

  // Technical IDs -> friendly name
  if (
    /^[a-f0-9-]{20,}$/i.test(raw) ||
    raw.startsWith('agent:') ||
    (raw.length > 25 && raw.includes(':'))
  ) {
    return friendlyName(sessionKey);
  }

  return truncate(raw, MAX_NAME_LENGTH);
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const PALETTE = [0xf59e0b, 0x3b82f6, 0x8b5cf6, 0x10b981, 0xef4444, 0xf97316, 0x06b6d4, 0x84cc16];

export function getSessionColor(sessionKey: string): number {
  return PALETTE[hashCode(sessionKey) % PALETTE.length]!;
}

// ---------------------------------------------------------------------------
// Activity window & opacity
// ---------------------------------------------------------------------------

/** Sessions older than this are hidden from the canvas. */
export const ACTIVE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Calculate avatar opacity based on how recently the session was active.
 * The selected session is always fully opaque.
 */
export function getRecencyOpacity(session: SessionSummary, isSelected: boolean): number {
  if (isSelected) return 1.0;

  const ageMs = Date.now() - session.updatedAt;

  if (ageMs < 5 * 60 * 1000) return 1.0; // <5 min: full
  if (ageMs < 15 * 60 * 1000) return 0.85; // 5\u201315 min
  if (ageMs < 30 * 60 * 1000) return 0.65; // 15\u201330 min
  if (ageMs < ACTIVE_WINDOW_MS) return 0.4; // 30\u201360 min
  return 0; // >1 hr: invisible
}

/** Whether a session falls within the 1-hour active window. */
export function isWithinActiveWindow(session: SessionSummary): boolean {
  return Date.now() - session.updatedAt < ACTIVE_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function generateAvatarPositions(
  count: number,
  width: number,
  height: number,
): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  const minSpacing = 130;
  const margin = 80;
  const cols = Math.max(1, Math.floor((width - 2 * margin) / minSpacing));

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const baseX = margin + col * minSpacing;
    const baseY = margin + row * minSpacing;
    const offsetX = (Math.random() - 0.5) * 30;
    const offsetY = (Math.random() - 0.5) * 30;

    positions.push({
      x: Math.max(margin, Math.min(width - margin, baseX + offsetX)),
      y: Math.max(margin, Math.min(height - margin, baseY + offsetY)),
    });
  }

  return positions;
}
