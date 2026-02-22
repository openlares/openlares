import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  hashCode,
  friendlyName,
  getDisplayName,
  getFullName,
  getSessionColor,
  getRecencyOpacity,
  isWithinActiveWindow,
  generateAvatarPositions,
  ACTIVE_WINDOW_MS,
} from '../canvas-utils';
import type { SessionSummary } from '../canvas-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionKey: 'agent:main:discord:channel:123456',
    title: '',
    active: true,
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// hashCode
// ---------------------------------------------------------------------------

describe('hashCode', () => {
  it('returns a non-negative integer', () => {
    expect(hashCode('hello')).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(hashCode('hello'))).toBe(true);
  });

  it('is deterministic', () => {
    expect(hashCode('test-key')).toBe(hashCode('test-key'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashCode('alpha')).not.toBe(hashCode('beta'));
  });
});

// ---------------------------------------------------------------------------
// friendlyName
// ---------------------------------------------------------------------------

describe('friendlyName', () => {
  it('returns two words separated by a space', () => {
    const name = friendlyName('some-session-key');
    expect(name.split(' ')).toHaveLength(2);
  });

  it('is deterministic for the same key', () => {
    expect(friendlyName('abc')).toBe(friendlyName('abc'));
  });

  it('produces different names for different keys', () => {
    // Not guaranteed for all inputs, but highly likely for distinct strings
    const a = friendlyName('session-alpha');
    const b = friendlyName('session-beta');
    // At least one should differ (very unlikely collision)
    expect(a === b && a === friendlyName('session-gamma')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getDisplayName
// ---------------------------------------------------------------------------

describe('getDisplayName', () => {
  it('returns "Main" for main session', () => {
    expect(getDisplayName(makeSession({ sessionKey: 'agent:main:main' }))).toBe('Main');
  });

  it('returns "Main" for g-agent-main-main title', () => {
    expect(getDisplayName(makeSession({ title: 'discord:g-agent-main-main' }))).toBe('Main');
  });

  it('extracts discord channel name from title with #', () => {
    const result = getDisplayName(makeSession({ title: 'Guild #openlares channel id:123' }));
    expect(result.startsWith('#openlares')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(18);
  });

  it('extracts last # segment from title', () => {
    expect(getDisplayName(makeSession({ title: 'Server #general' }))).toBe('#general');
  });

  it('truncates long channel names', () => {
    const longName = '#this-is-a-very-long-channel-name-wow';
    const result = getDisplayName(makeSession({ title: longName }));
    expect(result.length).toBeLessThanOrEqual(18);
    expect(result).toContain('\u2026');
  });

  it('strips Cron: prefix', () => {
    expect(getDisplayName(makeSession({ title: 'Cron: daily-email' }))).toBe('daily-email');
  });

  it('adds robot emoji for subagents', () => {
    const result = getDisplayName(
      makeSession({ sessionKey: 'subagent:task-123', title: 'My Task' }),
    );
    expect(result).toMatch(/^\uD83E\uDD16/);
    expect(result).toContain('My Task');
  });

  it('uses friendly name for long technical IDs', () => {
    const result = getDisplayName(
      makeSession({
        sessionKey: 'agent:main:discord:channel:1472142915416359027',
        title: '',
      }),
    );
    // Should NOT contain colons or long numbers
    expect(result).not.toContain(':');
    expect(result.split(' ')).toHaveLength(2); // friendly name = 2 words
  });

  it('uses friendly name for UUID-like session keys', () => {
    const result = getDisplayName(
      makeSession({
        sessionKey: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        title: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      }),
    );
    expect(result.split(' ')).toHaveLength(2);
  });

  it('uses short title as-is', () => {
    expect(getDisplayName(makeSession({ sessionKey: 'x', title: 'My Chat' }))).toBe('My Chat');
  });

  it('truncates long regular titles', () => {
    const result = getDisplayName(
      makeSession({ sessionKey: 'x', title: 'A Very Long Session Title Here' }),
    );
    expect(result.length).toBeLessThanOrEqual(18);
    expect(result).toContain('\u2026');
  });
});

// ---------------------------------------------------------------------------
// getFullName
// ---------------------------------------------------------------------------

describe('getFullName', () => {
  it('returns untruncated discord channel name', () => {
    const result = getFullName(makeSession({ title: 'Guild #very-long-channel-name-here' }));
    expect(result).toBe('#very-long-channel-name-here');
    // getDisplayName would truncate this
    expect(result.length).toBeGreaterThan(18);
  });

  it('matches getDisplayName for short names', () => {
    const session = makeSession({ title: 'Server #general' });
    expect(getFullName(session)).toBe(getDisplayName(session));
  });

  it('returns full cron job name', () => {
    const session = makeSession({ title: 'Cron: very-long-daily-email-check-job' });
    expect(getFullName(session)).toBe('very-long-daily-email-check-job');
  });

  it('returns Main for main session', () => {
    expect(getFullName(makeSession({ sessionKey: 'agent:main:main' }))).toBe('Main');
  });
});

// ---------------------------------------------------------------------------
// getSessionColor
// ---------------------------------------------------------------------------

describe('getSessionColor', () => {
  it('returns a number', () => {
    expect(typeof getSessionColor('key')).toBe('number');
  });

  it('is deterministic', () => {
    expect(getSessionColor('key')).toBe(getSessionColor('key'));
  });
});

// ---------------------------------------------------------------------------
// getRecencyOpacity
// ---------------------------------------------------------------------------

describe('getRecencyOpacity', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 1.0 for selected session regardless of age', () => {
    const old = makeSession({ updatedAt: Date.now() - 2 * ACTIVE_WINDOW_MS });
    expect(getRecencyOpacity(old, true)).toBe(1.0);
  });

  it('returns 1.0 for sessions updated < 5 min ago', () => {
    const recent = makeSession({ updatedAt: Date.now() - 2 * 60 * 1000 });
    expect(getRecencyOpacity(recent, false)).toBe(1.0);
  });

  it('returns 0.85 for sessions updated 5-15 min ago', () => {
    const s = makeSession({ updatedAt: Date.now() - 10 * 60 * 1000 });
    expect(getRecencyOpacity(s, false)).toBe(0.85);
  });

  it('returns 0.65 for sessions updated 15-30 min ago', () => {
    const s = makeSession({ updatedAt: Date.now() - 20 * 60 * 1000 });
    expect(getRecencyOpacity(s, false)).toBe(0.65);
  });

  it('returns 0.4 for sessions updated 30-60 min ago', () => {
    const s = makeSession({ updatedAt: Date.now() - 45 * 60 * 1000 });
    expect(getRecencyOpacity(s, false)).toBe(0.4);
  });

  it('returns 0 for sessions older than 1 hour', () => {
    const s = makeSession({ updatedAt: Date.now() - 90 * 60 * 1000 });
    expect(getRecencyOpacity(s, false)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isWithinActiveWindow
// ---------------------------------------------------------------------------

describe('isWithinActiveWindow', () => {
  it('returns true for recent sessions', () => {
    expect(isWithinActiveWindow(makeSession({ updatedAt: Date.now() - 1000 }))).toBe(true);
  });

  it('returns false for sessions older than 1 hour', () => {
    expect(
      isWithinActiveWindow(makeSession({ updatedAt: Date.now() - ACTIVE_WINDOW_MS - 1 })),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateAvatarPositions
// ---------------------------------------------------------------------------

describe('generateAvatarPositions', () => {
  it('returns the correct number of positions', () => {
    expect(generateAvatarPositions(5, 800, 600)).toHaveLength(5);
  });

  it('returns empty array for count 0', () => {
    expect(generateAvatarPositions(0, 800, 600)).toHaveLength(0);
  });

  it('keeps positions within bounds', () => {
    const positions = generateAvatarPositions(10, 800, 600);
    for (const pos of positions) {
      expect(pos.x).toBeGreaterThanOrEqual(80);
      expect(pos.x).toBeLessThanOrEqual(720);
      expect(pos.y).toBeGreaterThanOrEqual(80);
    }
  });
});
