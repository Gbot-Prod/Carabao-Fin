// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activePause, addDays, manilaToday, pauseDateError, shortDay } from './store-pause.ts';

test('Manila today rolls over at 16:00 UTC', () => {
  assert.equal(manilaToday(new Date('2026-11-19T15:59:00Z')), '2026-11-19');
  assert.equal(manilaToday(new Date('2026-11-19T16:00:00Z')), '2026-11-20');
});

test('a pause is active through its last day only', () => {
  assert.equal(activePause('2026-11-26', '2026-11-19'), '2026-11-26');
  assert.equal(activePause('2026-11-26', '2026-11-26'), '2026-11-26');
  assert.equal(activePause('2026-11-26', '2026-11-27'), null);
  assert.equal(activePause(null, '2026-11-19'), null);
  assert.equal(activePause('soon', '2026-11-19'), null);
});

test('labels and date checks', () => {
  assert.equal(shortDay('2026-12-01'), 'Dec 1');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(pauseDateError('2026-11-19', '2026-11-19'), null);
  assert.ok(pauseDateError('2026-11-18', '2026-11-19'));
  assert.equal(pauseDateError(addDays('2026-11-19', 90), '2026-11-19'), null);
  assert.ok(pauseDateError(addDays('2026-11-19', 91), '2026-11-19'));
  assert.ok(pauseDateError('', '2026-11-19'));
});
