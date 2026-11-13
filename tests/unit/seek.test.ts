import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaSeeker } from '../../src/core/seeker.ts';
import { PlayerSeekRouter } from '../../src/integration/seek.ts';
import type { Media } from '../../src/core/scheduler.ts';
class Video extends EventTarget implements Media {
  currentTime = 5;
  playbackRate = 1;
  paused = true;
  seeking = false;
  readyState = 4;
  ended = false;
  muted = true;
  volume = 0.37;
}
class Session {
  handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
  setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void {
    this.handlers.set(action, handler);
  }
}
void test('timestamp uses the player-registered seek action and preserves native registration and playback intent', async () => {
  const video = new Video();
  const session = new Session();
  const original = session.setActionHandler;
  const router = new PlayerSeekRouter(session, () => video);
  let calls = 0;
  const handler: MediaSessionActionHandler = (details) => {
    calls++;
    assert.equal(details.action, 'seekto');
    assert.equal(details.fastSeek, false);
    video.seeking = true;
    queueMicrotask(() => {
      video.currentTime = details.seekTime!;
      video.seeking = false;
      video.dispatchEvent(new Event('seeked'));
    });
  };
  session.setActionHandler('seekto', handler);
  assert.equal(session.handlers.get('seekto'), handler);
  const seeker = new MediaSeeker(video, (media, time) => router.seek(media, time));
  await seeker.seek(2);
  assert.equal(calls, 1);
  assert.equal(video.currentTime, 2);
  assert.equal(video.paused, true);
  assert.equal(video.muted, true);
  assert.equal(video.volume, 0.37);
  video.paused = false;
  await seeker.seek(1);
  assert.equal(video.paused, false);
  router.dispose();
  assert.equal(session.setActionHandler, original);
  assert.equal(session.handlers.get('seekto'), handler);
});
void test('native fallback completes a real position change without calling play/pause or altering user sound choices', async () => {
  const video = new Video();
  const router = new PlayerSeekRouter(null, () => video);
  const seeker = new MediaSeeker(video, (media, time) => router.seek(media, time));
  await seeker.seek(1);
  assert.equal(video.currentTime, 1);
  assert.equal(video.paused, true);
  assert.equal(video.muted, true);
});
void test('disabled/replaced SDK handlers and SDK errors never fall back to a raw seek', async () => {
  const video = new Video();
  let active: Media = video;
  const session = new Session();
  const router = new PlayerSeekRouter(session, () => active);
  session.setActionHandler('seekto', () => {
    throw new Error('SDK rejects the seek');
  });
  await assert.rejects(
    new MediaSeeker(video, (media, time) => router.seek(media, time)).seek(1),
    /rejected/,
  );
  assert.equal(video.currentTime, 5);
  session.setActionHandler('seekto', null);
  await assert.rejects(
    new MediaSeeker(video, (media, time) => router.seek(media, time)).seek(1),
    /rejected/,
  );
  assert.equal(video.currentTime, 5);
  session.setActionHandler('seekto', () => {
    video.currentTime = 1;
  });
  active = new Video();
  assert.throws(() => router.seek(active, 1));
  assert.equal(active.currentTime, 5);
  router.dispose();
});
void test('seeks wait for completion; superseded or invalidated requests clean up without delayed playback', async () => {
  const video = new Video();
  const seeker = new MediaSeeker(video, (_media, time) => {
    video.seeking = true;
    video.currentTime = time;
  });
  const first = seeker.seek(1);
  const rejected = assert.rejects(first, /changed/);
  const second = seeker.seek(2);
  await rejected;
  video.seeking = false;
  video.dispatchEvent(new Event('seeked'));
  await second;
  assert.equal(video.paused, true);
  const third = seeker.seek(3);
  const invalid = assert.rejects(third, /media changed/);
  video.dispatchEvent(new Event('loadstart'));
  await invalid;
  const fourth = seeker.seek(4);
  const cancelled = assert.rejects(fourth, /changed/);
  seeker.cancel();
  await cancelled;
  assert.equal(video.paused, true);
});
void test('a host that does not complete a seek returns an error rather than an early success or forced fallback', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const video = new Video();
  let calls = 0;
  const seeker = new MediaSeeker(video, () => {
    calls++;
  });
  const pending = seeker.seek(1);
  const rejected = assert.rejects(pending, /did not complete/);
  t.mock.timers.tick(3500);
  await rejected;
  assert.equal(calls, 1);
  assert.equal(video.currentTime, 5);
  assert.equal(video.paused, true);
});
