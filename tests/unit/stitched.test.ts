import assert from 'node:assert/strict';
import test from 'node:test';
import { FilterEngine, dialogueTrack } from '../../src/core/engine.ts';
import { freshState } from '../../src/core/settings.ts';
import {
  captionResources,
  loadSession,
  parseSession,
  sessionEnvelope,
} from '../../src/integration/metadata.ts';
import { stitchedMain } from '../../src/integration/stitched.ts';
import { parseSnapshot } from '../../src/shared/protocol.ts';

const cc = { language: 'en-US', format: 'vtt', url: 'https://example.test/cc.vtt' };
const text =
  'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nDamn!\n\n00:02:30.000 --> 00:02:32.000\nDamn shit!\n\n00:08:52.000 --> 00:08:54.000\nStupid mistake.\n';
function payload(start = 19.061) {
  return {
    captions: { 'en-US': cc },
    stitchedElements: [
      ...(start
        ? [
            {
              type: 'promo',
              start: 0,
              end: start,
              track: false,
              timeline: true,
              textTracks: [],
              audioTracks: [],
            },
          ]
        : []),
      {
        type: 'main',
        start,
        end: start + 600,
        track: true,
        timeline: true,
        audioTracks: [],
        textTracks: [
          { role: 'subtitle', format: 'burned_in', language: 'en-US' },
          {
            role: 'closed_caption',
            format: 'external',
            language: 'en-US',
            externalTextUrl: cc.url,
          },
          {
            role: 'subtitle',
            format: 'external',
            language: 'es-ES',
            externalTextUrl: 'https://example.test/spanish.ass',
          },
        ],
      },
    ],
  };
}
async function session(start = 19.061, audio = 'en-US', content = text) {
  return loadSession(
    'EPISODE',
    'VERSION',
    audio,
    captionResources(payload(start)),
    async () => content,
  );
}
class Media extends EventTarget {
  currentTime = 0;
  duration = 619.061;
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

void test('MAIN external tracks take precedence; equivalent legacy identities survive promo changes', async () => {
  const raw = payload();
  const resources = captionResources(raw);
  assert.equal(resources.length, 1);
  assert.equal(resources[0]!.kind, 'captions');
  assert.deepEqual(resources[0]!.timeline, {
    kind: 'stitched-main',
    start: 19.061,
    end: 619.061,
    duration: 619.061,
  });
  assert.equal(captionResources(raw, false).length, 2);
  const old = await loadSession(
    'EPISODE',
    'VERSION',
    'en-US',
    captionResources({ captions: raw.captions }),
    async () => text,
  );
  assert.equal((await session()).tracks[0]!.id, old.tracks[0]!.id);
  assert.equal((await session(7.25)).tracks[0]!.id, old.tracks[0]!.id);
  raw.captions['en-US'] = { ...cc, url: 'https://example.test/obsolete.vtt' };
  assert.equal(captionResources(raw)[0]!.url, cc.url);
  assert.equal(captionResources({ stitchedElements: raw.stitchedElements })[0]!.url, cc.url);
  const japanese = await session(19.061, 'ja-JP');
  const british = { ...japanese.tracks[0]!, id: 'british', language: 'en-GB' };
  assert.equal(
    dialogueTrack({ ...japanese, audioLanguage: 'en-US', tracks: [british, ...japanese.tracks] })
      ?.language,
    'en-US',
  );
  assert.equal(
    dialogueTrack({ ...japanese, audioLanguage: null, tracks: [british, ...japanese.tracks] }),
    undefined,
  );
});

void test('noncontinuous, ad, excluded-timeline and ambiguous MAIN layouts never guess an offset', () => {
  for (const change of [
    (raw: ReturnType<typeof payload>) => {
      raw.stitchedElements[0]!.type = 'ad';
    },
    (raw: ReturnType<typeof payload>) => {
      raw.stitchedElements[0]!.timeline = false;
    },
    (raw: ReturnType<typeof payload>) => {
      raw.stitchedElements[1]!.start += 1;
    },
    (raw: ReturnType<typeof payload>) => {
      raw.stitchedElements[1]!.end = Infinity;
    },
    (raw: ReturnType<typeof payload>) => {
      raw.stitchedElements.push(raw.stitchedElements[1]!);
    },
    (raw: ReturnType<typeof payload>) => {
      raw.stitchedElements[1]!.track = false;
    },
  ]) {
    const raw = payload();
    change(raw);
    assert.equal(stitchedMain(raw)?.timeline.kind, 'unavailable');
    assert.equal(captionResources(raw)[0]!.timeline?.kind, 'unavailable');
  }
  assert.equal(stitchedMain({ stitchedElements: {} })?.timeline.kind, 'unavailable');
  assert.equal(stitchedMain({ stitchedElements: [] }), undefined);
  assert.equal(stitchedMain(payload(0))?.timeline.kind, 'stitched-main');
});

void test('metadata mapping pre-schedules whole cues, clamps padding, preserves Ignore and seeks the stitched clock', async (t) => {
  const state = freshState();
  const video = new Media();
  const engine = new FilterEngine(state);
  t.after(() => engine.detach());
  engine.attach(video);
  engine.setSession(await session());
  await engine.rebuild();
  const before = engine.snapshot();
  assert.equal(before.audio.phase, 'active');
  assert.equal(before.audioTiming?.automaticOffset, 19.061);
  assert.equal(before.audioTiming?.offset, 0);
  assert.deepEqual(
    before.occurrences.map((row) => row.playbackTime),
    [19.061, 169.061, 169.061, 551.061],
  );
  video.at(19.02);
  assert.equal(video.muted, false); // padding never mutes the promo
  video.at(19.07);
  assert.equal(video.muted, true);
  video.at(150);
  assert.equal(video.muted, false);
  video.at(169.01);
  assert.equal(video.muted, true); // before caption rendering
  state.exceptions = [before.occurrences[1]!.id];
  engine.update(state);
  await engine.rebuild();
  assert.equal(video.muted, true);
  state.exceptions.push(before.occurrences[2]!.id);
  engine.update(state);
  await engine.rebuild();
  assert.equal(video.muted, false);
  state.exceptions = [];
  engine.update(state);
  await engine.rebuild();
  assert.equal(video.muted, true);
  video.paused = true;
  video.at(170);
  assert.equal(video.muted, false);
  await engine.seek(before.occurrences[3]!.id);
  assert.ok(Math.abs(video.currentTime - 550.981) < 0.00001);
  video.paused = false;
  video.playbackRate = 2;
  video.at(551.1);
  assert.equal(video.muted, true);
  video.seeking = true;
  video.at(551.2);
  assert.equal(video.muted, false);
  video.seeking = false;
  video.readyState = 2;
  video.at(551.2);
  assert.equal(video.muted, false);
  video.readyState = 4;
  video.at(169.1);
  assert.equal(video.muted, true); // replay
  engine.correctAudioTiming(before.audioTiming!.track!, 0.5);
  assert.equal(engine.snapshot().audioTiming?.offset, 0.5);
  assert.equal(engine.snapshot().audioTiming?.automaticOffset, 19.061);
  assert.equal(engine.snapshot().occurrences[1]!.playbackTime, 169.561);
  assert.deepEqual(
    engine.snapshot().occurrences.map((row) => row.id),
    before.occurrences.map((row) => row.id),
  );
  assert.equal(video.muted, false);
  video.at(169.6);
  assert.equal(video.muted, true);
  video.muted = true;
  engine.invalidate('Next episode');
  assert.equal(video.muted, true);
  video.muted = false;
  video.duration = 607.25;
  engine.setSession({ ...(await session(7.25)), episode: 'NEXT' });
  await engine.rebuild();
  assert.equal(engine.snapshot().audioTiming?.automaticOffset, 7.25);
  assert.equal(engine.snapshot().audioTiming?.offset, 0);
  assert.equal(engine.snapshot().occurrences[1]!.playbackTime, 157.25);
  engine.setSession(await session(7.25, 'ja-JP'));
  await engine.rebuild();
  video.at(157.3);
  assert.equal(video.muted, false);
  assert.equal(engine.snapshot().audio.phase, 'disabled');
});

void test('unknown or mismatched media duration blocks audio and seeks without disabling independent English text', async (t) => {
  const video = new Media();
  video.duration = NaN;
  const state = freshState();
  const engine = new FilterEngine(state);
  t.after(() => engine.detach());
  engine.attach(video);
  const data = await session();
  engine.setSession(data);
  await engine.rebuild();
  assert.equal(engine.snapshot().audio.phase, 'loading');
  video.duration = 619.061;
  video.dispatchEvent(new Event('durationchange'));
  video.at(169.5);
  assert.equal(video.muted, true);
  engine.setRenderer({
    trackId: data.tracks[0]!.id,
    language: 'en-US',
    format: 'vtt',
    apply() {},
    restore() {},
  });
  video.duration = 600;
  video.dispatchEvent(new Event('durationchange'));
  assert.equal(video.muted, false);
  assert.equal(engine.snapshot().audio.phase, 'unavailable');
  assert.equal(engine.snapshot().subtitles.phase, 'active');
  assert.ok(engine.snapshot().occurrences.every((row) => row.playbackTime === null));
  assert.throws(() => engine.seek(engine.snapshot().occurrences[0]!.id), /unverified/);
  assert.throws(() => engine.correctAudioTiming(data.tracks[0]!.id, 19.061));
  video.duration = 619.061;
  video.dispatchEvent(new Event('durationchange'));
  assert.equal(engine.snapshot().audio.phase, 'active');
  assert.equal(video.muted, true);
  state.settings.enabled = false;
  engine.update(state);
  await engine.rebuild();
  assert.equal(video.muted, false);
  assert.equal(engine.snapshot().audio.phase, 'disabled');
});

void test('timestamp-mapped and out-of-range captions are not shifted again; bridge rejects invalid mappings', async () => {
  for (const content of [
    text.replace('WEBVTT', 'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:1800000'),
    text.replace('00:08:54.000', '00:11:54.000'),
  ])
    assert.equal(
      (await session(19.061, 'en-US', content)).tracks[0]!.timeline?.kind,
      'unavailable',
    );
  const data = sessionEnvelope(await session());
  assert.doesNotThrow(() => parseSession(data));
  for (const timeline of [
    null,
    { kind: 'stitched-main', start: -1, end: 10, duration: 10 },
    { kind: 'stitched-main', start: 1, end: 10, duration: 9 },
    { kind: 'stitched-main', start: 1, end: Infinity, duration: Infinity },
  ])
    assert.throws(() => parseSession({ ...data, tracks: [{ ...data.tracks[0], timeline }] }));
  const engine = new FilterEngine(freshState());
  const snapshot = { ...engine.snapshot(), hasMedia: false };
  assert.throws(() =>
    parseSnapshot({ ...snapshot, audioTiming: { track: null, offset: 0, automaticOffset: -1 } }),
  );
});
