import gsap from 'gsap';
import type { Container } from 'pixi.js';

/** Task completed — squash+stretch bounce + brief green tint effect */
export function playTaskComplete(target: Container): gsap.core.Timeline {
  const tl = gsap.timeline();
  tl.to(target.scale, { x: 1.2, y: 0.85, duration: 0.1, ease: 'power2.in' })
    .to(target.scale, { x: 0.9, y: 1.15, duration: 0.15, ease: 'power2.out' })
    .to(target.scale, { x: 1, y: 1, duration: 0.35, ease: 'elastic.out(1, 0.5)' });
  // Flash effect: briefly reduce alpha and restore
  tl.to(target, { alpha: 0.7, duration: 0.05 }, 0).to(target, { alpha: 1, duration: 0.2 }, 0.05);
  return tl;
}

/** Task error — horizontal shake + red flash via alpha pulse */
export function playTaskError(target: Container): gsap.core.Timeline {
  const tl = gsap.timeline();
  const originalX = target.x;
  tl.to(target, { x: originalX + 4, duration: 0.04, ease: 'none' })
    .to(target, { x: originalX - 4, duration: 0.04, ease: 'none' })
    .to(target, { x: originalX + 3, duration: 0.04, ease: 'none' })
    .to(target, { x: originalX - 3, duration: 0.04, ease: 'none' })
    .to(target, { x: originalX + 2, duration: 0.04, ease: 'none' })
    .to(target, { x: originalX, duration: 0.04, ease: 'none' });
  tl.to(target, { alpha: 0.5, duration: 0.08 }, 0).to(target, { alpha: 1, duration: 0.15 }, 0.08);
  return tl;
}

/** Chat message received — quick pop scale */
export function playChatMessage(target: Container): gsap.core.Tween {
  return gsap.to(target.scale, {
    x: 1.12,
    y: 1.12,
    duration: 0.15,
    yoyo: true,
    repeat: 1,
    ease: 'power2.out',
  });
}

/** Idle float/breathe — continuous gentle loop. Returns tween to kill later. */
export function startIdleBreath(target: Container): gsap.core.Tween {
  return gsap.to(target.scale, {
    x: 1.03,
    y: 1.03,
    duration: 1.5,
    yoyo: true,
    repeat: -1,
    ease: 'sine.inOut',
  });
}
