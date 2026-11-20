// Run with `npm test`. CF-0036.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_PAGE_SIZE, historyParams, pageAfterRemoval, tabFromParam } from './order-history.ts';

test('only the filters that are set are sent', () => {
  assert.deepEqual(historyParams({ page: 1 }), { page: 1, page_size: HISTORY_PAGE_SIZE });
  assert.deepEqual(historyParams({ page: 2, status: '', q: '   ' }), { page: 2, page_size: HISTORY_PAGE_SIZE });
  assert.deepEqual(historyParams({ page: 3, status: 'delivered', q: '  CB-2026-0042 ' }), {
    page: 3,
    page_size: HISTORY_PAGE_SIZE,
    status: 'delivered',
    q: 'CB-2026-0042',
  });
});

test('page is a whole number of at least 1', () => {
  for (const page of [0, -4, Number.NaN, 1.7]) {
    assert.equal(historyParams({ page }).page, 1, String(page));
  }
});

test('search is capped at the API limit', () => {
  assert.equal(String(historyParams({ page: 1, q: 'x'.repeat(150) }).q).length, 100);
});

test('removing the last order on a later page steps back one page', () => {
  assert.equal(pageAfterRemoval(3, 21, 10), 2); // page 3 held only #21
  assert.equal(pageAfterRemoval(3, 25, 10), 3);
  assert.equal(pageAfterRemoval(2, 11, 10), 1);
  assert.equal(pageAfterRemoval(1, 1, 10), 1);
  assert.equal(pageAfterRemoval(1, 0, 10), 1);
});

test('the ?tab= value picks a known tab, else All', () => {
  assert.equal(tabFromParam('to_ship'), 'to_ship');
  assert.equal(tabFromParam('delivered'), 'delivered');
  assert.equal(tabFromParam(null), '');
  assert.equal(tabFromParam(''), '');
  assert.equal(tabFromParam('active'), '');
  assert.equal(tabFromParam('__proto__'), '');
});
