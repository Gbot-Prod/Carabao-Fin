/// <reference types="node" />
// Run with `npm test`. CF-0118.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { activeFilterCount, NO_FILTERS, PRICE_FILTER_MAX, SEARCH_PAGE_SIZE, searchQuery, SORTS } from './produceSearch.ts';

const q = (over: Partial<typeof NO_FILTERS>, page = 1) => {
  const r = searchQuery({ ...NO_FILTERS, ...over }, page);
  return 'ok' in r ? r.ok : `ERR ${r.error}`;
};

test('defaults: in stock, best match, first page; empty values left out', () => {
  assert.equal(q({}), `in_stock=true&page=1&page_size=${SEARCH_PAGE_SIZE}`);
});

test('every filter, encoded, in a stable order', () => {
  assert.equal(
    q({ q: ' sweet corn & co ', category: 'Vegetables', minPrice: '10', maxPrice: '200', inStock: false, fresh: true, sort: 'price_asc' }, 3),
    `q=sweet%20corn%20%26%20co&category=Vegetables&min_price=10&max_price=200&fresh=true&sort=price_asc&page=3&page_size=${SEARCH_PAGE_SIZE}`,
  );
  assert.equal(q({ q: 'x'.repeat(150) }).split('&')[0].length, 'q='.length + 100);
});

test('bad prices are refused before a request', () => {
  assert.equal(q({ minPrice: '1.5' }), 'ERR Prices are whole pesos.');
  assert.equal(q({ maxPrice: '-3' }), 'ERR Prices are whole pesos.');
  assert.equal(q({ minPrice: '300', maxPrice: '100' }), 'ERR Min ₱ is above max ₱.');
  assert.match(q({ minPrice: '100', maxPrice: '100' }), /min_price=100&max_price=100/);
});

test('CF-0136: a price above the backend MAX_PRICE is sent as the maximum (no 422)', () => {
  assert.equal(PRICE_FILTER_MAX, 1_000_000);
  assert.match(q({ maxPrice: '9999999' }), new RegExp(`max_price=${PRICE_FILTER_MAX}&`));
  assert.match(q({ minPrice: '1000000', maxPrice: '1000001' }), /min_price=1000000&max_price=1000000&/);
  assert.match(q({ minPrice: '0' }), /min_price=0&/);
});

test('filter count ignores the query text', () => {
  assert.equal(activeFilterCount(NO_FILTERS), 0);
  assert.equal(activeFilterCount({ ...NO_FILTERS, q: 'kale' }), 0);
  assert.equal(activeFilterCount({ ...NO_FILTERS, category: 'Fruits', fresh: true, inStock: false, sort: 'newest' }), 4);
});

test('sort keys = backend SortKey, labels = web en.ts', () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const py = readFileSync(join(repo, 'backend/app/api/routes/produce_search.py'), 'utf8');
  const keys = /SortKey = Literal\[([^\]]*)\]/.exec(py)?.[1].match(/"([a-z_]+)"/g)?.map((s) => s.slice(1, -1)) ?? [];
  assert.deepEqual([...SORTS.map((s) => s.value)].sort(), [...keys].sort());
  const en = readFileSync(join(repo, 'frontend/carabao-app/lib/i18n/strings/en.ts'), 'utf8');
  for (const s of SORTS) assert.ok(en.includes(`${s.value}: '${s.label}'`), s.value);
});
