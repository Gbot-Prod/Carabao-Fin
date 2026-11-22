// Shared with mobile/CarabaoMobile/src/lib/idle.test.ts. Keep both copies the same (sharedCopies.test.ts).
/// <reference types="node" />
// Run with `npm test`. CF-0106.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { awayTooLong, idleTimeoutMs } from './idle.ts';

test('idle limit: a valid number of minutes, else 30 (same default as the web)', () => {
  assert.equal(idleTimeoutMs('15'), 15 * 60_000);
  for (const bad of [undefined, '', '0', '-5', 'abc', '0.5']) {
    assert.equal(idleTimeoutMs(bad), 30 * 60_000, String(bad));
  }
});

test('away too long only once the limit is reached', () => {
  assert.equal(awayTooLong(null, 10_000, 1_000), false);
  assert.equal(awayTooLong(1_000, 1_999, 1_000), false);
  assert.equal(awayTooLong(1_000, 2_000, 1_000), true);
});
