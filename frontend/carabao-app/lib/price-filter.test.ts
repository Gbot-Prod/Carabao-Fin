import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRICE_FILTER_MAX, priceFilter } from './price-filter.ts';

// CF-0094 (B102)
test('price filter: empty or bad input is no filter', () => {
  for (const raw of ['', '  ', 'abc', '-5', 'NaN', 'Infinity']) {
    assert.equal(priceFilter(raw), undefined, raw);
  }
});

test('price filter: whole pesos, capped at the backend maximum', () => {
  assert.equal(priceFilter('0'), 0);
  assert.equal(priceFilter(' 120 '), 120);
  assert.equal(priceFilter('99.9'), 99);
  assert.equal(priceFilter(String(PRICE_FILTER_MAX)), PRICE_FILTER_MAX);
  assert.equal(priceFilter('5000000'), PRICE_FILTER_MAX);
  assert.equal(priceFilter('1e30'), PRICE_FILTER_MAX);
});
