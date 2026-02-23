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
  activityRing: Graphics;
  badge: Text;
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

      // ---- Activity ring (always present; visibility driven by ticker) ----
      const activityRing = new Graphics();
      activityRing.circle(0, 0, radius + 10);
      activityRing.stroke({ color: 0x22d3ee, width: 2, alpha: 0.8 });
      activityRing.alpha = 0; // ticker will set this
      avatarContainer.addChild(activityRing);

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
      badge.alpha = 0; // ticker will set this
      avatarContainer.addChild(badge);

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
        activityRing,
        badge,
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
          // Smooth hover (no breathing)
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
            const pulse = 0.5 + Math.sin(time * 6) * 0.5;
            avatar.activityRing.alpha = pulse;
            const ringScale = 1.0 + Math.sin(time * 3) * 0.05;
            avatar.activityRing.scale.set(ringScale);
          } else {
            avatar.activityRing.alpha = 0;
          }

          // Tool badge hidden (cyan ring only for now)
          avatar.badge.alpha = 0;
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
