import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DisplayCueIndex,
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
  // The caption renderer has a different clock; log its actual source cue.
  media.currentTime = 10;
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

void test('exact displayed text identifies its own cue outside the active media interval, including speaker labels', async () => {
  const document = await parseCaptions(
    'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n[CAPTAIN] That damn\nclass is full of shit!\n\n00:00:03.000 --> 00:00:04.000\nWhat the hell?\n',
    'vtt',
  );
  const [first, second] = document.cues;
  const index = new DisplayCueIndex(document.cues);
  const policy = new Map(
    document.cues.map((cue) => [cue.key, findMatches(cue.text, ['damn', 'shit', 'hell'])]),
  );
  const text = '\n[CAPTAIN] That damn class is full of shit!';
  const result = index.match(text, [second!], policy);
  assert.equal(result.kind, 'matched');
  if (result.kind !== 'matched') return;
  assert.equal(result.timing, 'text');
  assert.deepEqual(
    result.cues.map((cue) => cue.key),
    [first!.key],
  );
  assert.deepEqual(redactDisplaySegments([text], result.matches), [
    '\n[CAPTAIN] That **** class is full of ****!',
  ]);
  assert.equal(index.match('[CAPTAIN] Different damn dialogue.', [], policy).kind, 'missing');
  assert.equal(index.match('That damn class is full of shit!', [], policy).kind, 'missing');
  assert.equal(index.match('', [], policy).kind, 'missing');
  // An updated exception policy removes only its occurrence, not another term.
  policy.set(first!.key, findMatches(first!.text, ['shit']));
  const ignored = index.match(text, [], policy);
  assert.equal(ignored.kind, 'matched');
  if (ignored.kind === 'matched')
    assert.deepEqual(redactDisplaySegments([text], ignored.matches), [
      '\n[CAPTAIN] That damn class is full of ****!',
    ]);
});

void test('repeated exact lines require unambiguous current timing and cannot borrow another occurrence exception', async () => {
  const document = await parseCaptions(
    'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nDamn!\n\n00:00:03.000 --> 00:00:04.000\nDamn!\n',
    'vtt',
  );
  const [first, second] = document.cues;
  const index = new DisplayCueIndex(document.cues);
  const policy = new Map([
    [first!.key, []],
    [second!.key, findMatches(second!.text, ['damn'])],
  ]);
  assert.equal(index.match('Damn!', [], policy).kind, 'ambiguous');
  assert.equal(index.match('Damn!', document.cues, policy).kind, 'ambiguous');
  const ignored = index.match('Damn!', [first!], policy);
  assert.equal(ignored.kind, 'matched');
  if (ignored.kind === 'matched') assert.deepEqual(ignored.matches, []);
  const filtered = index.match('Damn!', [second!], policy);
  assert.equal(filtered.kind, 'matched');
  if (filtered.kind === 'matched') {
    assert.equal(filtered.timing, 'current');
    assert.deepEqual(filtered.cues, [second]);
    assert.deepEqual(redactDisplaySegments(['Damn!'], filtered.matches), ['****!']);
  }
});

void test('overlapping current cues retain separate match offsets and a fresh track index cannot reuse old text', async () => {
  const document = await parseCaptions(
    'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nDamn!\n\n00:00:02.000 --> 00:00:04.000\nWhat the hell?\n',
    'vtt',
  );
  const index = new DisplayCueIndex(document.cues);
  const policy = new Map(
    document.cues.map((cue) => [cue.key, findMatches(cue.text, ['damn', 'hell'])]),
  );
  const result = index.match('Damn!\nWhat the hell?', document.cues, policy);
  assert.equal(result.kind, 'matched');
  if (result.kind === 'matched') {
    assert.equal(result.timing, 'current');
    assert.deepEqual(redactDisplaySegments(['Damn!', '\n', 'What the hell?'], result.matches), [
      '****!',
      '\n',
      'What the ****?',
    ]);
  }
  const other = new DisplayCueIndex([document.cues[1]!]);
  assert.equal(other.match('Damn!', [], policy).kind, 'missing');
});

void test('observed timing drift blocks repeated-line exceptions until a unique cue verifies alignment again', async () => {
  const document = await parseCaptions(
    'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nThat damn class!\n\n00:00:03.000 --> 00:00:04.000\nDamn!\n\n00:00:05.000 --> 00:00:06.000\nDamn!\n',
    'vtt',
  );
  const index = new DisplayCueIndex(document.cues);
  const [unique, first, second] = document.cues;
  const policy = new Map(document.cues.map((cue) => [cue.key, findMatches(cue.text, ['damn'])]));
  policy.set(second!.key, []);
  assert.equal(index.match(unique!.text, [], policy).kind, 'matched');
  assert.equal(index.match('Damn!', [second!], policy).kind, 'ambiguous');
  assert.equal(index.match(unique!.text, [unique!], policy).kind, 'matched');
  const resolved = index.match('Damn!', [first!], policy);
  assert.equal(resolved.kind, 'matched');
  if (resolved.kind === 'matched') assert.equal(resolved.matches.length, 1);
});
