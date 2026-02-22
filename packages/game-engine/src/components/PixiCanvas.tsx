'use client';

import { useEffect, useRef } from 'react';
import { Application, Graphics, Text } from 'pixi.js';

// Local interface to avoid circular dependency
interface SessionSummary {
  sessionKey: string;
  title?: string;
  active: boolean;
  updatedAt: number;
}

/** A single session avatar on the canvas */
interface SessionAvatar {
  sessionKey: string;
  graphic: Graphics;
  text: Text;
  container: Graphics;
  x: number;
  y: number;
  radius: number;
  color: number;
  isActive: boolean;
  hasRecentActivity: boolean;
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

// Helper functions
function hashSessionKey(sessionKey: string): number {
  let hash = 0;
  for (let i = 0; i < sessionKey.length; i++) {
    const char = sessionKey.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

function getSessionColor(sessionKey: string): number {
  const colors = [0xf59e0b, 0x3b82f6, 0x8b5cf6, 0x10b981, 0xef4444, 0xf97316, 0x06b6d4, 0x84cc16];
  const hash = hashSessionKey(sessionKey);
  return colors[hash % colors.length]!;
}

function cleanSessionName(session: SessionSummary): string {
  const { sessionKey, title } = session;

  // Use title if available, otherwise clean the session key
  const displayName = title || sessionKey;

  // Clean discord sessions
  if (displayName.includes('discord:')) {
    // Extract channel name after #
    const channelMatch = displayName.match(/#([^#]+)$/);
    if (channelMatch) {
      return `#${channelMatch[1]}`;
    }

    // Handle special cases like "discord:g-agent-main-main"
    if (displayName.includes('g-agent-main-main')) {
      return 'Main';
    }
  }

  // Clean cron jobs
  if (displayName.startsWith('Cron: ')) {
    return displayName.substring(6);
  }

  // Add robot emoji for subagents
  if (sessionKey.includes('subagent')) {
    const cleaned = title || sessionKey;
    return `🤖 ${cleaned}`;
  }

  // Fallback to raw display name or session key
  return displayName;
}

function isRecentActivity(session: SessionSummary): boolean {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  return session.updatedAt > fiveMinutesAgo;
}

function generateAvatarPositions(
  count: number,
  width: number,
  height: number,
): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  const minSpacing = 120;
  const margin = 80;

  const cols = Math.floor((width - 2 * margin) / minSpacing);

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);

    const baseX = margin + col * minSpacing;
    const baseY = margin + row * minSpacing;

    // Add some randomness to avoid perfect grid
    const offsetX = (Math.random() - 0.5) * 40;
    const offsetY = (Math.random() - 0.5) * 40;

    positions.push({
      x: Math.max(margin, Math.min(width - margin, baseX + offsetX)),
      y: Math.max(margin, Math.min(height - margin, baseY + offsetY)),
    });
  }

  return positions;
}

/**
 * PixiCanvas — renders a PixiJS scene with clickable session avatars.
 *
 * Shows session avatars as colored circles with labels, arranged
 * in a scattered grid pattern. Avatars are clickable and show
 * different visual states based on activity.
 */
export function PixiCanvas({ sessions, activeSessionKey, onSessionClick }: PixiCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const avatarsRef = useRef<SessionAvatar[]>([]);

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

      // Enable interactivity on the stage
      app.stage.eventMode = 'static';

      // Render function to create/update avatars
      function renderAvatars() {
        // Clear existing avatars
        avatarsRef.current.forEach((avatar) => {
          app.stage.removeChild(avatar.container);
        });
        avatarsRef.current = [];

        if (sessions.length === 0) return;

        const positions = generateAvatarPositions(
          sessions.length,
          app.screen.width,
          app.screen.height,
        );

        sessions.forEach((session, index) => {
          const position = positions[index];
          if (!position) return;

          const isActive = session.sessionKey === activeSessionKey;
          const hasRecent = isRecentActivity(session);
          const color = getSessionColor(session.sessionKey);
          const radius = 35;

          // Container for the entire avatar (circle + text)
          const avatarContainer = new Graphics();
          avatarContainer.x = position.x;
          avatarContainer.y = position.y;

          // Main avatar circle
          const circle = new Graphics();

          // Active state: amber ring and slightly larger
          if (isActive) {
            circle.circle(0, 0, radius + 4);
            circle.fill({ color: 0xf59e0b, alpha: 0.8 });
            circle.circle(0, 0, radius);
            circle.fill({ color });
          } else {
            circle.circle(0, 0, radius);
            const alpha = session.active ? 1.0 : 0.6;
            circle.fill({ color, alpha });
          }

          // Recent activity: green glow
          if (hasRecent && !isActive) {
            const glow = new Graphics();
            glow.circle(0, 0, radius + 8);
            glow.fill({ color: 0x10b981, alpha: 0.3 });
            avatarContainer.addChild(glow);
          }

          avatarContainer.addChild(circle);

          // Label text below the circle
          const cleanName = cleanSessionName(session);
          const text = new Text({
            text: cleanName,
            style: {
              fontSize: 12,
              fill: 0xffffff,
              fontFamily: 'Arial',
              align: 'center',
              wordWrap: true,
              wordWrapWidth: radius * 3,
            },
          });

          // Center the text horizontally below the circle
          text.x = -text.width / 2;
          text.y = radius + 8;
          avatarContainer.addChild(text);

          // Make it interactive
          avatarContainer.eventMode = 'static';
          avatarContainer.cursor = 'pointer';

          // Click handler
          avatarContainer.on('pointerdown', () => {
            onSessionClick(session.sessionKey);
          });

          // Hover effects
          avatarContainer.on('pointerenter', () => {
            const av = avatarsRef.current.find((a) => a.sessionKey === session.sessionKey);
            if (av) av.targetScale = 1.15;
          });

          avatarContainer.on('pointerleave', () => {
            const av = avatarsRef.current.find((a) => a.sessionKey === session.sessionKey);
            if (av) av.targetScale = 1.0;
          });

          app.stage.addChild(avatarContainer);

          // Store reference
          const avatar: SessionAvatar = {
            sessionKey: session.sessionKey,
            graphic: circle,
            text,
            container: avatarContainer,
            x: position.x,
            y: position.y,
            radius,
            color,
            isActive,
            hasRecentActivity: hasRecent,
            // Animation state — each avatar gets unique timing
            phase: Math.random() * Math.PI * 2,
            driftAngle: Math.random() * Math.PI * 2,
            driftSpeed: 0.2 + Math.random() * 0.3,
            driftRadius: 3 + Math.random() * 5,
            anchorX: position.x,
            anchorY: position.y,
            targetScale: 1.0,
            currentScale: 1.0,
          };

          avatarsRef.current.push(avatar);
        });
      }

      // Initial render
      renderAvatars();

      // Re-render on resize
      app.renderer.on('resize', renderAvatars);

      // Animation loop — breathing, floating, smooth hover
      app.ticker.add((ticker) => {
        const time = app.ticker.lastTime / 1000; // seconds
        const dt = ticker.deltaTime / 60; // normalised delta

        for (const avatar of avatarsRef.current) {
          // Breathing: gentle scale oscillation
          const breathAmp = avatar.isActive ? 0.06 : 0.025;
          const breathSpeed = avatar.isActive ? 2.5 : 1.2;
          const breath = Math.sin(time * breathSpeed + avatar.phase) * breathAmp;

          // Smooth hover: lerp currentScale toward targetScale
          avatar.currentScale +=
            (avatar.targetScale - avatar.currentScale) * 0.12 * ((dt * 60) / 60);

          // Apply combined scale
          const finalScale = avatar.currentScale + breath;
          avatar.container.scale.set(finalScale);

          // Floating: slow circular drift around anchor
          avatar.driftAngle += avatar.driftSpeed * dt * 0.02;
          const driftX = Math.cos(avatar.driftAngle) * avatar.driftRadius;
          const driftY = Math.sin(avatar.driftAngle * 0.7 + avatar.phase) * avatar.driftRadius;
          avatar.container.x = avatar.anchorX + driftX;
          avatar.container.y = avatar.anchorY + driftY;

          // Active session: pulsing amber glow (alpha oscillation)
          if (avatar.isActive) {
            const glowAlpha = 0.6 + Math.sin(time * 3 + avatar.phase) * 0.3;
            avatar.graphic.alpha = glowAlpha;
          }
        }
      });
    }

    setup().catch(console.error);

    return () => {
      destroyed = true;
      try {
        app.destroy(true, { children: true });
      } catch {
        // Ignore — app wasn't fully initialized
      }
    };
  }, [sessions, activeSessionKey, onSessionClick]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ position: 'relative', overflow: 'hidden' }}
    />
  );
}
