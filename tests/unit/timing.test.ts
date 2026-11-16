import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCaptions } from '../../src/core/captions.ts';
import { FilterEngine } from '../../src/core/engine.ts';
import { digest, freshState, parseTimingOffset } from '../../src/core/settings.ts';
import { CaptionTimingGuard } from '../../src/integration/caption-timing.ts';
import { parseSnapshot } from '../../src/shared/protocol.ts';
import type { Session } from '../../src/core/types.ts';

class Media extends EventTarget {
  currentTime = 0;
  playbackRate = 1;
  paused = false;
  seeking = false;
  readyState = 4;
  ended = false;
  volume = 0.6;
  private silent = false;
  get muted(): boolean {
    return this.silent;
  }
  set muted(value: boolean) {
    this.silent = value;
  }
  at(time: number): void {
    this.currentTime = time;
    this.dispatchEvent(new Event('timeupdate'));
  }
}
async function fixture(audioLanguage: string | null = 'en-US'): Promise<Session> {
  return {
    episode: 'EPISODE',
    version: 'VERSION',
    audioLanguage,
    tracks: [
      {
        id: await digest('EPISODE/VERSION/en/cc'),
        resource: 'https://example.test/cc.vtt',
        version: 'VERSION',
        language: 'en-US',
        kind: 'captions',
        document: await parseCaptions(
          'WEBVTT\n\n00:02:30.000 --> 00:02:32.000\nDamn shit!\n\n00:08:52.000 --> 00:08:54.000\nStupid mistake.\n',
          'vtt',
        ),
      },
    ],
  };
}

void test('manual +20 corrects future CC muting and timestamp seeks without a subtitle renderer or changed occurrence IDs', async (t) => {
  const media = new Media();
  const state = freshState();
  const session = await fixture();
  const engine = new FilterEngine(state);
  t.after(() => engine.detach());
  engine.attach(media);
  engine.setSession(session);
  await engine.rebuild();
  const ids = engine.snapshot().occurrences.map((row) => row.id);
  media.at(150.1);
  assert.equal(engine.snapshot().occurrences[0]!.audioCensored, true);
  engine.correctAudioTiming(session.tracks[0]!.id, 20);
  let snapshot = engine.snapshot();
  assert.equal(snapshot.occurrences[0]!.audioCensored, false);
  assert.equal(snapshot.audioTiming?.offset, 20);
  assert.deepEqual(
    snapshot.occurrences.map((row) => row.playbackTime),
    [170, 170, 552],
  );
  assert.deepEqual(
    snapshot.occurrences.map((row) => row.id),
    ids,
  );
  assert.deepEqual(
    snapshot.occurrences.map((row) => row.time),
    [150, 150, 532],
  );
  media.at(150);
  assert.equal(media.muted, false);
  // Lead-in is scheduled before the displayed cue's corrected start.
  media.at(169.95);
  assert.equal(media.muted, true);
  media.at(170.5);
  state.exceptions = [ids[0]!];
  engine.update(state);
  await engine.rebuild();
  assert.equal(media.muted, true);
  state.exceptions.push(ids[1]!);
  engine.update(state);
  await engine.rebuild();
  assert.equal(media.muted, false);
  state.exceptions = [];
  engine.update(state);
  await engine.rebuild();
  assert.equal(media.muted, true);
  media.at(173);
  assert.equal(media.muted, false);
  media.at(551.95);
  assert.equal(media.muted, true);
  media.paused = true;
  await engine.seek(ids[2]!);
  assert.ok(Math.abs(media.currentTime - 551.92) < 0.001);
  snapshot = engine.snapshot();
  assert.equal(snapshot.audioTiming?.offset, 20);
  engine.setSession({ ...session, episode: 'NEXT' });
  await engine.rebuild();
  assert.equal(engine.snapshot().audioTiming?.offset, 0);
});

void test('observed mismatch releases only owned mute, invalidates audio claims/seeks, survives settings and can be corrected', async (t) => {
  const media = new Media();
  const state = freshState();
  const session = await fixture();
  const engine = new FilterEngine(state);
  t.after(() => engine.detach());
  engine.attach(media);
  engine.setSession(session);
  await engine.rebuild();
  const track = session.tracks[0]!;
  media.at(150.5);
  assert.equal(media.muted, true);
  media.muted = true;
  engine.flagCaptionTiming(track.id);
  assert.equal(media.muted, true); // manual ownership preserved
  media.muted = false;
  assert.equal(media.muted, false);
  assert.equal(engine.snapshot().audio.phase, 'unavailable');
  assert.ok(
    engine
      .snapshot()
      .occurrences.every(
        (row) => row.timingUnreliable && !row.audioCensored && row.playbackTime === null,
      ),
  );
  assert.throws(() => engine.seek(engine.snapshot().occurrences[0]!.id), /unverified/);
  state.settings.enabled = false;
  engine.update(state);
  await engine.rebuild();
  state.settings.enabled = true;
  engine.update(state);
  await engine.rebuild();
  assert.equal(engine.snapshot().audio.phase, 'unavailable');
  engine.correctAudioTiming(track.id, 20);
  assert.equal(engine.snapshot().audio.phase, 'active');
  assert.equal(engine.snapshot().occurrences[0]!.timingUnreliable, false);
  media.at(170.5);
  assert.equal(media.muted, true);
  assert.equal(media.volume, 0.6);
});

