import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SettingsSync,
  syncBundle,
  readSyncBundle,
  SYNC_META,
  SYNC_HEAD,
  SYNC_PREFIX,
} from '../../src/shared/settings-sync.ts';
import { SettingsRepository } from '../../src/shared/repository.ts';
import { BUILTINS, DEFAULT_SETTINGS, freshState, STORAGE_KEY } from '../../src/core/settings.ts';
import { readSettingsBackup, settingsBackup } from '../../src/core/backup.ts';
import type { Settings } from '../../src/core/types.ts';

function memory() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (key: string) => ({ [key]: structuredClone(data[key]) }),
    set: async (items: Record<string, unknown>) => {
      Object.assign(data, structuredClone(items));
    },
  };
}
function cloud() {
  const data: Record<string, unknown> = {};
  let fail = false;
  return {
    data,
    fail: (value: boolean) => {
      fail = value;
    },
    read: async () => structuredClone(data),
    set: async (items: Record<string, unknown>) => {
      if (fail) throw new Error('MAX_WRITE_OPERATIONS_PER_MINUTE exceeded');
      for (const [key, value] of Object.entries(items))
        assert.ok(key.length + Buffer.byteLength(JSON.stringify(value)) <= 8192);
      const next = { ...data, ...structuredClone(items) };
      assert.ok(
        Object.entries(next).reduce(
          (n, [k, v]) => n + k.length + Buffer.byteLength(JSON.stringify(v)),
          0,
        ) <= 102400,
      );
      Object.assign(data, next);
    },
    remove: async (keys: string[]) => {
      for (const key of keys) delete data[key];
    },
  };
}
async function put(remote: ReturnType<typeof cloud>, settings: Settings) {
  const bundle = await syncBundle(settings);
  await remote.set(bundle.items);
  await remote.set({ [SYNC_HEAD]: bundle.head });
  return bundle;
}
function device(remote: ReturnType<typeof cloud>, local = memory()) {
  const repo = new SettingsRepository(local);
  const applied: number[] = [];
  const sync = new SettingsSync(repo, local, remote, async (state) => {
    applied.push(state.revision);
  });
  return { local, repo, sync, applied };
}

