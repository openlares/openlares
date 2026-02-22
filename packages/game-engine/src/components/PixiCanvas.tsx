'use client';

import { useEffect, useRef } from 'react';
import { Application, Graphics, Text } from 'pixi.js';

import type { SessionSummary } from '../canvas-utils';
import {
  getDisplayName,
  getFullName,
  getSessionColor,
  getRecencyOpacity,
  isWithinActiveWindow,
  generateAvatarPositions,
} from '../canvas-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Internal representation of one rendered avatar. */
interface SessionAvatar {
  sessionKey: string;
  graphic: Graphics;
  text: Text;
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
  onSessionClick: (sessionKey: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * PixiCanvas \u2014 renders a PixiJS scene with clickable session avatars.
 *
 * Avatars fade over inactivity and disappear after 1 hour.
 * Labels are placed above circles for readability.
 * Truncated names show a tooltip on hover.
 */
export function PixiCanvas({ sessions, activeSessionKey, onSessionClick }: PixiCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const avatarsRef = useRef<SessionAvatar[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    const tooltip = tooltipRef.current;
    if (!container || !tooltip) return;

    let destroyed = false;
    const app = new Application();

    function showTooltip(text: string, x: number, y: number) {
      if (!tooltip) return;
      tooltip.textContent = text;
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
      tooltip.style.opacity = '1';
      tooltip.style.pointerEvents = 'none';
    }

    function hideTooltip() {
      if (!tooltip) return;
      tooltip.style.opacity = '0';
    }

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

      function renderAvatars() {
        // Tear down previous avatars
        avatarsRef.current.forEach((av) => app.stage.removeChild(av.container));
        avatarsRef.current = [];
        hideTooltip();

        // Keep only sessions inside the active window (+ always the selected one)
        const visible = sessions.filter(
          (s) => s.sessionKey === activeSessionKey || isWithinActiveWindow(s),
        );

        if (visible.length === 0) return;

        const positions = generateAvatarPositions(
          visible.length,
          app.screen.width,
          app.screen.height,
        );

        visible.forEach((session, index) => {
          const pos = positions[index];
          if (!pos) return;

          const isSelected = session.sessionKey === activeSessionKey;
          const opacity = getRecencyOpacity(session, isSelected);
          const color = getSessionColor(session.sessionKey);
          const radius = 35;

          const displayName = getDisplayName(session);
          const fullName = getFullName(session);
          const isTruncated = displayName !== fullName;

          // Root container
          const avatarContainer = new Graphics();
          avatarContainer.x = pos.x;
          avatarContainer.y = pos.y;

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

          // Green glow for very recent sessions (< 5 min)
          if (!isSelected && opacity >= 1.0) {
            const glow = new Graphics();
            glow.circle(0, 0, radius + 8);
            glow.fill({ color: 0x10b981, alpha: 0.25 });
            avatarContainer.addChild(glow);
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
          // Centre horizontally, place above circle
          text.x = -text.width / 2;
          text.y = -(radius + text.height + 6);
          avatarContainer.addChild(text);

          // ---- Interaction ----
          avatarContainer.eventMode = 'static';
          avatarContainer.cursor = 'pointer';

          avatarContainer.on('pointerdown', () => {
            onSessionClick(session.sessionKey);
          });
          avatarContainer.on('pointerenter', () => {
            const av = avatarsRef.current.find((a) => a.sessionKey === session.sessionKey);
            if (av) av.targetScale = 1.15;
          });
          avatarContainer.on('pointerleave', () => {
            const av = avatarsRef.current.find((a) => a.sessionKey === session.sessionKey);
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

          avatarsRef.current.push({
            sessionKey: session.sessionKey,
            graphic: circle,
            text,
            container: avatarContainer,
            fullName,
            isTruncated,
            x: pos.x,
            y: pos.y,
            radius,
            color,
            isSelected,
            opacity,
            phase: Math.random() * Math.PI * 2,
            driftAngle: Math.random() * Math.PI * 2,
            driftSpeed: 0.2 + Math.random() * 0.3,
            driftRadius: 3 + Math.random() * 5,
            anchorX: pos.x,
            anchorY: pos.y,
            targetScale: 1.0,
            currentScale: 1.0,
          });
        });
      }

      renderAvatars();
      app.renderer.on('resize', renderAvatars);

      // ----- Animation loop -----
      app.ticker.add((ticker) => {
        const time = app.ticker.lastTime / 1000;
        const dt = ticker.deltaTime / 60;

        for (const avatar of avatarsRef.current) {
          // Breathing
          const breathAmp = avatar.isSelected ? 0.06 : 0.025;
          const breathSpeed = avatar.isSelected ? 2.5 : 1.2;
          const breath = Math.sin(time * breathSpeed + avatar.phase) * breathAmp;

          // Smooth hover
          avatar.currentScale +=
            (avatar.targetScale - avatar.currentScale) * 0.12 * ((dt * 60) / 60);

          avatar.container.scale.set(avatar.currentScale + breath);

          // Floating drift
          avatar.driftAngle += avatar.driftSpeed * dt * 0.02;
          avatar.container.x = avatar.anchorX + Math.cos(avatar.driftAngle) * avatar.driftRadius;
          avatar.container.y =
            avatar.anchorY + Math.sin(avatar.driftAngle * 0.7 + avatar.phase) * avatar.driftRadius;

          // Active: pulsing glow
          if (avatar.isSelected) {
            avatar.graphic.alpha = 0.6 + Math.sin(time * 3 + avatar.phase) * 0.3;
          }
        }
      });
    }

    setup().catch(console.error);

    return () => {
      destroyed = true;
      hideTooltip();
      try {
        app.destroy(true, { children: true });
      } catch {
        // Ignore
      }
    };
  }, [sessions, activeSessionKey, onSessionClick]);

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
