import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectCaptionMatches,
  redactDisplaySegments,
  resolveSubtitleLabel,
} from '../../src/integration/caption-display.ts';
import { findMatches } from '../../src/core/matcher.ts';
import { parseCaptions } from '../../src/core/captions.ts';
import { analyse, FilterEngine } from '../../src/core/engine.ts';
import { freshState } from '../../src/core/settings.ts';
import type { Session, Track } from '../../src/core/types.ts';

async function fixture(): Promise<Session> {
  const document = await parseCaptions(
    'WEBVTT\n\n00:00:00.800 --> 00:00:02.200\nThat damn class is full of shit!\n',
    'vtt',
  );
  const track: Track = {
    id: 'cc',
    language: 'en-US',
    version: 'VERSION',
    kind: 'captions',
    resource: 'https://example.test/en.vtt',
    document,
  };
  return {
    episode: 'EPISODE',
    version: 'VERSION',
    audioLanguage: 'ja-JP',
    tracks: [track],
    available: [
      { ...track, format: 'vtt', requestUrl: track.resource },
      {
        resource: 'https://example.test/es.vtt',
        requestUrl: 'https://example.test/es.vtt',
        language: 'es-ES',
        kind: 'subtitles',
        format: 'vtt',
      },
    ],
  };
}

void test('player labels resolve language AND caption role; unknown and ambiguous labels fail closed', async () => {
  const session = await fixture();
  assert.equal(resolveSubtitleLabel(session, 'English [CC]').track?.id, 'cc');
  assert.equal(resolveSubtitleLabel(session, 'English (US) [CC]').language, 'en-US');
  assert.equal(resolveSubtitleLabel(session, 'en-US [CC]').track?.id, 'cc');
  assert.equal(resolveSubtitleLabel(session, 'English').track, null);
  assert.equal(resolveSubtitleLabel(session, 'Spanish').language, 'es-ES');
  assert.equal(resolveSubtitleLabel(session, 'None').language, 'off');
  assert.equal(resolveSubtitleLabel(session, 'Unknown track').language, null);
  session.available!.push({
    ...session.available![0]!,
    language: 'en-GB',
    resource: 'https://example.test/gb.vtt',
  });
  assert.equal(resolveSubtitleLabel(session, 'English [CC]').track, null);
  assert.equal(resolveSubtitleLabel(session, 'English [CC]').language, null);
  assert.equal(resolveSubtitleLabel(session, 'English (US) [CC]').track?.id, 'cc');
});

void test('cue matches project across inline nodes and whitespace without losing layout or benign substrings', () => {
  const expected = 'That damn class is full of shit!';
  const segments = ['\n', 'That da', 'mn  class is full of ', 'shit', '!'];
  const matches = projectCaptionMatches(
    expected,
    segments.join(''),
    findMatches(expected, ['ass', 'damn', 'shit']),
  );
  assert.ok(matches);
  assert.deepEqual(redactDisplaySegments(segments, matches), [
    '\n',
    'That ****',
    '  class is full of ',
    '****',
    '!',
  ]);
  const phrase = 'son\n of a bitch!';
  const parts = ['son', '\n', ' of a ', 'bitch', '!'];
  assert.deepEqual(
    redactDisplaySegments(
      parts,
      projectCaptionMatches(phrase, parts.join(''), findMatches(phrase, ['son of a bitch']))!,
    ),
    ['****', '\n', '', '', '!'],
  );
  assert.equal(projectCaptionMatches(expected, 'Un damn de prueba en español.', []), null);
  assert.equal(projectCaptionMatches(expected, 'Another English cue.', []), null);
});

void test('VTT overlay policies update immediately for per-occurrence exceptions; only applied cues are logged', async (t) => {
  const state = freshState();
  const session = await fixture();
  const engine = new FilterEngine(state);
  t.after(() => engine.detach());
  const media = Object.assign(new EventTarget(), {
    currentTime: 1,
    playbackRate: 1,
    paused: true,
    seeking: false,
    readyState: 4,
    ended: false,
    volume: 0.6,
    muted: false,
  });
  engine.attach(media);
  engine.setSession(session);
  await engine.rebuild();
  const actual = new Set<string>();
  let terms: string[] = [];
  engine.setRenderer({
    trackId: 'cc',
    language: 'en-US',
    format: 'vtt',
    apply: (_content, matches) => {
      terms = [...matches.values()].flat().map((match) => match.term);
    },
    restore: () => {
      terms = [];
    },
    censoredCues: () => actual,
  });
  assert.equal(engine.snapshot().subtitles.phase, 'active');
  assert.deepEqual(terms, ['damn', 'shit']);
  assert.ok(engine.snapshot().occurrences.every((row) => !row.textCensored));
  actual.add(session.tracks[0]!.document.cues[0]!.key);
  media.dispatchEvent(new Event('timeupdate'));
  assert.ok(engine.snapshot().occurrences.every((row) => row.textCensored));
  const rows = await analyse(session, state);
  state.exceptions = [rows[0]!.id];
  engine.update(state);
  await engine.rebuild();
  assert.deepEqual(terms, ['shit']);
  state.exceptions = [];
  engine.update(state);
  await engine.rebuild();
  assert.deepEqual(terms, ['damn', 'shit']);
  assert.equal(media.muted, false);
  state.settings.enabled = false;
  engine.update(state);
  assert.deepEqual(terms, []);
  assert.equal(engine.snapshot().subtitles.phase, 'disabled');
});
