/// <reference types="node" />
// Run with `npm test`. CF-0129 (port of web lib/cart-issues.test.ts, CF-0042).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { atStockCap, CART_ISSUES, cartIssueMessage, parseCartIssue, priceChangeText } from './cartIssues.ts';
import { blockerText, checkoutBlockers, fromServerLine } from './cartSync.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

test('CF-0129 message per issue, with quantities filled in', () => {
  assert.match(cartIssueMessage({ issue: 'unavailable' })!, /No longer available/);
  assert.match(cartIssueMessage({ issue: 'expired' })!, /best-before/);
  assert.match(cartIssueMessage({ issue: 'farm_unavailable' })!, /not taking orders/);
  assert.match(cartIssueMessage({ issue: 'own_listing' })!, /your own farm/);
  assert.equal(cartIssueMessage({ issue: 'below_minimum', minOrderQty: 5 }), 'Below the minimum order of 5. Raise the quantity to continue.');
  assert.equal(cartIssueMessage({ issue: 'exceeds_stock', stockQuantity: 2 }), 'Only 2 left. Lower the quantity to continue.');
});

test('CF-0129 no issue, or a code this build does not know, gives no message', () => {
  assert.equal(cartIssueMessage({}), null);
  assert.equal(cartIssueMessage({ issue: null }), null);
  assert.equal(cartIssueMessage({ issue: 'something_new' }), null);
  assert.equal(parseCartIssue('something_new'), null);
  assert.equal(parseCartIssue(3), null);
  assert.equal(parseCartIssue('exceeds_stock'), 'exceeds_stock');
});

test('CF-0129 every issue blocks checkout, exceeds_stock too (no unavailable_reason)', () => {
  const base = {
    id: '7', produce_id: 7, produce: 'Kale', unit: 'kg', price: 120, quantity: 5, stock_quantity: 2,
    unavailable_reason: null,
  };
  const over = fromServerLine({ ...base, issue: 'exceeds_stock' });
  const ok = fromServerLine({ ...base, id: '8', produce_id: 8, stock_quantity: 9 });
  assert.deepEqual(checkoutBlockers([ok, over]).map((i) => i.id), ['7']);
  assert.equal(blockerText(over), 'Kale: Only 2 left. Lower the quantity to continue.');
  const gone = fromServerLine({ ...base, issue: 'unavailable', unavailable_reason: 'is no longer available' });
  assert.equal(blockerText(gone), 'Kale is no longer available');
  // Same as the web: a code this build does not know shows no message but still blocks.
  const unknown = fromServerLine({ ...base, issue: 'brand_new' });
  assert.deepEqual(checkoutBlockers([unknown]).map((i) => i.id), ['7']);
  assert.equal(blockerText(unknown), 'Kale can’t be ordered now');
});

test('CF-0129 price change line, only when the price moved', () => {
  assert.equal(priceChangeText({ price: 120, previousPrice: 100 }), 'Price changed from ₱100.');
  assert.equal(priceChangeText({ price: 120, previousPrice: 120 }), null);
  assert.equal(priceChangeText({ price: 120, previousPrice: null }), null);
  assert.equal(priceChangeText({ price: 120 }), null);
  assert.equal(fromServerLine({ id: '1', produce_id: 1, produce: 'A', unit: 'kg', price: 9, quantity: 1, previous_price: 7 }).previousPrice, 7);
});

test('CF-0129 "+" stops at the reported stock', () => {
  assert.equal(atStockCap({ quantity: 2, stockQuantity: 2 }), true);
  assert.equal(atStockCap({ quantity: 1, stockQuantity: 2 }), false);
  assert.equal(atStockCap({ quantity: 1 }), false);
});

test('CF-0129 issue codes = backend CartIssue and schemas/cart.py, texts = web en strings', () => {
  const helpers = readFileSync(join(repo, 'backend/app/api/routes/_order_helpers.py'), 'utf8');
  const block = helpers.match(/CartIssue = Literal\[([\s\S]*?)\]/)![1];
  const codes = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(codes, [...CART_ISSUES]);
  const schema = readFileSync(join(repo, 'backend/app/schemas/cart.py'), 'utf8');
  for (const c of CART_ISSUES) assert.ok(schema.includes(`"${c}"`), `schemas/cart.py has ${c}`);
  const en = readFileSync(join(repo, 'frontend/carabao-app/lib/i18n/strings/en.ts'), 'utf8');
  assert.ok(en.includes("issueExceedsStock: 'Only {qty} left. Lower the quantity to continue.'"));
  assert.ok(en.includes("issueBelowMinimum: 'Below the minimum order of {qty}. Raise the quantity to continue.'"));
  assert.ok(en.includes("issueFarmUnavailable: 'This farm is not taking orders now. Remove it to continue.'"));
});
