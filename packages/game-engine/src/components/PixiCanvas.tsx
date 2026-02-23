'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Application, Graphics, Text } from 'pixi.js';

import type { SessionSummary, SessionActivityState } from '../canvas-utils';
import {
  getDisplayName,
  getFullName,
  getSessionColor,
  getRecencyOpacity,
  isWithinActiveWindow,
  shouldShowActivity,
  toolIcon,
  isToolBadgeFresh,
  generateAvatarPositions,
  hashCode,
  seededRandom,
} from '../canvas-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Internal representation of one rendered avatar. */
interface SessionAvatar {
  sessionKey: string;
  graphic: Graphics;
  text: Text;
  /** Traveling arc border animation (n8n-style). */
  arcTrail: Graphics;
  badge: Text;
  /** Progress indicator demos (for comparison, pick one later). */
  progressDots: Text;
  progressSpinner: Text;
  progressBraille: Text;
  progressBlocks: Text;
  glow: Graphics;
  container: Graphics;
  fullName: string;
  isTruncated: boolean;
  x: number;
  y: number;
  radius: number;
  color: number;
  isSelected: boolean;
  opacity: number;
  /** Animation state */
  phase: number;
  driftAngle: number;
  driftSpeed: number;
  driftRadius: number;
  anchorX: number;
  anchorY: number;
  targetScale: number;
  currentScale: number;
}

