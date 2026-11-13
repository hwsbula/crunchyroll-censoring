import type { Media } from '../core/scheduler.ts';

export type MediaSessionControls = Pick<MediaSession, 'setActionHandler'>;

// Capture the site's own standard Media Session seek action at document_start.
// Crunchyroll's source-inspected BrowserMediaSessionHandler routes 'seekto' to
// its player handle, unlike a raw currentTime write which bypasses SDK state.
export class PlayerSeekRouter {
  private session: MediaSessionControls | null;
  private getMedia: () => Media | null;
  private handler: MediaSessionActionHandler | null = null;
  private owner: Media | null = null;
  private managed = false;
  private restore: (() => void) | null = null;
  constructor(session: MediaSessionControls | null, getMedia: () => Media | null) {
    this.session = session;
    this.getMedia = getMedia;
    if (!session || typeof session.setActionHandler !== 'function') return;
    const original = session.setActionHandler;
    const previous = Object.getOwnPropertyDescriptor(session, 'setActionHandler');
    const remember = (handler: MediaSessionActionHandler | null): void => {
      this.managed = true;
      this.handler = handler;
      this.owner = handler ? getMedia() : null;
    };
    const wrapper: MediaSessionControls['setActionHandler'] = function (
      this: MediaSessionControls,
      action,
      handler,
    ) {
      // Preserve native registration, validation, return value and receiver.
      const result = Reflect.apply(original, this, [action, handler]);
      if (this === session && action === 'seekto') {
        remember(handler);
      }
      return result;
    };
    try {
      Object.defineProperty(session, 'setActionHandler', {
        configurable: true,
        writable: true,
        value: wrapper,
      });
      this.restore = () => {
        if (session.setActionHandler !== wrapper) return;
        if (previous) Object.defineProperty(session, 'setActionHandler', previous);
        else Reflect.deleteProperty(session, 'setActionHandler');
      };
    } catch {
      /* A non-interceptable API leaves only native-media seeking available. */
    }
  }
  seek(media: Media, seconds: number): unknown {
    if (this.getMedia() !== media) throw new Error('This is no longer the active player.');
    if (!this.managed) {
      media.currentTime = seconds;
      return;
    }
    // Do not bypass an SDK rejection, an explicitly disabled seek action, or a
    // handler that belongs to another video by retrying with native currentTime.
    if (!this.handler || !this.session) throw new Error('The player currently disables seeking.');
    this.owner ??= media;
    if (this.owner !== media) throw new Error('The player seek handler belongs to another video.');
    return Reflect.apply(this.handler, this.session, [
      { action: 'seekto', seekTime: seconds, fastSeek: false },
    ]);
  }
  dispose(): void {
    this.restore?.();
    this.restore = null;
    this.handler = null;
    this.owner = null;
  }
}
