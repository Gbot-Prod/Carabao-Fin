/// <reference types="node" />
// Run with `npm test`. CF-0102. The first four tests are the web's lib/order-history.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_PAGE_SIZE, hasMoreHistory, historyParams, historyQueryString, mergeHistoryPage, pageAfterRemoval,
} from './orderHistory.ts';

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
  assert.equal(pageAfterRemoval(3, 21, 10), 2);
  assert.equal(pageAfterRemoval(3, 25, 10), 3);
  assert.equal(pageAfterRemoval(2, 11, 10), 1);
});

test('query string encodes the search and leaves out empty filters', () => {
  assert.equal(historyQueryString({ page: 1 }), `page=1&page_size=${HISTORY_PAGE_SIZE}`);
  assert.equal(
    historyQueryString({ page: 2, status: 'cancelled', q: ' Dela Cruz & Sons ' }),
    `page=2&page_size=${HISTORY_PAGE_SIZE}&status=cancelled&q=Dela%20Cruz%20%26%20Sons`,
  );
  assert.equal(historyQueryString({ page: 1, q: '#42' }), `page=1&page_size=${HISTORY_PAGE_SIZE}&q=%2342`);
});

test('page 1 replaces the list, later pages append without duplicates', () => {
  const a = { id: 1 }, b = { id: 2 }, c = { id: 3 };
  assert.deepEqual(mergeHistoryPage([a, b], [c], 1), [c]);
  assert.deepEqual(mergeHistoryPage([a, b], [b, c], 2), [a, b, c]);
  assert.deepEqual(mergeHistoryPage([], [a], 2), [a]);
});

test('more pages only while the loaded pages are fewer than the total', () => {
  assert.equal(hasMoreHistory(1, 25, 10), true);
  assert.equal(hasMoreHistory(3, 25, 10), false);
  assert.equal(hasMoreHistory(2, 20, 10), false);
  assert.equal(hasMoreHistory(1, 0, 10), false);
});
