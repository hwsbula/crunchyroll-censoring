import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { findMatches, redact } from '../../src/core/matcher.ts';
import {
  activeTerms,
  DEFAULT_SETTINGS,
  digest,
  freshState,
  normalizeTerms,
  parseSettings,
  parseState,
} from '../../src/core/settings.ts';
import { parseCaptions, renderDocument } from '../../src/core/captions.ts';
import {
  analyse,
  dialogueTrack,
  FilterEngine,
  intervalsFor,
  mayFilterAudio,
  selectedMode,
} from '../../src/core/engine.ts';
import type { Renderer } from '../../src/core/engine.ts';
import type { Session, Track } from '../../src/core/types.ts';
import { CueScheduler, mergeIntervals, MuteGate } from '../../src/core/scheduler.ts';
import { SettingsRepository } from '../../src/shared/repository.ts';
import type { Store } from '../../src/shared/repository.ts';
import {
  audioMetadata,
  englishResources,
  loadSession,
  parseSession,
  playbackVersion,
  selectedSubtitleResource,
} from '../../src/integration/metadata.ts';
import {
  parseSnapshot,
  parseTarget,
  trustedContent,
  trustedUi,
} from '../../src/shared/protocol.ts';

const ass = await readFile(new URL('../fixtures/english.ass', import.meta.url), 'utf8');
const vtt = await readFile(new URL('../fixtures/english.vtt', import.meta.url), 'utf8');
class FakeMedia extends EventTarget {
  currentTime = 0;
  playbackRate = 1;
  paused = false;
  seeking = false;
  readyState = 4;
  ended = false;
  volume = 0.63;
  private silent = false;
  get muted(): boolean {
    return this.silent;
  }
  set muted(value: boolean) {
    this.silent = value;
  }
}
async function track(
  version = 'VERSION',
  kind: Track['kind'] = 'captions',
  format: 'ass' | 'vtt' = 'ass',
): Promise<Track> {
  return {
    id: await digest(`EPISODE/${version}/${kind}/en-US/${format}`),
    resource: 'https://example.test/subtitle.ass',
    version,
    language: 'en-US',
    kind,
    document: await parseCaptions(format === 'ass' ? ass : vtt, format),
  };
}
async function fixture(
  audioLanguage: string | null = 'en-US',
  kind: Track['kind'] = 'captions',
): Promise<Session> {
  return {
    episode: 'EPISODE',
    version: 'VERSION',
    audioLanguage,
    tracks: [await track('VERSION', kind)],
  };
}
function store(): Store & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async () => structuredClone(data),
    set: async (items) => {
      Object.assign(data, structuredClone(items));
    },
  };
}