void test('legacy migration shards the full disabled catalogue; fresh device receives settings without exceptions', async () => {
  const remote = cloud();
  const a = device(remote);
  const settings = {
    ...DEFAULT_SETTINGS,
    mode: 'japanese' as const,
    custom: ['space wizard', '風の剣'],
    disabledBuiltins: [...BUILTINS],
  };
  const exception = `${'a'.repeat(64)}.${'b'.repeat(64)}.0.4.${'c'.repeat(64)}`;
  a.local.data[STORAGE_KEY] = { ...freshState(), settings, exceptions: [exception] };
  await a.sync.start();
  assert.deepEqual((await a.repo.read()).settings, settings);
  assert.deepEqual((await a.repo.read()).exceptions, [exception]);
  assert.ok(Object.keys(remote.data).length > 2);
  assert.ok(!JSON.stringify(remote.data).includes(exception));
  const b = device(remote);
  await b.sync.start();
  assert.deepEqual((await b.repo.read()).settings, settings);
  assert.deepEqual((await b.repo.read()).exceptions, []);
  assert.equal((await b.sync.getStatus()).phase, 'ready');
});
void test('empty fresh device does not upload defaults; delayed head/chunks never apply partial settings', async () => {
  const remote = cloud();
  const a = device(remote);
  await a.sync.start();
  assert.deepEqual(remote.data, {});
  const bundle = await syncBundle({
    ...DEFAULT_SETTINGS,
    custom: ['safe custom'],
    mode: 'japanese',
  });
  await remote.set({ [SYNC_HEAD]: bundle.head });
  await a.sync.refresh();
  assert.match((await a.sync.getStatus()).message, /Waiting for the complete/);
  assert.deepEqual((await a.repo.read()).settings, DEFAULT_SETTINGS);
  await remote.set(bundle.items);
  await a.sync.refresh();
  assert.deepEqual((await a.repo.read()).settings, bundle.settings);
  const key = Object.keys(bundle.items)[0]!;
  remote.data[key] = 'tampered';
  await a.sync.refresh();
  assert.equal((await a.sync.getStatus()).phase, 'error');
  assert.deepEqual((await a.repo.read()).settings, bundle.settings);
});
void test('complete remote updates apply and broadcast; stale options cannot overwrite them', async () => {
  const remote = cloud();
  const a = device(remote);
  await a.sync.start();
  const original = await a.repo.read();
  const bundle = await put(remote, {
    ...DEFAULT_SETTINGS,
    custom: ['remote phrase'],
    enabled: false,
  });
  await a.sync.refresh();
  assert.deepEqual((await a.repo.read()).settings, bundle.settings);
  assert.deepEqual(a.applied, [1]);
  await assert.rejects(
    a.sync.save(DEFAULT_SETTINGS, original.revision),
    /changed in another window/,
  );
  await a.sync.refresh();
  assert.deepEqual(a.applied, [1]);
});
void test('quota failure preserves local edits, pending upload retries after worker restart', async () => {
  const remote = cloud();
  const a = device(remote);
  await a.sync.start();
  await a.sync.save(DEFAULT_SETTINGS, 0);
  remote.fail(true);
  await a.sync.patch({ mode: 'japanese' });
  assert.equal((await a.repo.read()).settings.mode, 'japanese');
  assert.equal((await a.sync.getStatus()).phase, 'error');
  remote.fail(false);
  const restarted = device(remote, a.local);
  await restarted.sync.start();
  assert.equal((await readSyncBundle(remote.data))!.settings.mode, 'japanese');
  assert.equal((await restarted.sync.getStatus()).phase, 'ready');
});
void test('independent pending edits and existing legacy preferences surface a conflict instead of overwriting', async () => {
  const remote = cloud();
  const a = device(remote);
  await a.sync.start();
  await a.sync.save(DEFAULT_SETTINGS, 0);
  remote.fail(true);
  await a.sync.patch({ mode: 'japanese' });
  remote.fail(false);
  await put(remote, { ...DEFAULT_SETTINGS, custom: ['another device'] });
  await a.sync.refresh();
  assert.equal((await a.sync.getStatus()).phase, 'conflict');
  assert.equal((await a.repo.read()).settings.mode, 'japanese');
  await a.sync.resolve('remote');
  assert.deepEqual((await a.repo.read()).settings.custom, ['another device']);
  const legacy = device(remote);
  legacy.local.data[STORAGE_KEY] = {
    ...freshState(),
    settings: { ...DEFAULT_SETTINGS, custom: ['legacy local'] },
  };
  await legacy.sync.start();
  assert.equal((await legacy.sync.getStatus()).phase, 'conflict');
  await legacy.sync.resolve('local');
  assert.deepEqual((await readSyncBundle(remote.data))!.settings.custom, ['legacy local']);
});
void test('large preferences still save locally and export; native sync is bounded, unsupported formats are retained', async () => {
  const remote = cloud();
  const a = device(remote);
  await a.sync.start();
  const settings = {
    ...DEFAULT_SETTINGS,
    custom: Array.from({ length: 250 }, (_, i) => '界'.repeat(96) + i),
  };
  await a.sync.save(settings, 0);
  assert.equal((await a.repo.read()).settings.custom.length, 250);
  assert.match((await a.sync.getStatus()).message, /size limit/);
  assert.deepEqual(readSettingsBackup(settingsBackup(settings)), settings);
  assert.deepEqual(remote.data, {});
  remote.data[SYNC_HEAD] = { version: 99 };
  await a.sync.refresh();
  assert.equal((await a.sync.getStatus()).phase, 'error');
  assert.deepEqual(remote.data[SYNC_HEAD], { version: 99 });
  const b = device(cloud());
  b.local.data[SYNC_META] = { version: 99 };
  await b.sync.start();
  await b.sync.patch({ enabled: false });
  assert.deepEqual(b.local.data[SYNC_META], { version: 99 });
  assert.equal((await b.repo.read()).settings.enabled, false);
});
void test('local-only mode, serialized patches, garbage bounds and confirmed cloud removal keep local preferences', async () => {
  const remote = cloud();
  const a = device(remote);
  await a.sync.start();
  await a.sync.toggle(false);
  await a.sync.patch({ enabled: false });
  assert.deepEqual(remote.data, {});
  await a.sync.toggle(true);
  await Promise.all([a.sync.patch({ mode: 'japanese' }), a.sync.patch({ reveal: true })]);
  for (let n = 0; n < 12; n++) await a.sync.patch({ reveal: n % 2 === 0 });
  assert.ok(Object.keys(remote.data).length < 10);
  assert.equal((await a.repo.read()).settings.mode, 'japanese');
  remote.data.otherFeature = true;
  const before = (await a.repo.read()).settings;
  await a.sync.clear();
  assert.equal(
    Object.keys(remote.data).some((k) => k.startsWith(SYNC_PREFIX)),
    false,
  );
  assert.equal(remote.data.otherFeature, true);
  assert.deepEqual((await a.repo.read()).settings, before);
  await a.sync.refresh();
  assert.equal((await a.sync.getStatus()).enabled, false);
});
void test('backup format validates literal settings without importing logs, exceptions or executable content', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    custom: ['<img src=x onerror=alert(1)>', 'literal.*term'],
  };
  const text = settingsBackup(settings);
  assert.deepEqual(readSettingsBackup(text), settings);
  assert.ok(!text.includes('exceptions'));
  for (const bad of [
    'not JSON',
    JSON.stringify({ version: 99 }),
    JSON.stringify({
      format: 'crunchyroll-censoring-settings',
      version: 1,
      settings: { ...settings, mode: 'invalid' },
    }),
    ' '.repeat(512001),
  ])
    assert.throws(() => readSettingsBackup(bad));
});
