/// <reference types="node" />
// Run with `npm test`. S7 (plan §5.8): the Inventory screen's rules, checked against the
// web merchant inventory page, its StockAlertsPanel and backend stock_alerts.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  LOW_STOCK_THRESHOLD_MAX,
  LOW_STOCK_THRESHOLD_MIN,
  daysLabel,
  inventoryTotals,
  isLowStock,
  sortStock,
  stepStock,
  stockProblem,
  stockStatus,
  stockStatusLabel,
  thresholdProblem,
} from './inventory.ts';
import { LISTING_STOCK_MAX } from './listingForm.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
// Line ends differ between checkouts (CRLF on Windows): compare text with LF only.
const read = (path: string) => readFileSync(join(repo, path), 'utf8').split('\r\n').join('\n');

const PAGE = 'frontend/carabao-app/app/(site)/(merchant)/merchant/(shell)/inventory/page.tsx';
const PANEL = 'frontend/carabao-app/app/(site)/(merchant)/merchant/components/StockAlertsPanel.tsx';

const rows = [
  { id: 1, name: 'Squash', price: 40, stock_quantity: 0 },
  { id: 2, name: 'Ampalaya', price: 60, stock_quantity: 4 },
  { id: 3, name: 'Talong', price: 50, stock_quantity: 50 },
  { id: 4, name: 'Banana', price: 30, stock_quantity: 0 },
  { id: 5, name: 'Kale', price: 80, stock_quantity: 5 },
  { id: 6, name: 'Pechay', price: 25, stock_quantity: 1 },
];

test('low stock is the web isLow rule: on sale, threshold above 0, at or below it', () => {
  assert.equal(isLowStock(5, 5), true, 'at the threshold counts');
  assert.equal(isLowStock(1, 5), true);
  assert.equal(isLowStock(6, 5), false);
  assert.equal(isLowStock(0, 5), false, 'empty is out of stock, not low');
  assert.equal(isLowStock(5, 0), false, '0 turns the flag off');
  assert.equal(isLowStock(5, -1), false);
});

test('status and badges match the web table', () => {
  assert.equal(stockStatus(0, 5), 'out');
  assert.equal(stockStatus(5, 5), 'low');
  assert.equal(stockStatus(9, 5), 'ok');
  assert.equal(stockStatus(3, 0), 'ok', 'alerts off means nothing is low');
  assert.deepEqual(
    (['out', 'low', 'ok'] as const).map(stockStatusLabel),
    ['Out of Stock', 'Low Stock', 'In Stock'],
  );
});

test('stock rows: out of stock, then low, then the rest by name (a copy)', () => {
  const sorted = sortStock(rows, 5);
  assert.deepEqual(
    sorted.map((r) => r.name),
    ['Banana', 'Squash', 'Ampalaya', 'Kale', 'Pechay', 'Talong'],
  );
  // The shared produce list is never re-ordered by a screen.
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3, 4, 5, 6]);
  assert.notEqual(sorted, rows);

  // A low row comes before an alphabetically earlier row that is fine.
  const two = [
    { name: 'Ampalaya', price: 60, stock_quantity: 40 },
    { name: 'Talong', price: 50, stock_quantity: 3 },
  ];
  assert.deepEqual(sortStock(two, 5).map((r) => r.name), ['Talong', 'Ampalaya']);
  assert.deepEqual(sortStock(two, 0).map((r) => r.name), ['Ampalaya', 'Talong']);
});

test('tiles: price times stock, out of stock, low stock at the threshold', () => {
  const value = 60 * 4 + 50 * 50 + 80 * 5 + 25 * 1;
  assert.deepEqual(inventoryTotals(rows, 5), { value, outOfStock: 2, lowStock: 3 });
  // 0 turns low stock off; empty listings are still counted as out of stock.
  assert.deepEqual(inventoryTotals(rows, 0), { value, outOfStock: 2, lowStock: 0 });
  assert.deepEqual(inventoryTotals([], 5), { value: 0, outOfStock: 0, lowStock: 0 });
});

