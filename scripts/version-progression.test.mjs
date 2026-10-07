import test from 'node:test';
import assert from 'node:assert/strict';
import { checkVersionProgression } from './version-progression.mjs';

test('the same pushed candidate can finish its release, including patch 9', () => {
  assert.doesNotThrow(() => checkVersionProgression('1.8.9', '1.8.9', 'abc', 'abc'));
});
test('changed content cannot reuse the published version', () => {
  assert.throws(() => checkVersionProgression('1.8.9', '1.8.9', 'new', 'old'));
});
test('new releases advance exactly one version with decimal rollover', () => {
  for (const [before, after] of [['1.8.8', '1.8.9'], ['1.8.9', '1.9.0'], ['1.9.9', '2.0.0']]) {
    assert.doesNotThrow(() => checkVersionProgression(after, before, 'new', 'old'));
  }
  for (const after of ['1.8.10', '1.9.1', '1.8.8', 'invalid']) {
    assert.throws(() => checkVersionProgression(after, '1.8.9', 'new', 'old'));
  }
});
