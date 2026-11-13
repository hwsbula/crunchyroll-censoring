import assert from 'node:assert/strict';
import test from 'node:test';
import { CoverageBanner } from '../../src/integration/coverage.ts';
import type { FilterStatus } from '../../src/core/types.ts';

const active: FilterStatus = { phase: 'active', reason: 'Ready' };
const waiting: FilterStatus = { phase: 'loading', reason: 'Waiting for a displayed cue' };
void test('short redraws do not flash a banner, but a persistent loading state is disclosed', () => {
  const banner = new CoverageBanner();
  assert.equal(banner.text({ audio: active, subtitles: waiting }, true, 0), '');
  assert.equal(banner.text({ audio: active, subtitles: active }, true, 100), '');
  assert.equal(banner.text({ audio: active, subtitles: waiting }, true, 600), '');
  assert.equal(banner.text({ audio: active, subtitles: active }, true, 700), '');
  assert.equal(banner.text({ audio: active, subtitles: waiting }, true, 1000), '');
  assert.equal(
    banner.text({ audio: active, subtitles: { ...waiting, reason: 'Still checking' } }, true, 2499),
    '',
  );
  assert.equal(banner.text({ audio: active, subtitles: waiting }, true, 2500), waiting.reason);
  assert.equal(banner.text({ audio: active, subtitles: active }, true, 2501), '');
});
void test('missing captions and renderer errors remain immediate, separate player warnings', () => {
  const banner = new CoverageBanner();
  const missing: FilterStatus = {
    phase: 'unavailable',
    reason: 'Audio filtering unavailable: no matching English CC.',
  };
  const failed: FilterStatus = { phase: 'error', reason: 'Subtitle renderer failed' };
  assert.equal(banner.text({ audio: missing, subtitles: waiting }, true, 10), missing.reason);
  assert.equal(
    banner.text({ audio: missing, subtitles: failed }, true, 11),
    `${missing.reason}\n${failed.reason}`,
  );
  assert.equal(banner.text({ audio: missing, subtitles: failed }, false, 12), '');
  assert.equal(banner.text({ audio: active, subtitles: waiting }, true, 3000), '');
});

void test('a full player snapshot can contain null metadata without being treated as coverage', () => {
  const snapshot = {
    audio: active,
    subtitles: active,
    episode: null,
    version: null,
    subtitleLanguage: null,
    time: 0,
    instance: 'synthetic',
  };
  assert.equal(new CoverageBanner().text(snapshot, true, 0), '');
});
