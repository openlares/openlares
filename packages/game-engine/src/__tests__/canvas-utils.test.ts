import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  hashCode,
  seededRandom,
  shouldShowActivity,
  toolIcon,
  isToolBadgeFresh,
  TOOL_BADGE_TTL_MS,
  ACTIVITY_LINGER_MS,
  friendlyName,
  resolveSessionName,
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
// seededRandom
// ---------------------------------------------------------------------------

describe('seededRandom', () => {
  it('returns a value in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const val = seededRandom(i);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('is deterministic for the same seed', () => {
    expect(seededRandom(42)).toBe(seededRandom(42));
    expect(seededRandom(999)).toBe(seededRandom(999));
  });

  it('produces different values for different seeds', () => {
    const values = new Set<number>();
    for (let i = 0; i < 20; i++) {
      values.add(seededRandom(i));
    }
    // At least 15 unique values out of 20 (allowing some rare collisions)
    expect(values.size).toBeGreaterThan(15);
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
});

// ---------------------------------------------------------------------------
// resolveSessionName
// ---------------------------------------------------------------------------

describe('resolveSessionName', () => {
  it('identifies main session', () => {
    const result = resolveSessionName(makeSession({ sessionKey: 'agent:main:main' }));
    expect(result).toEqual({ icon: '', name: 'Main' });
  });

  it('identifies discord with channel title', () => {
    const result = resolveSessionName(
      makeSession({
        sessionKey: 'agent:main:discord:channel:123',
        title: 'Guild #openlares channel id:123',
      }),
    );
    expect(result.icon).toBe('\uD83D\uDCAC');
    expect(result.name).toBe('Guild #openlares channel id:123');
  });

  it('preserves full discord title with multiple # signs', () => {
    const result = resolveSessionName(
      makeSession({
        sessionKey: 'agent:main:discord:thread:456',
        title: '#openlares › bug fixes #1',
      }),
    );
    expect(result.icon).toBe('\uD83D\uDCAC');
    expect(result.name).toBe('#openlares › bug fixes #1');
  });

  it('identifies discord without title', () => {
    const result = resolveSessionName(
      makeSession({ sessionKey: 'agent:main:discord:channel:123', title: '' }),
    );
    expect(result.icon).toBe('\uD83D\uDCAC');
    expect(result.name).toBe('discord');
  });

  it('identifies telegram', () => {
    const result = resolveSessionName(
      makeSession({ sessionKey: 'agent:main:telegram:chat:456', title: 'Vlad' }),
    );
    expect(result.icon).toBe('\u2708\uFE0F');
    expect(result.name).toBe('Vlad');
  });

  it('identifies whatsapp', () => {
    const result = resolveSessionName(makeSession({ sessionKey: 'agent:main:whatsapp:chat:789' }));
    expect(result.icon).toBe('\uD83D\uDCF1');
  });

  it('identifies signal', () => {
    const result = resolveSessionName(makeSession({ sessionKey: 'agent:main:signal:chat:abc' }));
    expect(result.icon).toBe('\uD83D\uDD12');
  });

  it('identifies slack', () => {
    const result = resolveSessionName(makeSession({ sessionKey: 'agent:main:slack:channel:xyz' }));
    expect(result.icon).toBe('\uD83D\uDCBC');
  });

  it('parses hook sessions from key segments', () => {
    const result = resolveSessionName(
      makeSession({ sessionKey: 'hook:pipeline:task-42', title: '' }),
    );
    expect(result.icon).toBe('\uD83D\uDD17');
    expect(result.name).toBe('pipeline: task-42');
  });

  it('uses title for hook if available', () => {
    const result = resolveSessionName(
      makeSession({ sessionKey: 'hook:pipeline:task-42', title: 'Deploy frontend' }),
    );
    expect(result.icon).toBe('\uD83D\uDD17');
    expect(result.name).toBe('Deploy frontend');
  });

  it('detects hook sessions with agent prefix', () => {
    const result = resolveSessionName(
      makeSession({ sessionKey: 'agent:main:hook:pipeline:ks-45385', title: '' }),
    );
    expect(result.icon).toBe('\uD83D\uDD17');
    expect(result.name).toBe('pipeline: ks-45385');
  });

  it('identifies subagents', () => {
    const result = resolveSessionName(
      makeSession({ sessionKey: 'subagent:abc123', title: 'Research task' }),
    );
    expect(result.icon).toBe('\uD83E\uDD16');
    expect(result.name).toBe('Research task');
  });

  it('identifies cron from title', () => {
    const result = resolveSessionName(
      makeSession({ sessionKey: 'agent:main:xxx', title: 'Cron: daily-email-check' }),
    );
    expect(result.icon).toBe('\u23F0');
    expect(result.name).toBe('daily-email-check');
  });

  it('identifies cron from sessionKey', () => {
    const result = resolveSessionName(makeSession({ sessionKey: 'cron:daily-backup', title: '' }));
    expect(result.icon).toBe('\u23F0');
  });

  it('shows provider prefix for openai sessions with title', () => {
    const result = resolveSessionName(
      makeSession({ sessionKey: 'agent:main:openai:bright-owl', title: 'bright owl' }),
    );
    expect(result.icon).toBe('\uD83C\uDF10');
    expect(result.name).toBe('openai: bright owl');
  });

  it('uses friendly name for sessions without title (not raw UUID)', () => {
    const result = resolveSessionName(
      makeSession({
        sessionKey: 'agent:main:openai:e8488174-aac1-45a3-aeae-cdd6c6c7554c',
        title: '',
      }),
    );
    expect(result.icon).toBe('\uD83C\uDF10');
    // Should use friendly word pair, not the raw UUID
    expect(result.name).toMatch(/^openai: \w+ \w+$/);
  });

  it('shows agent name instead of provider for non-main agents', () => {
    const result = resolveSessionName(
      makeSession({
        sessionKey: 'agent:jobs:openai:e8488174-aac1-45a3-aeae-cdd6c6c7554c',
        title: '',
      }),
    );
    expect(result.icon).toBe('\uD83C\uDF10');
    // Agent name 'jobs' is more useful than provider 'openai'
    expect(result.name).toMatch(/^jobs: \w+ \w+$/);
  });

  it('shows provider prefix for anthropic sessions', () => {
    const result = resolveSessionName(
      makeSession({ sessionKey: 'agent:main:anthropic:session-42', title: 'Research' }),
    );
    expect(result.icon).toBe('\uD83C\uDF10');
    expect(result.name).toBe('anthropic: Research');
  });

  it('uses title when available and not a UUID', () => {
    const result = resolveSessionName(
      makeSession({ sessionKey: 'something:unknown', title: 'My Custom Session' }),
    );
    expect(result.icon).toBe('');
    expect(result.name).toBe('My Custom Session');
  });

  it('falls back to friendly name for UUID-like titles', () => {
    const result = resolveSessionName(
      makeSession({
        sessionKey: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        title: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      }),
    );
    expect(result.icon).toBe('');
    // Should be a friendly name (2 words)
    expect(result.name.split(' ')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// getDisplayName & getFullName
// ---------------------------------------------------------------------------

describe('getDisplayName', () => {
  it('returns Main for main session', () => {
    expect(getDisplayName(makeSession({ sessionKey: 'agent:main:main' }))).toBe('Main');
  });

  it('includes source icon for discord', () => {
    const result = getDisplayName(
      makeSession({
        sessionKey: 'agent:main:discord:channel:123',
        title: 'Server #general',
      }),
    );
    expect(result).toContain('\uD83D\uDCAC');
    expect(result).toContain('#general');
  });

  it('truncates long names', () => {
    const result = getDisplayName(
      makeSession({
        sessionKey: 'agent:main:discord:channel:123',
        title: 'Guild #very-long-channel-name-here',
      }),
    );
    expect(result.length).toBeLessThanOrEqual(20); // icon + space + truncated
  });

  it('includes hook icon', () => {
    const result = getDisplayName(makeSession({ sessionKey: 'hook:pipeline:task-42', title: '' }));
    expect(result).toContain('\uD83D\uDD17');
    expect(result).toContain('pipeline');
  });
});

describe('getFullName', () => {
  it('returns untruncated name', () => {
    const result = getFullName(
      makeSession({
        sessionKey: 'agent:main:discord:channel:123',
        title: 'Guild #very-long-channel-name-here',
      }),
    );
    expect(result).toContain('#very-long-channel-name-here');
  });

  it('matches getDisplayName for short names', () => {
    const session = makeSession({ sessionKey: 'agent:main:main' });
    expect(getFullName(session)).toBe(getDisplayName(session));
  });

  it('returns full hook name', () => {
    const result = getFullName(
      makeSession({ sessionKey: 'hook:back-pipeline:long-task-description-here', title: '' }),
    );
    expect(result).toBe('\uD83D\uDD17 back-pipeline: long-task-description-here');
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
// shouldShowActivity
// ---------------------------------------------------------------------------

describe('shouldShowActivity', () => {
  it('returns true for active run', () => {
    expect(shouldShowActivity({ active: true, startedAt: Date.now(), endedAt: 0 })).toBe(true);
  });

  it('returns true for recently ended run', () => {
    expect(shouldShowActivity({ active: false, startedAt: 0, endedAt: Date.now() - 1000 })).toBe(
      true,
    );
  });

  it('returns false for old ended run', () => {
    expect(
      shouldShowActivity({
        active: false,
        startedAt: 0,
        endedAt: Date.now() - ACTIVITY_LINGER_MS - 1,
      }),
    ).toBe(false);
  });

  it('returns false when endedAt is 0 and not active', () => {
    expect(shouldShowActivity({ active: false, startedAt: 0, endedAt: 0 })).toBe(false);
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

  it('returns deterministic positions for the same inputs', () => {
    const a = generateAvatarPositions(5, 800, 600);
    const b = generateAvatarPositions(5, 800, 600);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// toolIcon
// ---------------------------------------------------------------------------

describe('toolIcon', () => {
  it('returns wrench for exec', () => {
    expect(toolIcon('exec')).toBe('\uD83D\uDD27');
  });

  it('returns wrench for bash (alias)', () => {
    expect(toolIcon('bash')).toBe('\uD83D\uDD27');
  });

  it('returns book for read', () => {
    expect(toolIcon('read')).toBe('\uD83D\uDCD6');
  });

  it('returns pencil for write', () => {
    expect(toolIcon('write')).toBe('\u270F\uFE0F');
  });

  it('returns pencil for edit', () => {
    expect(toolIcon('edit')).toBe('\u270F\uFE0F');
  });

  it('returns globe for web_search', () => {
    expect(toolIcon('web_search')).toBe('\uD83C\uDF10');
  });

  it('returns brain for memory_search', () => {
    expect(toolIcon('memory_search')).toBe('\uD83E\uDDE0');
  });

  it('returns gear for unknown tools', () => {
    expect(toolIcon('some_custom_tool')).toBe('\u2699\uFE0F');
  });

  it('returns gear for undefined', () => {
    expect(toolIcon(undefined)).toBe('\u2699\uFE0F');
  });

  it('is case-insensitive', () => {
    expect(toolIcon('EXEC')).toBe('\uD83D\uDD27');
    expect(toolIcon('Web_Search')).toBe('\uD83C\uDF10');
  });
});

// ---------------------------------------------------------------------------
// isToolBadgeFresh
// ---------------------------------------------------------------------------

describe('isToolBadgeFresh', () => {
  it('returns true for recent tool event', () => {
    expect(isToolBadgeFresh(Date.now() - 1000)).toBe(true);
  });

  it('returns false for old tool event', () => {
    expect(isToolBadgeFresh(Date.now() - TOOL_BADGE_TTL_MS - 1000)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isToolBadgeFresh(undefined)).toBe(false);
  });

  it('returns false for zero', () => {
    expect(isToolBadgeFresh(0)).toBe(false);
  });

  it('returns true at exactly TTL boundary', () => {
    expect(isToolBadgeFresh(Date.now() - TOOL_BADGE_TTL_MS + 100)).toBe(true);
  });
});
