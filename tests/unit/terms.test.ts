import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILTINS, TERM_GROUPS } from '../../src/core/terms.ts';
import {
  activeTerms,
  canonicalTerm,
  DEFAULT_SETTINGS,
  freshState,
  normalizeTerms,
  parseSettings,
  parseState,
} from '../../src/core/settings.ts';
import { findMatches, redact } from '../../src/core/matcher.ts';
import { analyse, intervalsFor, mayFilterAudio } from '../../src/core/engine.ts';
import { parseCaptions } from '../../src/core/captions.ts';
import type { Session } from '../../src/core/types.ts';

void test('catalog keeps legacy terms, unique literal categories and canonical bounded entries', () => {
  const legacy =
    'ass|asshole|assholes|bastard|bastards|bitch|bitches|bullshit|crap|damn|damned|dick|dicks|fuck|fucked|fucker|fuckers|fucking|hell|motherfucker|motherfuckers|piss|pissed|shit|shits|shitty|son of a bitch'.split(
      '|',
    );
  assert.ok(legacy.every((term) => BUILTINS.includes(term)));
  assert.equal(TERM_GROUPS.length, 6);
  assert.equal(
    new Set(TERM_GROUPS.flatMap((group) => group.terms)).size,
    TERM_GROUPS.flatMap((group) => group.terms).length,
  );
  assert.ok(BUILTINS.length > 1000);
  for (const term of BUILTINS) {
    assert.equal(canonicalTerm(term), term);
    assert.ok(term.length > 0 && term.length <= 100);
    assert.equal(findMatches(term, BUILTINS)[0]?.term, term, term);
  }
});

void test('anime-style fight, comedy, romance and serious dialogue cover the expanded defaults', () => {
  const cases: Array<[string, string]> = [
    ['You moronic bastard!', 'You **** ****!'],
    ['Quit being a coward, you dumbass.', 'Quit being a ****, you ****.'],
    ['Those motherfuckers shat themselves.', 'Those **** **** themselves.'],
    ['That cocksucker is a shithead.', 'That **** is a ****.'],
    ['Stop staring at my breasts, pervert!', 'Stop staring at my ****, ****!'],
    ['Testicles, vulvae, penises and clitorises.', '****, ****, **** and ****.'],
    ['She was sexually assaulted by the rapist.', 'She was **** by the ****.'],
    ['They were masturbating, not making love.', 'They were ****, not ****.'],
    ['Bloody bollocks, you wankers!', '**** ****, you ****!'],
    ['Those faggots called him a nigger.', 'Those **** called him a ****.'],
    ['You stupid idiot! That loser is a creep.', 'You **** ****! That **** is a ****.'],
    ['You son\n of   a bitch! Sonofabitch!', 'You ****! ****!'],
    ['Mother‑fuckers! Fuckin’ hell. F*cking jerks.', '****! **** ****. **** ****.'],
  ];
  for (const [text, expected] of cases)
    assert.equal(redact(text, findMatches(text, activeTerms(DEFAULT_SETTINGS))), expected, text);
});

void test('whole-word boundaries protect benign dialogue; ambiguous exact words remain explicit choices', () => {
  const benign =
    'The assassin left class through the passage to the cockpit. Grapes, analysis, therapy, Scunthorpe, breastplate, cockroach, shell, a screwdriver and a grapevine.';
  assert.deepEqual(findMatches(benign, BUILTINS), []);
  assert.deepEqual(
    findMatches('gay lesbian transgender Japanese black white kill die chest hand sword', BUILTINS),
    [],
  );
  assert.equal(
    redact(
      'Dick bought balls and a breast of chicken.',
      findMatches('Dick bought balls and a breast of chicken.', BUILTINS),
    ),
    '**** bought **** and a **** of chicken.',
  );
  assert.equal(
    redact('screw the lid on; screw you', findMatches('screw the lid on; screw you', BUILTINS)),
    'screw the lid on; ****',
  );
});

void test('every category can be disabled and persisted independently of the 250 custom-term bound', () => {
  const settings = parseSettings({
    ...DEFAULT_SETTINGS,
    disabledBuiltins: [...BUILTINS],
    custom: ['space wizard'],
  });
  assert.deepEqual(activeTerms(settings), ['space wizard']);
  assert.equal(
    parseState({ ...freshState(), settings }).settings.disabledBuiltins.length,
    BUILTINS.length,
  );
  assert.throws(() => normalizeTerms(Array.from({ length: 251 }, (_, n) => `custom ${n}`)), /250/);
  assert.throws(
    () => parseSettings({ ...DEFAULT_SETTINGS, disabledBuiltins: ['unknown literal'] }),
    /Unknown/,
  );
  const legacy = {
    ...freshState(),
    revision: 8,
    settings: { ...DEFAULT_SETTINGS, custom: ['space wizard'], disabledBuiltins: ['hell', 'damn'] },
    exceptions: [`${'a'.repeat(64)}.${'b'.repeat(64)}.0.4.${'c'.repeat(64)}`],
  };
  assert.deepEqual(parseState(legacy), legacy);
  assert.ok(activeTerms(parseState(legacy).settings).includes('idiot'));
  assert.ok(!activeTerms(parseState(legacy).settings).includes('hell'));
});

void test('new terms schedule whole English CC cues; Ignore retains another match and Japanese audio is untouched', async () => {
  const document = await parseCaptions(
    'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nYou idiot, stop staring at her breasts!\n',
    'vtt',
  );
  const session: Session = {
    episode: 'NEW',
    version: 'DUB',
    audioLanguage: 'en-US',
    tracks: [
      {
        id: 'a'.repeat(64),
        resource: 'https://example.test/cc.vtt',
        version: 'DUB',
        language: 'en-US',
        kind: 'captions',
        document,
      },
    ],
  };
  const state = freshState();
  const occurrences = await analyse(session, state);
  assert.deepEqual(
    occurrences.map((o) => o.term),
    ['idiot', 'breasts'],
  );
  assert.equal(mayFilterAudio(session, state), true);
  state.exceptions = [occurrences[0]!.id];
  const ignored = await analyse(session, state);
  assert.equal(intervalsFor(ignored, session.tracks[0]!, state).length, 1);
  state.settings.disabledBuiltins = ['breasts'];
  assert.equal(intervalsFor(await analyse(session, state), session.tracks[0]!, state).length, 0);
  state.settings.disabledBuiltins = [];
  state.exceptions = [];
  assert.equal(intervalsFor(await analyse(session, state), session.tracks[0]!, state).length, 2);
  session.audioLanguage = 'ja-JP';
  session.tracks[0]!.kind = 'subtitles';
  assert.equal(mayFilterAudio(session, state), false);
  assert.equal((await analyse(session, state)).length, 2);
  session.tracks[0]!.language = 'es-ES';
  assert.deepEqual(await analyse(session, state), []);
});
