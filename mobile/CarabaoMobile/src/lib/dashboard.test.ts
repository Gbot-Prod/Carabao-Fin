/// <reference types="node" />
// Run with `npm test`. CF-0125.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertCounts, cancelRate, peso, statTiles, unmetSearches, type MerchantPerformance } from './dashboard.ts';

const perf: MerchantPerformance = {
  merchant_id: 1, merchant_name: 'Dela Cruz', rating: 4.5, rating_count: 2, total_products: 7, total_orders: 30,
  active_orders: 3, delivered_orders: 24, cancelled_orders: 3, total_revenue: 125000, last_30_days_orders: 9,
  last_30_days_revenue: 15400.4,
};

test('tiles: open orders first, money in whole pesos', () => {
  const t = statTiles(perf);
  assert.equal(t[0].label, 'Open orders');
  assert.equal(t[0].value, '3');
  assert.equal(t.find((x) => x.key === 'rev30')!.value, '₱15,400');
  assert.equal(t.find((x) => x.key === 'revenue')!.value, '₱125,000');
  assert.equal(peso(Number.NaN), '₱0');
});

test('cancel rate over finished orders only', () => {
  assert.equal(cancelRate(perf), 11);
  assert.equal(cancelRate({ delivered_orders: 0, cancelled_orders: 0 }), null);
});

test('alert counts', () => {
  assert.deepEqual(alertCounts({ low_stock: [1, 2], expiring_soon: [3], expired: [] }), { low: 2, expiring: 1, expired: 0, total: 3 });
  assert.deepEqual(alertCounts(null), { low: 0, expiring: 0, expired: 0, total: 0 });
});

test('unmet searches: only no-result ones, most first, capped', () => {
  const d = {
    province: 'Benguet', days: 30, most_ordered: [], most_searched_luzon: [],
    most_searched: [
      { query: 'kale', searches: 9, no_result_searches: 0 },
      { query: 'strawberry', searches: 12, no_result_searches: 5 },
      { query: 'ube', searches: 7, no_result_searches: 7 },
    ],
  };
  assert.deepEqual(unmetSearches(d).map((t) => t.query), ['ube', 'strawberry']);
  assert.deepEqual(unmetSearches(d, 1).map((t) => t.query), ['ube']);
  assert.deepEqual(unmetSearches(null), []);
});