void test('negative corrections, validation, missing CC and Japanese audio never create guessed coverage', async (t) => {
  for (const value of [NaN, Infinity, -Infinity, 301, -301, '20', null])
    assert.throws(() => parseTimingOffset(value));
  const media = new Media();
  const state = freshState();
  const session = await fixture();
  const engine = new FilterEngine(state);
  t.after(() => engine.detach());
  engine.attach(media);
  engine.setSession(session);
  await engine.rebuild();
  const id = session.tracks[0]!.id;
  assert.throws(() => engine.correctAudioTiming('other', 20));
  engine.correctAudioTiming(id, -20);
  assert.equal(engine.snapshot().occurrences[0]!.playbackTime, 130);
  media.at(130.5);
  assert.equal(media.muted, true);
  engine.correctAudioTiming(id, -300);
  assert.equal(engine.snapshot().occurrences[0]!.playbackTime, null);
  assert.throws(() => engine.seek(engine.snapshot().occurrences[0]!.id), /outside/);
  state.settings.mode = 'english';
  engine.update(state);
  engine.setSession(await fixture('ja-JP'));
  await engine.rebuild();
  assert.throws(() => engine.correctAudioTiming(id, 20));
  assert.equal(engine.snapshot().audioTiming?.track, null);
  assert.equal(media.muted, false);
  engine.setSession({ ...session, tracks: [{ ...session.tracks[0]!, kind: 'subtitles' }] });
  await engine.rebuild();
  assert.throws(() => engine.correctAudioTiming(id, 20));
});

void test('timing guard uses sustained advancing playback, ignores pauses/seeks/buffering/redraws, and never derives an offset', async () => {
  const cue = (await fixture()).tracks[0]!.document.cues[0]!;
  const media = new Media();
  const guard = new CaptionTimingGuard();
  media.at(170);
  assert.equal(guard.observe(cue, media, 0), false);
  media.at(170.25);
  assert.equal(guard.observe(cue, media, 250), false);
  media.at(170.55);
  assert.equal(guard.observe(cue, media, 550), true);
  guard.reset();
  media.at(170);
  assert.equal(guard.observe(cue, media, 1000, 20), false);
  media.at(171);
  assert.equal(guard.observe(cue, media, 2000, 20), false);
  for (const state of [{ paused: true }, { seeking: true }, { readyState: 2 }, { ended: true }]) {
    Object.assign(media, { paused: false, seeking: false, readyState: 4, ended: false }, state);
    guard.reset();
    assert.equal(guard.observe(cue, media, 3000), false);
    media.currentTime += 1;
    assert.equal(guard.observe(cue, media, 4000), false);
  }
  Object.assign(media, {
    paused: false,
    seeking: false,
    readyState: 4,
    ended: false,
    currentTime: 152.2,
  });
  assert.equal(guard.observe(cue, media, 5000), false); // normal redraw boundary
  media.at(180);
  assert.equal(guard.observe(cue, media, 5500), false);
  media.at(190);
  assert.equal(guard.observe(cue, media, 6000), false); // jump resets
  guard.observe(null, media, 6100);
  assert.equal(guard.observe(cue, media, 6700), false);
});

void test('snapshot validation rejects forged timing reports', async (t) => {
  const engine = new FilterEngine(freshState());
  t.after(() => engine.detach());
  engine.attach(new Media());
  engine.setSession(await fixture());
  await engine.rebuild();
  const snapshot = { ...engine.snapshot(), hasMedia: true };
  assert.doesNotThrow(() => parseSnapshot(snapshot));
  assert.throws(() => parseSnapshot({ ...snapshot, audioTiming: { track: 'wrong', offset: 20 } }));
  assert.throws(() =>
    parseSnapshot({ ...snapshot, audioTiming: { ...snapshot.audioTiming, offset: Infinity } }),
  );
  assert.throws(() =>
    parseSnapshot({
      ...snapshot,
      occurrences: snapshot.occurrences.map((row) => ({ ...row, playbackTime: -2 })),
    }),
  );
});
