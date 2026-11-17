// Run with `npm test`. CF-0038.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSaved } from './saved-produce.ts';

test('saving puts the id first without duplicates', () => {
  assert.deepEqual(withSaved([], 4, true), [4]);
  assert.deepEqual(withSaved([3, 2], 4, true), [4, 3, 2]);
  assert.deepEqual(withSaved([3, 4, 2], 4, true), [4, 3, 2]);
});

test('unsaving removes the id and keeps the order', () => {
  assert.deepEqual(withSaved([3, 4, 2], 4, false), [3, 2]);
  assert.deepEqual(withSaved([3, 2], 9, false), [3, 2]);
});

test('the input list is not changed', () => {
  const ids = [1, 2];
  withSaved(ids, 3, true);
  withSaved(ids, 1, false);
  assert.deepEqual(ids, [1, 2]);
});
