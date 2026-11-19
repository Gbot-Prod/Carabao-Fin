// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_LIST_LIMIT, mayHaveMore, mergeById } from './admin-window.ts';

test('windows merge without duplicates, keeping the first order', () => {
  const merged = mergeById([{ id: 3 }, { id: 1 }], [{ id: 1 }, { id: 7 }, { id: 2 }]);
  assert.deepEqual(merged.map((r) => r.id), [3, 1, 7, 2]);
  assert.deepEqual(mergeById([], [{ id: 5 }]), [{ id: 5 }]);
});

test('only a full window offers more', () => {
  assert.equal(mayHaveMore(ADMIN_LIST_LIMIT), true);
  assert.equal(mayHaveMore(ADMIN_LIST_LIMIT - 1), false);
  assert.equal(mayHaveMore(0, 10), false);
});
