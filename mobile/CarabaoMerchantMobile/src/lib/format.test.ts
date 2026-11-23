// Merchant copy of mobile/CarabaoMobile/src/lib/farms.test.ts (the ratingLabel test only).
/// <reference types="node" />
// Run with `npm test`. CF-0111.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratingLabel } from './format.ts';

test('a farm without reviews is "New", not 0 stars', () => {
  assert.equal(ratingLabel(4.25), '4.3');
  assert.equal(ratingLabel(5), '5.0');
  for (const r of [0, null, undefined, Number.NaN]) assert.equal(ratingLabel(r), 'New', String(r));
});
