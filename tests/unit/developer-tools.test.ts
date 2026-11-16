import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeveloperTools } from '../../src/shared/developer-tools.ts';

await test('developer display defaults off for existing installs and validates its independent local format', () => {
  assert.equal(parseDeveloperTools(undefined), false);
  assert.equal(parseDeveloperTools({ version: 1, enabled: true }), true);
  assert.equal(parseDeveloperTools({ version: 1, enabled: false }), false);
  for (const value of [
    null,
    [],
    { enabled: true },
    { version: 2, enabled: true },
    { version: 1, enabled: 'true' },
  ])
    assert.throws(() => parseDeveloperTools(value), /preserved/);
});
