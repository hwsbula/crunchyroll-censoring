import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalUrl,
  createBackup,
  LIMITS,
  parseBackup,
  parseNote,
  parseNoteInput,
  parseState,
} from '../../src/shared/model.ts';
import type { Note } from '../../src/shared/model.ts';
import { isTrustedSender, parseRequest } from '../../src/shared/protocol.ts';

const note: Note = {
  url: 'https://example.com/article',
  title: 'Article',
  text: 'Remember this',
  quote: '',
  createdAt: 10,
  updatedAt: 20,
  revision: 'note-v1',
};

void test('page identity removes fragments while preserving meaningful query parameters', () => {
  assert.equal(
    canonicalUrl('https://EXAMPLE.com:443/article?view=full#section'),
    'https://example.com/article?view=full',
  );
  assert.notEqual(
    canonicalUrl('https://example.com/?page=1'),
    canonicalUrl('https://example.com/?page=2'),
  );
});

void test('only HTTP and HTTPS pages without embedded credentials are accepted', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,test',
    'file:///tmp/test',
    'chrome://settings',
    'https://user:password@example.com/',
    'not a URL',
  ]) {
    assert.throws(() => canonicalUrl(value), { code: 'UNSUPPORTED_PAGE' });
  }
  assert.equal(canonicalUrl('http://localhost:8080/'), 'http://localhost:8080/');
});

void test('protected Chrome Web Store locations are rejected without rejecting lookalike normal sites', () => {
  for (const value of [
    'https://chromewebstore.google.com/detail/test',
    'https://chrome.google.com/webstore',
    'https://chrome.google.com/webstore/detail/test',
  ]) {
    assert.throws(() => canonicalUrl(value), { code: 'UNSUPPORTED_PAGE' });
  }
  assert.equal(
    canonicalUrl('https://chrome.google.com/webstore-help'),
    'https://chrome.google.com/webstore-help',
  );
});

void test('overlong URLs are rejected before and after URL encoding', () => {
  assert.throws(() => canonicalUrl(`https://example.com/${'a'.repeat(LIMITS.url)}`), {
    code: 'INVALID_INPUT',
  });
  assert.throws(() => canonicalUrl(`https://example.com/${'\u00e9'.repeat(500)}`), {
    code: 'INVALID_INPUT',
  });
});

void test('note input is normalized and blank titles receive a useful hostname', () => {
  assert.deepEqual(
    parseNoteInput({
      ...note,
      title: ' ',
      text: ' note ',
      quote: ' quote ',
      url: `${note.url}#part`,
    }),
    {
      url: note.url,
      title: 'example.com',
      text: 'note',
      quote: 'quote',
    },
  );
});

void test('empty notes are rejected but a quote-only note is accepted', () => {
  assert.throws(() => parseNoteInput({ ...note, text: ' ', quote: '\n' }), {
    code: 'INVALID_INPUT',
  });
  assert.equal(parseNoteInput({ ...note, text: '', quote: 'A useful quote' }).text, '');
});

void test('all content fields enforce their documented limits', () => {
  for (const [field, limit] of [
    ['title', LIMITS.title],
    ['text', LIMITS.text],
    ['quote', LIMITS.quote],
  ] as const) {
    assert.throws(() => parseNoteInput({ ...note, [field]: 'x'.repeat(limit + 1) }), {
      code: 'INVALID_INPUT',
    });
    assert.equal(parseNoteInput({ ...note, [field]: 'x'.repeat(limit) })[field].length, limit);
  }
});

void test('HTML-shaped content is retained as plain data and unknown fields are discarded', () => {
  const text = '<img src=x onerror=alert(1)><script>bad()</script>';
  const parsed = parseNoteInput({ ...note, text, injected: 'ignored' });
  assert.equal(parsed.text, text);
  assert.equal(Object.hasOwn(parsed, 'injected'), false);
});

void test('saved note dates and revisions must be valid', () => {
  for (const bad of [
    { updatedAt: 5 },
    { createdAt: -1 },
    { updatedAt: Infinity },
    { updatedAt: 1.5 },
    { revision: '' },
  ]) {
    assert.throws(() => parseNote({ ...note, ...bad }), { code: 'INVALID_INPUT' });
  }
});

void test('state rejects unknown versions and duplicate canonical page identities', () => {
  assert.throws(() => parseState({ schemaVersion: 2, revision: 'state-v1', notes: [] }), {
    code: 'CORRUPT_DATA',
  });
  assert.throws(
    () =>
      parseState({
        schemaVersion: 1,
        revision: 'state-v1',
        notes: [note, { ...note, url: `${note.url}#part` }],
      }),
    { code: 'CORRUPT_DATA' },
  );
});

void test('exported backups round-trip through strict validation', () => {
  const backup = createBackup([note]);
  assert.deepEqual(parseBackup(JSON.parse(JSON.stringify(backup))), backup);
});

void test('foreign, over-limit, and malformed backups are rejected', () => {
  const backup = createBackup([note]);
  for (const value of [
    null,
    [],
    { ...backup, format: 'another-app' },
    { ...backup, version: 2 },
    { ...backup, exportedAt: 'not a date' },
    { ...backup, notes: Array.from({ length: LIMITS.notes + 1 }, () => note) },
  ]) {
    assert.throws(() => parseBackup(value), { code: 'INVALID_INPUT' });
  }
});

void test('save messages require explicit creation or existing-note revision', () => {
  const create = parseRequest({ type: 'note:save', note, expectedRevision: null });
  assert.equal(create.type, 'note:save');
  assert.throws(() => parseRequest({ type: 'note:save', note }), { code: 'INVALID_INPUT' });
  assert.throws(() => parseRequest({ type: 'note:save', note, expectedRevision: '' }), {
    code: 'INVALID_INPUT',
  });
});

void test('unknown request routes, invalid tabs, and invalid URLs are rejected', () => {
  assert.throws(() => parseRequest({ type: 'execute-arbitrary-code' }), { code: 'INVALID_INPUT' });
  for (const tabId of [-1, 1.5, '1', NaN, null]) {
    assert.throws(() => parseRequest({ type: 'selection:capture', tabId, url: note.url }), {
      code: 'INVALID_INPUT',
    });
  }
  assert.throws(() => parseRequest({ type: 'note:get', url: 'javascript:alert(1)' }), {
    code: 'UNSUPPORTED_PAGE',
  });
});

void test('import messages enforce a byte limit independently of shape validation', () => {
  assert.throws(
    () =>
      parseRequest({
        type: 'notes:import',
        backup: { ...createBackup([]), padding: 'x'.repeat(LIMITS.importBytes) },
      }),
    { code: 'INVALID_INPUT' },
  );
});

void test('privileged messages are limited to the known extension pages', () => {
  const id = 'abcdefghijklmnopabcdefghijklmnop';
  for (const page of ['popup.html', 'options.html']) {
    assert.equal(isTrustedSender({ id, url: `chrome-extension://${id}/${page}` }, id), true);
  }
  for (const sender of [
    {},
    { id },
    { id, url: 'https://example.com/' },
    { id: 'wrong', url: `chrome-extension://${id}/popup.html` },
    { id, url: `chrome-extension://${id}/unknown.html` },
    { id, url: `chrome-extension://${id}.evil/popup.html` },
    { id, url: 'invalid' },
  ]) {
    assert.equal(isTrustedSender(sender, id), false);
  }
});