void test('whole words, phrases, punctuation, apostrophes, case and full-width variants', () => {
  const text = 'Class, passage, shell, shits and FUCK! Bull’s eye; son\n of   a bitch.';
  const matches = findMatches(text, [
    'ass',
    'hell',
    'shit',
    'fuck',
    "bull's eye",
    'son of a bitch',
    'bitch',
  ]);
  assert.deepEqual(
    matches.map((value) => value.term),
    ['fuck', "bull's eye", 'son of a bitch'],
  );
  assert.equal(redact(text, matches), 'Class, passage, shell, shits and ****! ****; ****.');
  assert.equal(findMatches('ＦＵＣＫ! fuck? fuck.', ['fuck']).length, 3);
  assert.equal(findMatches('shithead bullshit', ['shit']).length, 0);
});
void test('literal custom terms are escaped by construction, bounded and deduplicated', () => {
  assert.deepEqual(normalizeTerms([' Foo  Bar ', 'foo\tbar', 'BULL’S']), ['foo bar', "bull's"]);
  assert.throws(() => normalizeTerms(['  ']));
  assert.throws(() => normalizeTerms(['x'.repeat(101)]));
  assert.throws(() => normalizeTerms(['bad\u0000term']));
  assert.equal(findMatches('a.*b (test) A.*B', ['a.*b']).length, 2);
  assert.deepEqual(findMatches('aaab', ['a.*b']), []);
  assert.throws(() => parseSettings({ ...DEFAULT_SETTINGS, beforeMs: 301 }));
  assert.throws(() => parseState({ version: 2 }));
});
void test('ASS parser retains tags, timing, positions, punctuation and source for restoration', async () => {
  const document = await parseCaptions(ass, 'ass');
  assert.equal(document.cues.length, 3);
  const second = document.cues[1]!;
  assert.equal(second.start, 2);
  assert.equal(second.text, 'What the hell?\nWatch your step.');
  const filtered = renderDocument(
    document,
    new Map(
      document.cues.map((cue) => [cue.key, findMatches(cue.text, activeTerms(DEFAULT_SETTINGS))]),
    ),
  );
  assert.match(filtered, /That \*\*\*\* class is full of \*\*\*\*!/);
  assert.ok(filtered.includes('{\\an8\\i1}What the ****?\\NWatch your step.'));
  assert.equal(renderDocument(document, new Map()), ass);
  assert.equal(document.original, ass);
});
void test('phrase spanning ASS tags/line breaks is removed without deleting layout tags or breaks', async () => {
  const source = ass.replace('That damn class is full of shit!', 'son{\\i1} of\\Na bitch!');
  const document = await parseCaptions(source, 'ass');
  const cue = document.cues[0]!;
  const rendered = renderDocument(
    document,
    new Map([[cue.key, findMatches(cue.text, ['son of a bitch'])]]),
  );
  assert.ok(rendered.includes('****{\\i1}\\N!'));
});
void test('WebVTT is parsed ahead of time with real cue times; malformed/empty tracks fail', async () => {
  const document = await parseCaptions(vtt, 'vtt');
  assert.equal(document.cues.length, 2);
  assert.equal(document.cues[0]!.start, 0.8);
  assert.equal(document.cues[0]!.end, 2.2);
  assert.equal(document.cues[1]!.text, 'What the hell?\nWatch your step.');
  await assert.rejects(parseCaptions('WEBVTT\n\n00:00:02.000 --> 00:00:01.000\nhello', 'vtt'));
  await assert.rejects(parseCaptions('[Script Info]\n', 'ass'));
  await assert.rejects(parseCaptions('Dialogue: wrong', 'vtt'));
});
void test('matching English CC is required; translations, other versions and Japanese are excluded', async () => {
  const en = await fixture();
  assert.ok(dialogueTrack(en));
  assert.ok(mayFilterAudio(en, freshState()));
  assert.equal(dialogueTrack(await fixture('en-US', 'subtitles')), undefined);
  en.tracks[0]!.version = 'OTHER';
  assert.equal(dialogueTrack(en), undefined);
  const jp = await fixture('ja-JP');
  const override = freshState();
  override.settings.mode = 'english';
  assert.equal(mayFilterAudio(jp, override), false);
  assert.equal(mayFilterAudio(await fixture(null), freshState()), false);
  assert.equal(mayFilterAudio(await fixture('fr-FR'), override), false);
  assert.match(selectedMode('ja-JP', 'english'), /Japanese.*detected/);
  assert.match(selectedMode(null, 'english'), /manual override/);
});
void test('occurrences distinguish repeated matches and cannot leak across version/track/cue/term identity', async () => {
  const session = await fixture();
  const first = await analyse(session, freshState());
  assert.equal(first.length, 3);
  const state = freshState();
  state.exceptions = [first[0]!.id];
  const ignored = await analyse(session, state);
  assert.equal(ignored[0]!.ignored, true);
  assert.equal(ignored[1]!.ignored, false);
  assert.equal(intervalsFor(ignored, session.tracks[0]!, state).length, 2);
  const next = { ...session, version: 'NEXT', tracks: [await track('NEXT')] };
  assert.ok((await analyse(next, state)).every((value) => !value.ignored));
  const translations = await analyse(await fixture('ja-JP', 'subtitles'), state);
  assert.ok(translations.every((value) => !value.ignored));
  state.exceptions = [];
  assert.ok((await analyse(session, state)).every((value) => !value.ignored));
});
void test('overlap merging preserves disjoint intervals and does not mark future occurrences early', () => {
  const merged = mergeIntervals([
    { start: 1, end: 3, ids: ['a'] },
    { start: 2, end: 4, ids: ['b'] },
    { start: 6, end: 7, ids: ['c'] },
  ]);
  assert.deepEqual(merged, [
    { start: 1, end: 4, ids: ['a', 'b'] },
    { start: 6, end: 7, ids: ['c'] },
  ]);
  const media = new FakeMedia();
  const gate = new MuteGate(media);
  const scheduler = new CueScheduler(media, gate);
  scheduler.setIntervals([
    { start: 1, end: 3, ids: ['a'] },
    { start: 2, end: 4, ids: ['b'] },
  ]);
  media.currentTime = 1.2;
  assert.deepEqual(scheduler.tick(), ['a']);
  media.currentTime = 2.2;
  assert.deepEqual(scheduler.tick(), ['a', 'b']);
  gate.dispose();
});
void test('scheduler follows media time through pause, buffering, seek, replay and playback rate', () => {
  const media = new FakeMedia();
  const gate = new MuteGate(media);
  const scheduler = new CueScheduler(media, gate);
  scheduler.setIntervals([{ start: 1, end: 2, ids: ['a'] }]);
  media.currentTime = 1.2;
  assert.deepEqual(scheduler.tick(), ['a']);
  assert.equal(media.muted, true);
  media.paused = true;
  scheduler.tick();
  assert.equal(media.muted, false);
  media.paused = false;
  media.readyState = 2;
  scheduler.tick();
  assert.equal(media.muted, false);
  media.readyState = 4;
  media.seeking = true;
  scheduler.tick();
  assert.equal(media.muted, false);
  media.seeking = false;
  media.currentTime = 5;
  scheduler.tick();
  assert.equal(media.muted, false);
  media.currentTime = 1.2;
  media.playbackRate = 2;
  assert.deepEqual(scheduler.tick(), ['a']);
  assert.ok(scheduler.delay() <= 25);
  media.currentTime = 2;
  scheduler.tick();
  assert.equal(media.muted, false);
  gate.dispose();
  assert.equal(Object.hasOwn(media, 'muted'), false);
});
void test('manual mute choices (including same-value writes) and volume survive owned muting', () => {
  const media = new FakeMedia();
  const gate = new MuteGate(media);
  assert.equal(gate.set(true), true);
  assert.equal(media.muted, true);
  media.muted = true;
  gate.release();
  assert.equal(media.muted, true);
  assert.equal(media.volume, 0.63);
  media.muted = false;
  gate.set(true);
  media.muted = false;
  assert.equal(media.muted, true);
  gate.release();
  assert.equal(media.muted, false);
  media.muted = true;
  gate.dispose();
  assert.equal(media.muted, true);
});
void test('engine censors English audio and text, recomputes Ignore/Unignore and restores on disable', async (t) => {
  const media = new FakeMedia();
  const state = freshState();
  const session = await fixture();
  const engine = new FilterEngine(state);
  engine.attach(media);
  t.after(() => engine.detach());
  engine.setSession(session);
  let rendered = '';
  const renderer: Renderer = {
    trackId: session.tracks[0]!.id,
    language: 'en-US',
    apply: (content) => {
      rendered = content;
    },
    restore: () => {
      rendered = ass;
    },
  };
  engine.setRenderer(renderer);
  await engine.rebuild();
  assert.equal(engine.snapshot().audio.phase, 'active');
  assert.equal(engine.snapshot().subtitles.phase, 'active');
  assert.match(rendered, /That \*\*\*\*/);
  media.currentTime = 1;
  media.dispatchEvent(new Event('timeupdate'));
  assert.equal(media.muted, true);
  assert.ok(engine.snapshot().occurrences[0]!.audioCensored);
  const rows = engine.snapshot().occurrences;
  state.exceptions = [rows[0]!.id];
  engine.update(state);
  await engine.rebuild();
  assert.equal(media.muted, true);
  assert.ok(rendered.includes('That damn class is full of ****!'));
  state.exceptions.push(rows[1]!.id);
  engine.update(state);
  await engine.rebuild();
  assert.equal(media.muted, false);
  assert.ok(rendered.includes('That damn class is full of shit!'));
  state.exceptions = [];
  engine.update(state);
  await engine.rebuild();
  assert.equal(media.muted, true);
  state.settings.enabled = false;
  engine.update(state);
  assert.equal(media.muted, false);
  assert.equal(rendered, ass);
  await engine.rebuild();
  assert.equal(engine.snapshot().audio.phase, 'disabled');
});
void test('Japanese mode never mutes; unknown and missing captions render truthful warnings', async (t) => {
  const media = new FakeMedia();
  const state = freshState();
  state.settings.mode = 'english';
  const engine = new FilterEngine(state);
  engine.attach(media);
  t.after(() => engine.detach());
  engine.setSession(await fixture('ja-JP'));
  await engine.rebuild();
  media.currentTime = 1;
  media.dispatchEvent(new Event('timeupdate'));
  assert.equal(media.muted, false);
  assert.equal(engine.snapshot().audio.phase, 'disabled');
  state.settings.mode = 'auto';
  engine.update(state);
  engine.setSession(await fixture(null));
  await engine.rebuild();
  assert.match(engine.snapshot().audio.reason, /language unresolved/);
  assert.equal(media.muted, false);
  engine.setSession(await fixture('en-US', 'subtitles'));
  await engine.rebuild();
  assert.match(engine.snapshot().audio.reason, /no English dialogue\/CC/);
  assert.equal(engine.snapshot().subtitles.phase, 'unavailable');
  engine.setSubtitleLanguage('es-419');
  assert.equal(engine.snapshot().subtitles.phase, 'disabled');
  assert.match(engine.snapshot().subtitles.reason, /unchanged/);
});
void test('timeline readiness and invalidation release only owned muting, discard stale matches and seeks', async (t) => {
  const media = new FakeMedia();
  const engine = new FilterEngine(freshState());
  engine.attach(media);
  t.after(() => engine.detach());
  engine.setSession(await fixture());
  await engine.rebuild();
  const id = engine.snapshot().occurrences[0]!.id;
  engine.setTimelineReady(false);
  await engine.rebuild();
  assert.equal(engine.snapshot().audio.phase, 'loading');
  media.currentTime = 1;
  media.dispatchEvent(new Event('timeupdate'));
  assert.equal(media.muted, false);
  engine.setTimelineReady(true);
  await engine.rebuild();
  assert.equal(media.muted, true);
  media.muted = true;
  engine.invalidate('Ad/timeline transition.');
  await engine.rebuild();
  assert.equal(media.muted, true);
  assert.equal(engine.snapshot().occurrences.length, 0);
  assert.throws(() => engine.seek(id));
  assert.equal(engine.snapshot().audio.phase, 'unavailable');
});
void test('state writes serialize, exceptions persist, stale drafts and unknown formats are preserved', async () => {
  const memory = store();
  const repository = new SettingsRepository(memory);
  const [first, second] = await Promise.all([
    repository.patch({ enabled: false }),
    repository.patch({ mode: 'japanese' }),
  ]);
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  const saved = await repository.read();
  assert.equal(saved.settings.enabled, false);
  assert.equal(saved.settings.mode, 'japanese');
  await assert.rejects(repository.save(DEFAULT_SETTINGS, 0), /changed in another window/);
  const row = (await analyse(await fixture(), freshState()))[0]!;
  await repository.ignore(row.id, true);
  const reopened = new SettingsRepository(memory);
  assert.ok((await reopened.read()).exceptions.includes(row.id));
  await reopened.ignore(row.id, false);
  assert.equal((await repository.read()).exceptions.length, 0);
  await repository.ignore(row.id, true);
  await repository.clear();
  assert.equal((await repository.read()).exceptions.length, 0);
  memory.data['quietroll.v1'] = { version: 7 };
  await assert.rejects(repository.patch({ enabled: true }));
  assert.deepEqual(memory.data['quietroll.v1'], { version: 7 });
});
void test('observed metadata binds English resources to playback versions and never falls back to translations for CC', async () => {
  assert.equal(
    playbackVersion('https://www.crunchyroll.com/playback/v4/ABC123/web/chrome/play'),
    'ABC123',
  );
  assert.equal(playbackVersion('https://evil.test/playback/v4/ABC123/web/chrome/play'), null);
  const metadata = { data: [{ id: 'ABC123', episode_metadata: { audio_locale: 'en-GB' } }] };
  assert.equal(audioMetadata(metadata).get('ABC123'), 'en-GB');
  const resources = englishResources({
    captions: {
      'en-US': {
        language: 'en-US',
        format: 'vtt',
        url: 'https://example.test/captions.vtt?signature=private',
      },
    },
    subtitles: { es: { language: 'es-ES', format: 'ass', url: 'https://example.test/es.ass' } },
  });
  assert.equal(resources.length, 1);
  const session = await loadSession('EP', 'ABC123', 'en-GB', resources, async () => vtt);
  assert.ok(dialogueTrack(session));
  assert.equal(session.tracks[0]!.resource, 'https://example.test/captions.vtt');
  assert.ok(!JSON.stringify(session).includes('signature'));
  parseSession(session);
  assert.throws(() => parseSession({ ...session, version: 'https://evil' }));
  const unavailable = await loadSession('EP', 'ABC123', 'en-US', resources, async () => {
    throw new Error('CORS denied');
  });
  assert.equal(unavailable.tracks.length, 0);
});
void test('protocol accepts trusted UI/content identities, rejects forged origins and invalid reports', async () => {
  assert.ok(trustedUi({ id: 'abc', url: 'chrome-extension://abc/popup.html' }, 'abc'));
  assert.equal(
    trustedUi({ id: 'abc', url: 'https://www.crunchyroll.com/popup.html' }, 'abc'),
    false,
  );
  assert.ok(
    trustedContent(
      {
        id: 'abc',
        url: 'https://static.crunchyroll.com/vilos-v2/web/vilos/player.html',
        tab: { id: 1 },
        frameId: 2,
        documentId: 'doc',
      },
      'abc',
    ),
  );
  assert.equal(
    trustedContent(
      { id: 'abc', url: 'https://evil.test', tab: { id: 1 }, frameId: 2, documentId: 'doc' },
      'abc',
    ),
    false,
  );
  assert.throws(() => parseTarget({ tabId: -1 }));
  const engine = new FilterEngine(freshState());
  engine.setSession(await fixture());
  await engine.rebuild();
  const snapshot = { ...engine.snapshot(), hasMedia: false };
  parseSnapshot(snapshot);
  assert.throws(() =>
    parseSnapshot({ ...snapshot, occurrences: [{ ...snapshot.occurrences[0], id: 'injected' }] }),
  );
});

