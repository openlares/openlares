import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Container } from 'pixi.js';

// ---------------------------------------------------------------------------
// Mock GSAP — must be hoisted before any imports that use it
// ---------------------------------------------------------------------------

const mockTween = {
  kill: vi.fn(),
  pause: vi.fn(),
  restart: vi.fn(),
  then: vi.fn(),
};

const mockTimeline = {
  to: vi.fn(() => mockTimeline),
  kill: vi.fn(),
  pause: vi.fn(),
  restart: vi.fn(),
  then: vi.fn(),
};

vi.mock('gsap', () => ({
  default: {
    timeline: vi.fn(() => mockTimeline),
    to: vi.fn(() => mockTween),
    killTweensOf: vi.fn(),
  },
}));

import gsap from 'gsap';
import { ReactionManager } from '../reaction-manager';

// ---------------------------------------------------------------------------
// Mock Container factory
// ---------------------------------------------------------------------------

function makeContainer() {
  return {
    x: 0,
    y: 0,
    alpha: 1,
    scale: { x: 1, y: 1, set: vi.fn() },
  } as unknown as Container;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReactionManager', () => {
  let manager: ReactionManager;

  beforeEach(() => {
    manager = new ReactionManager();
    vi.clearAllMocks();
    // Default: then() immediately calls its callback (simulate instant completion)
    mockTween.then.mockImplementation((cb: () => void) => {
      cb();
      return mockTween;
    });
    mockTimeline.then.mockImplementation((cb: () => void) => {
      cb();
      return mockTimeline;
    });
  });

  // ---- playReaction ----

  it('playReaction(taskComplete) does not throw', () => {
    const c = makeContainer();
    expect(() => manager.playReaction(c, 'taskComplete')).not.toThrow();
  });

  it('playReaction(taskError) does not throw', () => {
    const c = makeContainer();
    expect(() => manager.playReaction(c, 'taskError')).not.toThrow();
  });

  it('playReaction(chatMessage) does not throw', () => {
    const c = makeContainer();
    expect(() => manager.playReaction(c, 'chatMessage')).not.toThrow();
  });

  it('playReaction resets scale to (1,1) before animating', () => {
    const c = makeContainer();
    manager.playReaction(c, 'taskComplete');
    expect(c.scale.set).toHaveBeenCalledWith(1, 1);
  });

  it('playReaction pauses existing idle tween', () => {
    const c = makeContainer();
    manager.startIdle(c);
    vi.clearAllMocks();
    mockTween.then.mockImplementation((cb: () => void) => {
      cb();
      return mockTween;
    });
    manager.playReaction(c, 'chatMessage');
    expect(mockTween.pause).toHaveBeenCalled();
  });

  it('playReaction restarts idle tween after completion', () => {
    const c = makeContainer();
    manager.startIdle(c);
    vi.clearAllMocks();
    mockTween.then.mockImplementation((cb: () => void) => {
      cb();
      return mockTween;
    });
    manager.playReaction(c, 'chatMessage');
    expect(mockTween.restart).toHaveBeenCalled();
  });

  // ---- startIdle ----

  it('startIdle creates a tween for the target', () => {
    const c = makeContainer();
    manager.startIdle(c);
    expect(vi.mocked(gsap.to)).toHaveBeenCalled();
  });

  it('startIdle does not create duplicate tween if already running', () => {
    const c = makeContainer();
    manager.startIdle(c);
    const callsBefore = vi.mocked(gsap.to).mock.calls.length;
    manager.startIdle(c);
    expect(vi.mocked(gsap.to).mock.calls.length).toBe(callsBefore);
  });

  // ---- stopIdle ----

  it('stopIdle kills the tween and resets scale', () => {
    const c = makeContainer();
    manager.startIdle(c);
    vi.clearAllMocks();
    manager.stopIdle(c);
    expect(mockTween.kill).toHaveBeenCalled();
    expect(c.scale.set).toHaveBeenCalledWith(1, 1);
  });

  it('stopIdle is a no-op if no idle tween exists', () => {
    const c = makeContainer();
    expect(() => manager.stopIdle(c)).not.toThrow();
  });

  // ---- killAll ----

  it('killAll removes tweens for a specific target', () => {
    const c = makeContainer();
    manager.startIdle(c);
    vi.clearAllMocks();
    manager.killAll(c);
    expect(mockTween.kill).toHaveBeenCalled();
    expect(vi.mocked(gsap.killTweensOf)).toHaveBeenCalledWith(c);
    expect(vi.mocked(gsap.killTweensOf)).toHaveBeenCalledWith(c.scale);
  });

  // ---- destroy ----

  it('destroy kills all idle tweens', () => {
    const c1 = makeContainer();
    const c2 = makeContainer();
    manager.startIdle(c1);
    manager.startIdle(c2);
    vi.clearAllMocks();
    manager.destroy();
    expect(mockTween.kill).toHaveBeenCalledTimes(2);
  });

  it('destroy resets scale on all targets', () => {
    const c = makeContainer();
    manager.startIdle(c);
    vi.clearAllMocks();
    manager.destroy();
    expect(c.scale.set).toHaveBeenCalledWith(1, 1);
  });

  it('after destroy, stopIdle is a no-op (internal state cleared)', () => {
    const c = makeContainer();
    manager.startIdle(c);
    manager.destroy();
    vi.clearAllMocks();
    manager.stopIdle(c);
    expect(mockTween.kill).not.toHaveBeenCalled();
  });
});
