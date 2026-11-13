import type { Media } from './scheduler.ts';

export type SeekRoute = (media: Media, seconds: number) => unknown;

// The host player owns playback intent. Never play/pause/load the media here or
// synthesize seek events: an SDK must complete its own seek state transition.
export class MediaSeeker {
  private media: Media;
  private route: SeekRoute;
  private pending: ((error: Error) => void) | null = null;
  constructor(
    media: Media,
    route: SeekRoute = (media, seconds) => {
      media.currentTime = seconds;
    },
  ) {
    this.media = media;
    this.route = route;
  }
  cancel(): void {
    this.pending?.(
      new Error('The episode, player, or timestamp request changed. Retry on the current episode.'),
    );
  }
  seek(seconds: number): Promise<void> {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid timestamp.');
    this.cancel();
    const media = this.media;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearInterval(poll);
        for (const event of ['seeked', 'timeupdate', 'canplay'])
          media.removeEventListener(event, check);
        for (const event of ['emptied', 'loadstart', 'abort', 'error'])
          media.removeEventListener(event, invalidated);
        this.pending = null;
        if (error) reject(error);
        else resolve();
      };
      const check = (): void => {
        if (!media.seeking && Math.abs(media.currentTime - seconds) <= 0.25) finish();
      };
      const invalidated = (): void =>
        finish(new Error('The media changed during the seek. Retry on the current episode.'));
      const timeout = setTimeout(
        () =>
          finish(
            new Error(
              'The player did not complete the timestamp seek. Use its timeline, then retry.',
            ),
          ),
        3500,
      );
      const poll = setInterval(check, 25);
      this.pending = finish;
      for (const event of ['seeked', 'timeupdate', 'canplay']) media.addEventListener(event, check);
      for (const event of ['emptied', 'loadstart', 'abort', 'error'])
        media.addEventListener(event, invalidated);
      try {
        void Promise.resolve(this.route(media, seconds)).then(check, () =>
          finish(
            new Error('The player rejected this timestamp seek. Use its timeline, then retry.'),
          ),
        );
      } catch {
        finish(new Error('The player rejected this timestamp seek. Use its timeline, then retry.'));
      }
    });
  }
}