void test('UI-only preferences and rule edits retain an active mute until the replacement schedule is ready', async (t) => {
  const media = new FakeMedia();
  const state = freshState();
  const session = await fixture();
  const engine = new FilterEngine(state);
  engine.attach(media);
  t.after(() => engine.detach());
  engine.setSession(session);
  await engine.rebuild();
  media.currentTime = 1;
  media.dispatchEvent(new Event('timeupdate'));
  assert.equal(media.muted, true);
  state.settings.reveal = true;
  engine.update(state);
  assert.equal(media.muted, true);
  await engine.rebuild();
  assert.equal(media.muted, true);
  state.settings.custom = ['perfectly benign'];
  engine.update(state);
  assert.equal(media.muted, true);
  await engine.rebuild();
  assert.equal(engine.snapshot().occurrences.length, 4);
  state.settings.enabled = false;
  engine.update(state);
  assert.equal(media.muted, false);
});

void test('track/occurrence identities survive signed URL and CDN changes, but not language/cue changes', async () => {
  const resource = {
    language: 'en-US',
    kind: 'captions' as const,
    format: 'ass' as const,
    key: 'en-US',
    url: 'https://one.example.test/a.ass?signature=one',
  };
  const first = await loadSession('EP', 'VERSION', 'en-US', [resource], async () => ass);
  const second = await loadSession(
    'EP',
    'VERSION',
    'en-US',
    [{ ...resource, url: 'https://two.example.test/b.ass?signature=two' }],
    async () => ass,
  );
  const a = await analyse(first, freshState()),
    b = await analyse(second, freshState());
  assert.deepEqual(
    a.map((row) => row.id),
    b.map((row) => row.id),
  );
  const third = await loadSession(
    'EP',
    'VERSION',
    'en-US',
    [{ ...resource, language: 'en-GB', key: 'en-GB' }],
    async () => ass,
  );
  assert.notEqual(third.tracks[0]!.id, first.tracks[0]!.id);
});