test('threshold box: whole numbers, the web message, the backend cap', () => {
  for (const bad of ['', ' ', 'abc', '-1', '3.5', '1e3']) {
    assert.equal(thresholdProblem(bad), 'Enter a whole number, 0 or more.', JSON.stringify(bad));
  }
  assert.equal(thresholdProblem('0'), null, '0 is a real setting: alerts off');
  assert.equal(thresholdProblem(' 5 '), null);
  assert.equal(thresholdProblem(String(LOW_STOCK_THRESHOLD_MAX)), null);
  assert.equal(
    thresholdProblem(String(LOW_STOCK_THRESHOLD_MAX + 1)),
    `Enter ${LOW_STOCK_THRESHOLD_MAX.toLocaleString('en-PH')} or less.`,
  );
  assert.equal(LOW_STOCK_THRESHOLD_MIN, 0);
  assert.equal(DEFAULT_LOW_STOCK_THRESHOLD, 5);
});

test('stock box and +/− stay inside the backend stock bounds', () => {
  const message = `Stock must be a whole number from 0 to ${LISTING_STOCK_MAX.toLocaleString('en-PH')}.`;
  for (const bad of ['', '-1', '2.5', 'ten', String(LISTING_STOCK_MAX + 1)]) {
    assert.equal(stockProblem(bad), message, JSON.stringify(bad));
  }
  assert.equal(stockProblem('0'), null);
  assert.equal(stockProblem(String(LISTING_STOCK_MAX)), null);

  assert.equal(stepStock(4, 1), 5);
  assert.equal(stepStock(4, -1), 3);
  assert.equal(stepStock(0, -1), 0, 'never below 0');
  assert.equal(stepStock(LISTING_STOCK_MAX, 1), LISTING_STOCK_MAX);
  assert.equal(stepStock(Number.NaN, 1), 1);
  assert.equal(stepStock(2.6, 0), 3, 'whole units only');
});

test('best-before wording is the web panel’s', () => {
  assert.equal(daysLabel(null), '');
  assert.equal(daysLabel(0), 'today');
  assert.equal(daysLabel(1), 'tomorrow');
  assert.equal(daysLabel(2), 'in 2 days');
});

test('S7 threshold limits = backend stock_alerts.py; rules = web inventory page', () => {
  const py = read('backend/app/api/routes/stock_alerts.py');
  const field = /low_stock_threshold: int = Field\(ge=(\d+), le=([\d_]+)\)/.exec(py);
  assert.ok(field, 'ThresholdUpdate.low_stock_threshold not found in stock_alerts.py');
  assert.equal(Number(field[1]), LOW_STOCK_THRESHOLD_MIN);
  assert.equal(Number(field[2].replace(/_/g, '')), LOW_STOCK_THRESHOLD_MAX);
  // The threshold until the farm saves one: backend `threshold = 5`, web useState(5).
  assert.match(py, /^\s+threshold = 5$/m, 'the backend default threshold differs');

  const page = read(PAGE);
  assert.match(page, new RegExp(`useState\\(${DEFAULT_LOW_STOCK_THRESHOLD}\\)`), 'the web default differs');
  assert.ok(
    page.includes('const isLow = (qty: number) => qty > 0 && threshold > 0 && qty <= threshold;'),
    'the web low-stock rule differs',
  );
  assert.ok(
    page.includes(
      'const rank = (qty: number) => (qty === 0 ? 0 : qty > 0 && threshold > 0 && qty <= threshold ? 1 : 2);',
    ),
    'the web row order differs',
  );
  const labels = /\{status === "out" \? "([^"]+)" : status === "low" \? "([^"]+)" : "([^"]+)"\}/.exec(page);
  assert.ok(labels, 'the web status labels were not found');
  assert.deepEqual(
    (['out', 'low', 'ok'] as const).map(stockStatusLabel),
    [labels[1], labels[2], labels[3]],
  );

  // The threshold box: whole numbers from 0, the web's message and best-before wording.
  const panel = read(PANEL);
  assert.match(panel, /\n\s+min=\{0\}\n/);
  assert.match(panel, /\n\s+step=\{1\}\n/);
  assert.ok(panel.includes('"Enter a whole number, 0 or more."'), 'the threshold message differs');
  assert.match(
    panel,
    /d == null \? "" : d === 0 \? "today" : d === 1 \? "tomorrow" : `in \$\{d\} days`/,
    'the best-before wording differs',
  );
});
