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
// Friendly name generation (last resort)
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
 * Used only as a last resort when no structured info is available.
 */
export function friendlyName(sessionKey: string): string {
  const h = hashCode(sessionKey);
  const adj = ADJECTIVES[h % ADJECTIVES.length]!;
  const noun = NOUNS[(h >>> 4) % NOUNS.length]!;
  return `${adj} ${noun}`;
}

// ---------------------------------------------------------------------------
// Session name resolution
// ---------------------------------------------------------------------------

interface ResolvedName {
  /** Emoji prefix indicating the session source. Empty for main/unknown. */
  icon: string;
  /** Human-readable session name (untruncated). */
  name: string;
}

/**
 * Resolve a session into an icon + human-readable name.
 *
 * Parses the sessionKey structure (universal across all OpenClaw instances)
 * and falls back to the title, then to a friendly word pair.
 *
 * Session key patterns:
 *   agent:{name}:{source}:{type}:{id}   (channel sessions)
 *   hook:{name}:{id}                     (webhook/hook sessions)
 *   subagent:{...}                       (spawned sub-agents)
 *   agent:{name}:main                    (main session)
 */
export function resolveSessionName(session: SessionSummary): ResolvedName {
  const { sessionKey, title } = session;
  const raw = title || sessionKey;

  // ---- Main session ----
  if (sessionKey.endsWith(':main') || raw.includes('g-agent-main-main')) {
    return { icon: '', name: 'Main' };
  }

  // ---- Channel sources (detected from sessionKey) ----
  if (sessionKey.includes(':discord:')) {
    const ch = raw.match(/#([^#]+)$/);
    return { icon: '\uD83D\uDCAC', name: ch ? `#${ch[1]}` : title || 'discord' };
  }

  if (sessionKey.includes(':telegram:')) {
    return { icon: '\u2708\uFE0F', name: title || 'telegram' };
  }

  if (sessionKey.includes(':whatsapp:')) {
    return { icon: '\uD83D\uDCF1', name: title || 'whatsapp' };
  }

  if (sessionKey.includes(':signal:')) {
    return { icon: '\uD83D\uDD12', name: title || 'signal' };
  }

  if (sessionKey.includes(':slack:')) {
    return { icon: '\uD83D\uDCBC', name: title || 'slack' };
  }

  if (sessionKey.includes(':irc:')) {
    return { icon: '\uD83D\uDCE1', name: title || 'irc' };
  }

  if (sessionKey.includes(':imessage:')) {
    return { icon: '\uD83D\uDCE8', name: title || 'iMessage' };
  }

  if (sessionKey.includes(':googlechat:')) {
    return { icon: '\uD83D\uDDE8\uFE0F', name: title || 'google chat' };
  }

  // ---- Hook sessions ----
  if (sessionKey.startsWith('hook:')) {
    // hook:pipeline:task-42 -> "pipeline: task-42"
    const parts = sessionKey.split(':').slice(1);
    const hookLabel = parts.join(': ');
    return { icon: '\uD83D\uDD17', name: title || hookLabel || 'hook' };
  }

  // ---- Sub-agents ----
  if (sessionKey.includes('subagent')) {
    return { icon: '\uD83E\uDD16', name: title || friendlyName(sessionKey) };
  }

  // ---- Cron jobs ----
  if (raw.startsWith('Cron: ')) {
    return { icon: '\u23F0', name: raw.substring(6) };
  }
  if (sessionKey.includes('cron')) {
    return { icon: '\u23F0', name: title || 'cron' };
  }

  // ---- Title available and reasonable ----
  if (title && title.length > 0 && !/^[a-f0-9-]{20,}$/i.test(title)) {
    return { icon: '', name: title };
  }

  // ---- Last resort: friendly word pair ----
  return { icon: '', name: friendlyName(sessionKey) };
}

// ---------------------------------------------------------------------------
// Display name (truncated for canvas labels)
// ---------------------------------------------------------------------------

/** Maximum display name length for canvas labels. */
const MAX_NAME_LENGTH = 18;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 2)}\u2026` : s;
}

/**
 * Short display name for canvas avatar labels.
 * Truncated to fit above the circle.
 */
export function getDisplayName(session: SessionSummary): string {
  const { icon, name } = resolveSessionName(session);
  if (!icon) return truncate(name, MAX_NAME_LENGTH);
  // Reserve space for icon + space
  return `${icon} ${truncate(name, MAX_NAME_LENGTH - 3)}`;
}

/**
 * Full (untruncated) display name for tooltips.
 */
export function getFullName(session: SessionSummary): string {
  const { icon, name } = resolveSessionName(session);
  return icon ? `${icon} ${name}` : name;
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
  if (ageMs < 15 * 60 * 1000) return 0.85; // 5-15 min
  if (ageMs < 30 * 60 * 1000) return 0.65; // 15-30 min
  if (ageMs < ACTIVE_WINDOW_MS) return 0.4; // 30-60 min
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
