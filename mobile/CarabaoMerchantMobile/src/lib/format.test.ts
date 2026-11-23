// Merchant copy of mobile/CarabaoMobile/src/lib/farms.test.ts (the ratingLabel test only).
/// <reference types="node" />
// Run with `npm test`. CF-0111, plus the web merchant lib/format.ts helpers (S4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatPeso, formatRequestedDate, ratingLabel } from './format.ts';

test('a farm without reviews is "New", not 0 stars', () => {
  assert.equal(ratingLabel(4.25), '4.3');
  assert.equal(ratingLabel(5), '5.0');
  for (const r of [0, null, undefined, Number.NaN]) assert.equal(ratingLabel(r), 'New', String(r));
});

test('money and dates read as on the web merchant dashboard', () => {
  // Pesos with no cents, as M/lib/format.ts formatPeso does it.
  assert.match(formatPeso(1234), /1,234/);
  assert.doesNotMatch(formatPeso(1234), /1,234\.\d/);
  assert.match(formatPeso(0), /0/);

  // A timestamp; "—" when the backend sends nothing; the raw text if it is unreadable.
  assert.equal(formatDate(null), '—');
  assert.equal(formatDate(''), '—');
  assert.equal(formatDate('not a date'), 'not a date');
  assert.equal(formatDate('2026-11-24T12:00:00'), 'Nov 24, 2026');

  // A YYYY-MM-DD is a calendar date, so no timezone can shift the day.
  assert.equal(formatRequestedDate('2026-11-24'), 'Tue, Nov 24, 2026');
  assert.equal(formatRequestedDate('garbage'), 'garbage');
});