interface PixiCanvasProps {
  sessions: SessionSummary[];
  activeSessionKey: string | null;
  /** Live per-session activity state (rings & badges driven from this). */
  sessionActivities: Record<string, SessionActivityState>;
  onSessionClick: (sessionKey: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * PixiCanvas \u2014 renders a PixiJS scene with clickable session avatars.
 *
 * Architecture:
 *  - The PixiJS Application is created ONCE on mount.
 *  - Avatars are rebuilt when `sessions` or `activeSessionKey` change.
 *  - Activity rings/badges are driven in the animation ticker by reading
 *    `sessionActivities` from a ref (no rebuild needed for activity updates).
 *  - Positions use seeded random for stability across rebuilds.
 */
export function PixiCanvas({
  sessions,
  activeSessionKey,
  sessionActivities,
  onSessionClick,
}: PixiCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const avatarsRef = useRef<Map<string, SessionAvatar>>(new Map());

  // Refs for data the ticker/handlers read without triggering effects
  const activitiesRef = useRef(sessionActivities);
  activitiesRef.current = sessionActivities;

  const onClickRef = useRef(onSessionClick);
  onClickRef.current = onSessionClick;

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const activeKeyRef = useRef(activeSessionKey);
  activeKeyRef.current = activeSessionKey;

  // ---- Tooltip helpers (stable) ----

  const showTooltip = useCallback((text: string, x: number, y: number) => {
    const tip = tooltipRef.current;
    if (!tip) return;
    tip.textContent = text;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.style.opacity = '1';
    tip.style.pointerEvents = 'none';
  }, []);

  const hideTooltip = useCallback(() => {
    const tip = tooltipRef.current;
    if (!tip) return;
    tip.style.opacity = '0';
  }, []);

  // ---- Sync avatars: (re)build scene from current data ----

  const syncAvatars = useCallback(() => {
    const app = appRef.current;
    if (!app) return;

    // Preserve animation state from previous avatars for continuity
    const prevAvatars = new Map(avatarsRef.current);

    // Tear down previous avatars
    for (const av of avatarsRef.current.values()) {
      app.stage.removeChild(av.container);
    }
    avatarsRef.current.clear();
    hideTooltip();

    const currentSessions = sessionsRef.current;
    const activeKey = activeKeyRef.current;

    // Keep only sessions inside the active window (+ always the selected one)
    const visible = currentSessions.filter(
      (s) => s.sessionKey === activeKey || isWithinActiveWindow(s),
    );

    if (visible.length === 0) return;

    const positions = generateAvatarPositions(visible.length, app.screen.width, app.screen.height);

    visible.forEach((session, index) => {
      const pos = positions[index];
      if (!pos) return;

      const isSelected = session.sessionKey === activeKey;
      const opacity = getRecencyOpacity(session, isSelected);
      const color = getSessionColor(session.sessionKey);
      const radius = 35;
      const h = hashCode(session.sessionKey);

      const displayName = getDisplayName(session);
      const fullName = getFullName(session);
      const isTruncated = displayName !== fullName;

      // Carry over animation state from the previous incarnation
      const prev = prevAvatars.get(session.sessionKey);

      // Root container
      const avatarContainer = new Graphics();
      avatarContainer.x = pos.x;
      avatarContainer.y = pos.y;

      // ---- Green glow (for very recent, < 5 min) ----
      const glow = new Graphics();
      glow.circle(0, 0, radius + 8);
      glow.fill({ color: 0x10b981, alpha: 0.25 });
      glow.alpha = !isSelected && opacity >= 1.0 ? 1 : 0;
      avatarContainer.addChild(glow);

      // ---- Traveling arc trail (n8n-style, redrawn each frame by ticker) ----
      const arcTrail = new Graphics();
      arcTrail.alpha = 0; // ticker will control
      avatarContainer.addChild(arcTrail);

      // ---- Circle ----
      const circle = new Graphics();
      if (isSelected) {
        // Amber selection ring
        circle.circle(0, 0, radius + 4);
        circle.fill({ color: 0xf59e0b, alpha: 0.8 });
        circle.circle(0, 0, radius);
        circle.fill({ color });
      } else {
        circle.circle(0, 0, radius);
        circle.fill({ color, alpha: opacity });
      }
      avatarContainer.addChild(circle);

      // ---- Label (above the circle) ----
      const text = new Text({
        text: displayName,
        style: {
          fontSize: 11,
          fill: 0xffffff,
          fontFamily: 'Arial, sans-serif',
          align: 'center',
          wordWrap: true,
          wordWrapWidth: 110,
        },
      });
      text.alpha = Math.max(0.5, opacity);
      text.x = -text.width / 2;
      text.y = -(radius + text.height + 6);
      avatarContainer.addChild(text);

      // ---- Tool badge (always present; visibility driven by ticker) ----
      const badge = new Text({
        text: '\u2699\uFE0F',
        style: { fontSize: 18, align: 'center' },
      });
      badge.x = -badge.width / 2;
      badge.y = radius + 6;
      badge.alpha = 0;
      avatarContainer.addChild(badge);

      // ---- Progress indicator demos (shown side by side for comparison) ----
      const progStyle = { fontSize: 11, fill: 0xffffff, fontFamily: 'monospace' };
      const progressDots = new Text({ text: '', style: progStyle });
      progressDots.x = -50;
      progressDots.y = radius + 28;
      progressDots.alpha = 0;
      avatarContainer.addChild(progressDots);

      const progressSpinner = new Text({ text: '', style: progStyle });
      progressSpinner.x = -20;
      progressSpinner.y = radius + 28;
      progressSpinner.alpha = 0;
      avatarContainer.addChild(progressSpinner);

      const progressBraille = new Text({ text: '', style: progStyle });
      progressBraille.x = 5;
      progressBraille.y = radius + 28;
      progressBraille.alpha = 0;
      avatarContainer.addChild(progressBraille);

      const progressBlocks = new Text({ text: '', style: progStyle });
      progressBlocks.x = 25;
      progressBlocks.y = radius + 28;
      progressBlocks.alpha = 0;
      avatarContainer.addChild(progressBlocks);

      // ---- Interaction ----
      avatarContainer.eventMode = 'static';
      avatarContainer.cursor = 'pointer';

      avatarContainer.on('pointerdown', () => {
        onClickRef.current(session.sessionKey);
      });
      avatarContainer.on('pointerenter', () => {
        const av = avatarsRef.current.get(session.sessionKey);
        if (av) av.targetScale = 1.15;
      });
      avatarContainer.on('pointerleave', () => {
        const av = avatarsRef.current.get(session.sessionKey);
        if (av) av.targetScale = 1.0;
      });

      // Tooltip only on the label text (not the circle)
      if (isTruncated) {
        text.eventMode = 'static';
        text.cursor = 'default';
        text.on('pointerenter', (e) => {
          showTooltip(fullName, e.global.x + 12, e.global.y - 8);
        });
        text.on('pointermove', (e) => {
          showTooltip(fullName, e.global.x + 12, e.global.y - 8);
        });
        text.on('pointerleave', () => {
          hideTooltip();
        });
      }

      app.stage.addChild(avatarContainer);

      avatarsRef.current.set(session.sessionKey, {
        sessionKey: session.sessionKey,
        graphic: circle,
        text,
        arcTrail,
        badge,
        progressDots,
        progressSpinner,
        progressBraille,
        progressBlocks,
        glow,
        container: avatarContainer,
        fullName,
        isTruncated,
        x: pos.x,
        y: pos.y,
        radius,
        color,
        isSelected,
        opacity,
        // Deterministic animation offsets from session key hash
        phase: seededRandom(h + 2) * Math.PI * 2,
        driftSpeed: 0.2 + seededRandom(h + 4) * 0.3,
        driftRadius: 3 + seededRandom(h + 5) * 5,
        anchorX: pos.x,
        anchorY: pos.y,
        // Carry over live animation state from previous incarnation
        driftAngle: prev ? prev.driftAngle : seededRandom(h + 3) * Math.PI * 2,
        currentScale: prev ? prev.currentScale : 1.0,
        targetScale: prev ? prev.targetScale : 1.0,
      });
    });
  }, [hideTooltip, showTooltip]);

  // ---- Init PixiJS app ONCE on mount ----

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let destroyed = false;
    const app = new Application();

    async function setup() {
      await app.init({
        background: '#0a0a1a',
        resizeTo: container!,
        antialias: true,
      });

      if (destroyed) {
        app.destroy(true);
        return;
      }

      container!.appendChild(app.canvas as HTMLCanvasElement);
      app.stage.eventMode = 'static';
      appRef.current = app;

      // Initial sync
      syncAvatars();

      // Re-sync on resize
      app.renderer.on('resize', syncAvatars);

      // ----- Animation loop -----
      app.ticker.add((ticker) => {
        const time = app.ticker.lastTime / 1000;
        const dt = ticker.deltaTime / 60;
        const activities = activitiesRef.current;

        for (const avatar of avatarsRef.current.values()) {
          // Smooth hover (no breathing/size pulsation)
          avatar.currentScale +=
            (avatar.targetScale - avatar.currentScale) * 0.12 * ((dt * 60) / 60);

          avatar.container.scale.set(avatar.currentScale);

          // Floating drift
          avatar.driftAngle += avatar.driftSpeed * dt * 0.02;
          avatar.container.x = avatar.anchorX + Math.cos(avatar.driftAngle) * avatar.driftRadius;
          avatar.container.y =
            avatar.anchorY + Math.sin(avatar.driftAngle * 0.7 + avatar.phase) * avatar.driftRadius;

          // Active: pulsing glow
          if (avatar.isSelected) {
            avatar.graphic.alpha = 0.6 + Math.sin(time * 3 + avatar.phase) * 0.3;
          }

          // ---- Activity ring (driven by live activities ref) ----
          const activity = activities[avatar.sessionKey];
          const isRunning = !!(activity && shouldShowActivity(activity));

          if (isRunning) {
            // ---- Arc trail with STATIC erase point & ease-out ----
            // Head starts at a fixed anchor, sweeps full speed, then
            // decelerates (ease-out) as it approaches the anchor again.
            // Trail is bright at head, naturally fades to invisible at
            // the anchor — no artificial fade needed.
            avatar.arcTrail.alpha = 1;
            avatar.arcTrail.clear();

            const arcRadius = avatar.radius + 6;
            const segments = 24;
            const cycleDuration = 2.5; // seconds per full revolution

            // Fixed anchor / erase point (unique per session)
            const anchorAngle = avatar.phase;

            // Cycle progress 0 → 1 (offset by phase so sessions desync)
            const cycleProgress = ((time + avatar.phase) / cycleDuration) % 1;

            // Ease-out: fast start, decelerates toward the anchor
            const eased = 1 - Math.pow(1 - cycleProgress, 2.5);

            const headAngle = anchorAngle + eased * Math.PI * 2;
            const arcLength = eased * Math.PI * 2;

            if (arcLength > 0.05) {
              for (let i = 0; i < segments; i++) {
                const t = i / segments; // 0 = head (bright), 1 = anchor (dim)
                const segStart = headAngle - t * arcLength;
                const segEnd = headAngle - ((i + 1) / segments) * arcLength;
                const segAlpha = 1.0 - t * t; // quadratic: bright→invisible
                const segWidth = 3.5 - t * 2.0;

                avatar.arcTrail.arc(0, 0, arcRadius, segEnd, segStart);
                avatar.arcTrail.stroke({
                  color: 0xef4444,
                  width: Math.max(1, segWidth),
                  alpha: segAlpha * 0.9,
                });
              }
            }
          } else {
            avatar.arcTrail.alpha = 0;
          }

          // ---- Tool badge (no bobbing) ----
          const hasTool = !!(activity?.toolName && isToolBadgeFresh(activity.toolTs));
          if (isRunning && hasTool) {
            const icon = toolIcon(activity!.toolName);
            if (avatar.badge.text !== icon) avatar.badge.text = icon;
            avatar.badge.alpha = 1;
            avatar.badge.y = avatar.radius + 6;

            // ---- Progress indicator demos (compare side by side) ----
            const tick = Math.floor(time * 3); // 3 changes per second

            // Style 1: Dots ·  ··  ···
            const dotCount = (tick % 3) + 1;
            avatar.progressDots.text = '·'.repeat(dotCount);
            avatar.progressDots.alpha = 1;

            // Style 2: Spinning quarter ◐ ◓ ◑ ◒
            const spinChars = '\u25D0\u25D3\u25D1\u25D2';
            avatar.progressSpinner.text = spinChars[tick % 4]!;
            avatar.progressSpinner.alpha = 1;

            // Style 3: Braille spinner
            const braille = '\u280B\u2819\u2839\u2838\u283C\u2834\u2826\u2827\u2807\u280F';
            avatar.progressBraille.text = braille[tick % braille.length]!;
            avatar.progressBraille.alpha = 1;

            // Style 4: Block bar ▰▰▱ cycling
            const blocks = tick % 4;
            avatar.progressBlocks.text = '\u25B0'.repeat(blocks) + '\u25B1'.repeat(3 - blocks);
            avatar.progressBlocks.alpha = 1;
          } else {
            avatar.badge.alpha = 0;
            avatar.progressDots.alpha = 0;
            avatar.progressSpinner.alpha = 0;
            avatar.progressBraille.alpha = 0;
            avatar.progressBlocks.alpha = 0;
          }
        }
      });
    }

    setup().catch(console.error);

    return () => {
      destroyed = true;
      appRef.current = null;
      hideTooltip();
      try {
        app.destroy(true, { children: true });
      } catch {
        // Ignore
      }
    };
  }, [syncAvatars, hideTooltip]); // syncAvatars + hideTooltip are stable (useCallback with [] deps)

  // ---- Re-sync avatars when session data or selection changes ----

  useEffect(() => {
    syncAvatars();
  }, [sessions, activeSessionKey, syncAvatars]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      <div
        ref={tooltipRef}
        style={{
          position: 'absolute',
          opacity: 0,
          transition: 'opacity 0.15s',
          background: 'rgba(0, 0, 0, 0.85)',
          color: '#fff',
          fontSize: '12px',
          padding: '4px 8px',
          borderRadius: '4px',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 10,
        }}
      />
    </div>
  );
}
