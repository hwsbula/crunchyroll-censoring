import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackup, LIMITS, STORAGE_KEY } from '../../src/shared/model.ts';
import type { Note, NoteInput } from '../../src/shared/model.ts';
import { NoteRepository } from '../../src/shared/repository.ts';
import type { StoragePort } from '../../src/shared/repository.ts';

class MemoryStorage implements StoragePort {
  values: Record<string, unknown> = {};
  writes = 0;
  failGet = false;
  failSet = false;
  async get(key: string): Promise<Record<string, unknown>> {
    if (this.failGet) throw new Error('read failed');
    await Promise.resolve();
    return { [key]: structuredClone(this.values[key]) };
  }
  async set(items: Record<string, unknown>): Promise<void> {
    if (this.failSet) throw new Error('quota exceeded');
    await Promise.resolve();
    this.values = { ...this.values, ...structuredClone(items) };
    this.writes += 1;
  }
}

const input = (page = 'one'): NoteInput => ({
  url: `https://example.com/${page}`,
  title: `Page ${page}`,
  text: 'Keep this note',
  quote: '',
});
const imported = (page: string, updatedAt = 100): Note => ({
  ...input(page),
  createdAt: 10,
  updatedAt,
  revision: `import-${page}`,
});
function fixture() {
  const storage = new MemoryStorage();
  let sequence = 0;
  const repo = new NoteRepository(
    storage,
    () => 100,
    () => `revision-${++sequence}`,
  );
  return { storage, repo };
}

void test('fresh storage initializes once and missing pages return null', async () => {
  const { storage, repo } = fixture();
  assert.equal((await repo.getState()).schemaVersion, 1);
  assert.equal(await repo.getNote(input().url), null);
  assert.equal(storage.writes, 1);
});

void test('create and update preserve creation date and rotate revisions', async () => {
  const { repo } = fixture();
  const original = await repo.save(input(), null);
  const updated = await repo.save({ ...input(), text: 'An updated note' }, original.revision);
  assert.equal(updated.createdAt, original.createdAt);
  assert.notEqual(updated.revision, original.revision);
  assert.equal((await repo.getState()).notes.length, 1);
  assert.equal((await repo.getNote(`${input().url}#section`))?.text, 'An updated note');
});

void test('editing a future-dated imported note never moves its saved date backward', async () => {
  const { repo } = fixture();
  await repo.import(createBackup([imported('future', 1000)]));
  const original = await repo.getNote(input('future').url);
  assert.ok(original);
  const updated = await repo.save(
    { ...original, text: 'Edited after importing' },
    original.revision,
  );
  assert.equal(updated.updatedAt, original.updatedAt);
  assert.notEqual(updated.revision, original.revision);
});

void test('a new repository instance reads persisted notes after worker restart', async () => {
  const { storage, repo } = fixture();
  const original = await repo.save(input(), null);
  const restarted = new NoteRepository(storage);
  assert.deepEqual(await restarted.getNote(original.url), original);
});

void test('concurrent writes to different pages do not lose notes', async () => {
  const { repo } = fixture();
  await Promise.all(
    Array.from({ length: 12 }, (_, index) => repo.save(input(String(index)), null)),
  );
  assert.equal((await repo.getState()).notes.length, 12);
});

