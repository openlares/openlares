import gsap from 'gsap';
import type { Container } from 'pixi.js';
import { playTaskComplete, playTaskError, playChatMessage, startIdleBreath } from './reactions';

export type ReactionType = 'taskComplete' | 'taskError' | 'chatMessage';

export class ReactionManager {
  private idleTweens = new Map<Container, gsap.core.Tween>();

  /** Play a one-shot reaction. Pauses idle, plays reaction, resumes idle. */
  playReaction(target: Container, reaction: ReactionType): void {
    // Pause idle if running
    const idle = this.idleTweens.get(target);
    if (idle) idle.pause();

    // Reset scale to 1 before playing reaction
    target.scale.set(1, 1);

    let anim: gsap.core.Tween | gsap.core.Timeline;
    switch (reaction) {
      case 'taskComplete':
        anim = playTaskComplete(target);
        break;
      case 'taskError':
        anim = playTaskError(target);
        break;
      case 'chatMessage':
        anim = playChatMessage(target);
        break;
    }

    // Resume idle after reaction completes
    anim.then(() => {
      if (idle && this.idleTweens.has(target)) {
        target.scale.set(1, 1);
        idle.restart();
      }
    });
  }

  /** Start continuous idle breathing on a target. */
  startIdle(target: Container): void {
    // Don't restart if already running
    if (this.idleTweens.has(target)) return;
    const tween = startIdleBreath(target);
    this.idleTweens.set(target, tween);
  }

  /** Stop idle breathing on a target. */
  stopIdle(target: Container): void {
    const existing = this.idleTweens.get(target);
    if (existing) {
      existing.kill();
      this.idleTweens.delete(target);
      target.scale.set(1, 1);
    }
  }

  /** Kill all tweens on a target (cleanup). */
  killAll(target: Container): void {
    this.stopIdle(target);
    gsap.killTweensOf(target);
    gsap.killTweensOf(target.scale);
  }

  /** Kill everything (unmount cleanup). */
  destroy(): void {
    for (const [target, tween] of this.idleTweens) {
      tween.kill();
      target.scale.set(1, 1);
    }
    this.idleTweens.clear();
  }
}
