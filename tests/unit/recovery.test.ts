import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { ConnectionRecovery, retryableInitialization } from '../../src/shared/recovery.ts';
import { CaptionDownloadError, CaptionLoader } from '../../src/integration/caption-loader.ts';
import type { Resource } from '../../src/integration/metadata.ts';
import type { Session } from '../../src/core/types.ts';

const vtt = await readFile(new URL('../fixtures/english.vtt', import.meta.url), 'utf8');
const resource: Resource = {
  language: 'en-US',
  kind: 'captions',
  format: 'vtt',
  key: 'en-US',
  url: 'https://example.test/synthetic.vtt',
};
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await delay(5);
  }
  assert.ok(check(), 'Recovery did not complete within the test deadline.');
}

void test('worker initialization shares attempts, retries failures and caches success', async () => {
  let calls = 0;
  const ready = retryableInitialization(async () => {
    if (++calls === 1) throw new Error('Synthetic temporary storage failure');
  });
  const first = ready();
  assert.equal(ready(), first);
  await assert.rejects(first);
  await Promise.all([ready(), ready()]);
  await ready();
  assert.equal(calls, 2);
});

void test('registration retries a timeout, ignores its late result and stops after success', async () => {
  let calls = 0;
  let late!: (value: number) => void;
  const accepted: number[] = [];
  const recovery = new ConnectionRecovery(
    () => {
      calls++;
      return calls === 1
        ? new Promise<number>((resolve) => {
            late = resolve;
          })
        : Promise.resolve(2);
    },
    (value) => accepted.push(value),
    [1, 1],
    20,
  );
  try {
    recovery.start();
    recovery.start();
    await until(() => accepted.length === 1);
    late(1);
    await delay(30);
    assert.deepEqual(accepted, [2]);
    assert.equal(calls, 2);
  } finally {
    recovery.stop();
  }
});

void test('registration cancellation blocks stale state and a restore can start again', async () => {
  let resolve!: (value: number) => void;
  let calls = 0;
  const accepted: number[] = [];
  const recovery = new ConnectionRecovery(
    () => {
      calls++;
      return calls === 1
        ? new Promise<number>((done) => {
            resolve = done;
          })
        : Promise.resolve(2);
    },
    (value) => accepted.push(value),
    [1],
    100,
  );
  try {
    recovery.start();
    await until(() => calls === 1);
    recovery.stop();
    recovery.start();
    resolve(1);
    await until(() => accepted.length > 0);
    assert.deepEqual(accepted, [2]);
  } finally {
    recovery.stop();
  }
});

void test('caption recovery retries failed downloads, keeps successful tracks and preserves identity', async () => {
  const calls = new Map<string, number>();
  const loader = new CaptionLoader(
    async (item) => {
      const count = (calls.get(item.url) ?? 0) + 1;
      calls.set(item.url, count);
      if (item.kind === 'captions' && count === 1) throw new CaptionDownloadError(true);
      return vtt;
    },
    [1],
  );
  const recovered: Session[] = [];
  try {
    const first = await loader.start(
      'EPISODE',
      'VERSION',
      'en-US',
      [resource, { ...resource, kind: 'subtitles', url: 'https://example.test/subtitle.vtt' }],
      (session) => recovered.push(session),
    );
    assert.equal(first.tracks.length, 1);
    await until(() => recovered.length === 1);
    assert.equal(recovered[0]!.tracks.length, 2);
    assert.equal(recovered[0]!.tracks[1]!.id, first.tracks[0]!.id);
    assert.equal(calls.get(resource.url), 2);
    assert.equal(calls.get('https://example.test/subtitle.vtt'), 1);
  } finally {
    loader.stop();
  }
});

void test('automatic caption retries are bounded; manual refresh can recover later', async () => {
  let calls = 0;
  let working = false;
  const results: Session[] = [];
  const loader = new CaptionLoader(async () => {
    calls++;
    if (!working) throw new CaptionDownloadError(true);
    return vtt;
  }, [1, 1]);
  try {
    await loader.start('EPISODE', 'VERSION', 'en-US', [resource], (session) =>
      results.push(session),
    );
    await until(() => results.length === 2);
    await delay(30);
    assert.equal(calls, 3);
    assert.equal(results[1]!.tracks.length, 0);
    working = true;
    await loader.retry();
    assert.equal(calls, 4);
    assert.equal(results[2]!.tracks.length, 1);
  } finally {
    loader.stop();
  }
});

void test('permanent download/parse failures are not automatically retried', async () => {
  let calls = 0;
  const results: Session[] = [];
  const loader = new CaptionLoader(
    async (item) => {
      calls++;
      if (item.kind === 'captions') throw new CaptionDownloadError(false);
      return 'invalid synthetic VTT';
    },
    [1],
  );
  try {
    const first = await loader.start(
      'EPISODE',
      'VERSION',
      'en-US',
      [resource, { ...resource, kind: 'subtitles', url: 'https://example.test/bad.vtt' }],
      (session) => results.push(session),
    );
    await delay(30);
    assert.equal(first.tracks.length, 0);
    assert.equal(calls, 2);
    assert.deepEqual(results, []);
  } finally {
    loader.stop();
  }
});

void test('episode changes abort in-flight caption retry and cannot publish its late result', async () => {
  let calls = 0;
  let complete!: (text: string) => void;
  let signal!: AbortSignal;
  const results: Session[] = [];
  const loader = new CaptionLoader(
    async (item, cancel) => {
      calls++;
      if (item.url !== resource.url) return vtt;
      if (calls === 1) throw new CaptionDownloadError(true);
      signal = cancel;
      return new Promise<string>((resolve) => {
        complete = resolve;
      });
    },
    [1],
  );
  try {
    await loader.start('OLD', 'OLDEN', 'en-US', [resource], (session) => results.push(session));
    await until(() => calls === 2);
    const next = await loader.start(
      'NEW',
      'NEWJA',
      'ja-JP',
      [{ ...resource, kind: 'subtitles', url: 'https://example.test/new.vtt' }],
      (session) => results.push(session),
    );
    assert.equal(signal.aborted, true);
    complete(vtt);
    await delay(30);
    assert.equal(next.version, 'NEWJA');
    assert.deepEqual(results, []);
  } finally {
    loader.stop();
  }
});
