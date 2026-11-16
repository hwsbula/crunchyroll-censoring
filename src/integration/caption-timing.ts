import type { Cue } from '../core/types.ts';
import type { Media } from '../core/scheduler.ts';

// Negative evidence only: this never infers an offset, manufactures timestamps,
// or arms audio. Ignore normal redraw boundaries and paused/seeking/buffered
// captions. A continuously advancing, clearly out-of-interval unique cue can
// establish that the source clock is unsafe, not what its replacement should be.
export class CaptionTimingGuard {
  private pending: {
    cue: string;
    wall: number;
    time: number;
    lastWall: number;
    lastTime: number;
    rate: number;
  } | null = null;
  reset(): void {
    this.pending = null;
  }
  observe(cue: Cue | null, media: Media, now: number, offset = 0): boolean {
    const time = media.currentTime - offset;
    if (
      !cue ||
      media.paused ||
      media.seeking ||
      media.ended ||
      media.readyState < 3 ||
      !Number.isFinite(time) ||
      media.playbackRate <= 0 ||
      (time >= cue.start - 0.35 && time <= cue.end + 0.35)
    ) {
      this.pending = null;
      return false;
    }
    const before = this.pending;
    const advance = before ? time - before.lastTime : 0;
    const elapsed = before ? (now - before.lastWall) / 1000 : 0;
    if (
      !before ||
      before.cue !== cue.key ||
      before.rate !== media.playbackRate ||
      elapsed < 0 ||
      elapsed > 1 ||
      advance < 0 ||
      advance > elapsed * media.playbackRate + 0.35
    ) {
      this.pending = {
        cue: cue.key,
        wall: now,
        time,
        lastWall: now,
        lastTime: time,
        rate: media.playbackRate,
      };
      return false;
    }
    before.lastWall = now;
    before.lastTime = time;
    return now - before.wall >= 500 && time - before.time >= 0.25 * media.playbackRate;
  }
}
