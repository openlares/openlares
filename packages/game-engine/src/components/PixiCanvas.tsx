'use client';

import { useEffect, useRef } from 'react';
import { Application, Graphics } from 'pixi.js';

/** A single floating shape in the scene */
interface FloatingShape {
  graphic: Graphics;
  x: number;
  y: number;
  speedX: number;
  speedY: number;
  radius: number;
  alpha: number;
}

/**
 * PixiCanvas — renders a PixiJS scene into a container div.
 *
 * Shows a dark background with gentle floating circles
 * that drift around the canvas. Resizes with its container.
 */
export function PixiCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);

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

      // Create floating shapes
      const shapes: FloatingShape[] = [];
      const colors = [0xf59e0b, 0x3b82f6, 0x8b5cf6, 0x10b981, 0xef4444];

      for (let i = 0; i < 15; i++) {
        const graphic = new Graphics();
        const radius = 4 + Math.random() * 12;
        const color = colors[i % colors.length]!;
        const alpha = 0.15 + Math.random() * 0.25;

        graphic.circle(0, 0, radius);
        graphic.fill({ color, alpha });

        const shape: FloatingShape = {
          graphic,
          x: Math.random() * app.screen.width,
          y: Math.random() * app.screen.height,
          speedX: (Math.random() - 0.5) * 0.6,
          speedY: (Math.random() - 0.5) * 0.6,
          radius,
          alpha,
        };

        graphic.x = shape.x;
        graphic.y = shape.y;
        app.stage.addChild(graphic);
        shapes.push(shape);
      }

      // Animation loop
      app.ticker.add(() => {
        const w = app.screen.width;
        const h = app.screen.height;

        for (const shape of shapes) {
          shape.x += shape.speedX;
          shape.y += shape.speedY;

          // Wrap around edges
          if (shape.x < -shape.radius) shape.x = w + shape.radius;
          if (shape.x > w + shape.radius) shape.x = -shape.radius;
          if (shape.y < -shape.radius) shape.y = h + shape.radius;
          if (shape.y > h + shape.radius) shape.y = -shape.radius;

          shape.graphic.x = shape.x;
          shape.graphic.y = shape.y;
        }
      });
    }

    setup().catch(console.error);

    return () => {
      destroyed = true;
      // Race condition: React strict mode unmounts before init() finishes.
      // The `destroyed` flag tells setup() to clean up after init resolves.
      // Wrapping destroy in try/catch handles the case where init partially
      // completed (stage exists but resize handlers aren't wired yet).
      try {
        app.destroy(true, { children: true });
      } catch {
        // Ignore — app wasn't fully initialized
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ position: 'relative', overflow: 'hidden' }}
    />
  );
}