void test('concurrent creation of the same page yields one success and one conflict', async () => {
  const { repo } = fixture();
  const results = await Promise.allSettled([
    repo.save(input(), null),
    repo.save({ ...input(), text: 'Other draft' }, null),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected');
  assert.equal((rejected.reason as { code: string }).code, 'CONFLICT');
  assert.equal((await repo.getState()).notes.length, 1);
});

void test('stale edits are rejected and the newer note survives', async () => {
  const { repo } = fixture();
  const original = await repo.save(input(), null);
  const newer = await repo.save({ ...input(), text: 'Newer draft' }, original.revision);
  await assert.rejects(repo.save({ ...input(), text: 'Stale draft' }, original.revision), {
    code: 'CONFLICT',
  });
  assert.deepEqual(await repo.getNote(original.url), newer);
});

void test('deletion checks the latest note revision', async () => {
  const { repo } = fixture();
  const note = await repo.save(input(), null);
  await assert.rejects(repo.delete(note.url, 'stale'), { code: 'CONFLICT' });
  assert.equal(await repo.delete(note.url, note.revision), null);
  assert.equal(await repo.getNote(note.url), null);
});

void test('clear cannot discard changes made after its confirmation snapshot', async () => {
  const { repo } = fixture();
  const state = await repo.getState();
  await repo.save(input(), null);
  await assert.rejects(repo.clear(state.revision), { code: 'CONFLICT' });
  assert.equal((await repo.getState()).notes.length, 1);
  await repo.clear((await repo.getState()).revision);
  assert.equal((await repo.getState()).notes.length, 0);
});

void test('a failed storage write reports failure, preserves data, and does not poison the queue', async () => {
  const { storage, repo } = fixture();
  const original = await repo.save(input(), null);
  const before = structuredClone(storage.values);
  storage.failSet = true;
  await assert.rejects(repo.save({ ...input(), text: 'Not saved' }, original.revision), {
    code: 'STORAGE_ERROR',
  });
  assert.deepEqual(storage.values, before);
  storage.failSet = false;
  await repo.save({ ...input(), text: 'Saved after retry' }, original.revision);
  assert.equal((await repo.getNote(original.url))?.text, 'Saved after retry');
});

void test('a failed storage read reports failure and a retry can succeed', async () => {
  const { storage, repo } = fixture();
  storage.failGet = true;
  await assert.rejects(repo.getState(), { code: 'STORAGE_ERROR' });
  assert.equal(storage.writes, 0);
  storage.failGet = false;
  assert.equal((await repo.getState()).notes.length, 0);
});

void test('unknown schema versions and corrupted records are left untouched', async () => {
  for (const value of [
    { schemaVersion: 99, revision: 'future', notes: [] },
    { schemaVersion: 1, revision: 'bad', notes: [{ url: 'javascript:alert(1)' }] },
  ]) {
    const { storage, repo } = fixture();
    storage.values[STORAGE_KEY] = value;
    const before = structuredClone(storage.values);
    await assert.rejects(repo.getState(), { code: 'CORRUPT_DATA' });
    await assert.rejects(repo.save(input(), null), { code: 'CORRUPT_DATA' });
    assert.deepEqual(storage.values, before);
    assert.equal(storage.writes, 0);
  }
});

void test('the note limit rejects new pages while still allowing edits', async () => {
  const { repo } = fixture();
  await repo.import(
    createBackup(Array.from({ length: LIMITS.notes }, (_, index) => imported(String(index)))),
  );
  await assert.rejects(repo.save(input('extra'), null), { code: 'LIMIT_REACHED' });
  const existing = await repo.getNote(input('0').url);
  assert.ok(existing);
  await repo.save({ ...existing, text: 'Can still edit' }, existing.revision);
  assert.equal((await repo.getState()).notes.length, LIMITS.notes);
});

void test('import merges newer records, keeps local ties, and gives imported records fresh revisions', async () => {
  const { repo } = fixture();
  const old = await repo.save(input('one'), null);
  const newer = { ...imported('one', 200), text: 'Imported newer note' };
  const summary = await repo.import(createBackup([newer, imported('two')]));
  assert.deepEqual(summary, { added: 1, updated: 1, kept: 0, total: 2 });
  const current = await repo.getNote(old.url);
  assert.equal(current?.text, newer.text);
  assert.notEqual(current?.revision, newer.revision);
  const tie = await repo.import(createBackup([{ ...newer, text: 'Should not replace the tie' }]));
  assert.equal(tie.kept, 1);
  assert.equal((await repo.getNote(old.url))?.text, newer.text);
});

void test('duplicate backup URLs merge once using the newest timestamp', async () => {
  const { repo } = fixture();
  const summary = await repo.import(
    createBackup([
      { ...imported('one', 100), text: 'Older' },
      { ...imported('one', 200), url: `${input('one').url}#part`, text: 'Newer' },
    ]),
  );
  assert.deepEqual(summary, { added: 1, updated: 0, kept: 0, total: 1 });
  assert.equal((await repo.getNote(input('one').url))?.text, 'Newer');
});

void test('an over-capacity merge is atomic and preserves all existing notes', async () => {
  const { storage, repo } = fixture();
  await repo.save(input('local'), null);
  const before = structuredClone(storage.values);
  await assert.rejects(
    repo.import(
      createBackup(Array.from({ length: LIMITS.notes }, (_, index) => imported(String(index)))),
    ),
    { code: 'LIMIT_REACHED' },
  );
  assert.deepEqual(storage.values, before);
});

void test('failed import storage writes cannot partly merge a backup', async () => {
  const { storage, repo } = fixture();
  await repo.save(input('local'), null);
  const before = structuredClone(storage.values);
  storage.failSet = true;
  await assert.rejects(repo.import(createBackup([imported('new')])), { code: 'STORAGE_ERROR' });
  assert.deepEqual(storage.values, before);
});

void test('serialized backup size is bounded before saving any part of an oversized merge', async () => {
  const { storage, repo } = fixture();
  await repo.save(input('local'), null);
  const before = structuredClone(storage.values);
  // JSON escapes these control characters to six bytes each. Character limits
  // alone would allow a state too large to import after exporting it.
  const notes = Array.from({ length: 130 }, (_, index) => ({
    ...imported(String(index)),
    text: '\u0001'.repeat(LIMITS.text),
    quote: '\u0001'.repeat(LIMITS.quote),
  }));
  await assert.rejects(repo.import(createBackup(notes)), { code: 'LIMIT_REACHED' });
  assert.deepEqual(storage.values, before);
});