void test('renderer failures report a subtitle error while verified CC audio remains independently available', async (t) => {
  const media = new FakeMedia();
  const session = await fixture();
  const engine = new FilterEngine(freshState());
  engine.attach(media);
  t.after(() => engine.detach());
  engine.setSession(session);
  await engine.rebuild();
  let restored = false;
  engine.setRenderer({
    trackId: session.tracks[0]!.id,
    language: 'en-US',
    apply: () => {
      throw new Error('fixture renderer failed');
    },
    restore: () => {
      restored = true;
    },
  });
  assert.equal(engine.snapshot().subtitles.phase, 'error');
  assert.equal(engine.snapshot().audio.phase, 'active');
  assert.equal(restored, true);
});

void test('ambiguous subtitle resource identity never establishes English selection', async () => {
  const session = await fixture();
  const url = 'https://example.test/captions.ass?language=en';
  session.available = [
    {
      resource: 'https://example.test/captions.ass',
      requestUrl: url,
      language: 'en-US',
      format: 'ass',
      kind: 'captions',
    },
  ];
  assert.equal(selectedSubtitleResource(session, url)?.language, 'en-US');
  session.available.push({ ...session.available[0]!, language: 'es-ES', kind: 'subtitles' });
  assert.equal(selectedSubtitleResource(session, url), null);
  assert.equal(selectedSubtitleResource(session, url + '&other=true'), null);
});
