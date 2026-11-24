// S16: holiday mode helpers (src/lib/storePause.ts), a copy of the web merchant's
// lib/store-pause.ts. Same cases as the web, so the two apps agree on a pause's last day.
/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activePause, addDays, manilaToday, MAX_PAUSE_DAYS, pauseDateError, shortDay } from './storePause.ts';

test('today is the Manila calendar day, not the device\'s', () => {
  // 2026-11-24T17:30Z is already Nov 25 in Manila (UTC+8).
  assert.equal(manilaToday(new Date('2026-11-24T17:30:00Z')), '2026-11-25');
  assert.equal(manilaToday(new Date('2026-11-24T15:59:00Z')), '2026-11-24');
});

test('a pause runs through its last day, and is over the day after', () => {
  assert.equal(activePause('2026-11-30', '2026-11-24'), '2026-11-30');
  assert.equal(activePause('2026-11-24', '2026-11-24'), '2026-11-24');
  assert.equal(activePause('2026-11-23', '2026-11-24'), null);
  assert.equal(activePause(null, '2026-11-24'), null);
  assert.equal(activePause('30/11/2026', '2026-11-24'), null);
});

test('a day is added on the calendar, across month and year ends', () => {
  assert.equal(addDays('2026-11-24', 7), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
});

test('the short day is read as a calendar day, never shifted by a time zone', () => {
  assert.equal(shortDay('2026-11-26'), 'Nov 26');
  assert.equal(shortDay('2027-01-01'), 'Jan 1');
});

test('a last day is today or later, and no more than the 90-day limit', () => {
  assert.equal(MAX_PAUSE_DAYS, 90);
  assert.equal(pauseDateError('2026-11-24', '2026-11-24'), null);
  assert.equal(pauseDateError('2027-02-22', '2026-11-24'), null);
  assert.equal(pauseDateError('2026-11-23', '2026-11-24'), 'Pick today or a later day.');
  assert.equal(pauseDateError('2027-02-23', '2026-11-24'), 'A break can last up to 90 days.');
  assert.equal(pauseDateError('', '2026-11-24'), 'Pick the last day of the break.');
  assert.equal(pauseDateError('24/11/2026', '2026-11-24'), 'Pick the last day of the break.');
});
