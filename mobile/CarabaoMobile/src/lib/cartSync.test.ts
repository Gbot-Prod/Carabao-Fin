/// <reference types="node" />
// Run with `npm test`. CF-0109.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  blockerText, checkoutBlockers, fromServerLine, MAX_CART_ITEMS, MAX_ITEM_QUANTITY, toServerItems,
} from './cartSync.ts';

const server = {
  id: '7', produce_id: 7, merchant_id: 3, produce: 'Kale', unit: 'kg', farm: 'Dela Cruz', price: 120,
  quantity: 2, min_order_qty: 1, stock_quantity: 9, delivery_fee: 50, unavailable_reason: null,
};

test('a server line becomes a cart line with the server fee and reason', () => {
  assert.deepEqual(fromServerLine(server), {
    id: '7', produceId: 7, merchantId: 3, farm: 'Dela Cruz', produce: 'Kale', unit: 'kg', price: 120,
    quantity: 2, deliveryFee: 50, minOrderQty: 1, stockQuantity: 9, unavailableReason: null,
    issue: null, previousPrice: null,
  });
  const old = fromServerLine({ id: '8', produce_id: 8, produce: 'Rice', unit: 'kg', price: 50, quantity: 1 });
  assert.equal(old.farm, 'Farm');
  assert.equal(old.merchantId, null);
  assert.equal(old.deliveryFee, null);
});

test('only produce_id and quantity are sent, one line per produce, within bounds', () => {
  const line = fromServerLine(server);
  assert.deepEqual(toServerItems([line]), [{ produce_id: 7, quantity: 2 }]);
  assert.deepEqual(toServerItems([line, { ...line, quantity: 3 }]), [{ produce_id: 7, quantity: 5 }]);
  assert.deepEqual(toServerItems([{ ...line, quantity: 0 }, { ...line, produceId: -1 }]), []);
  assert.deepEqual(toServerItems([{ ...line, quantity: MAX_ITEM_QUANTITY + 5 }]), [{ produce_id: 7, quantity: MAX_ITEM_QUANTITY }]);
  const many = Array.from({ length: MAX_CART_ITEMS + 3 }, (_, i) => ({ ...line, id: String(i + 1), produceId: i + 1 }));
  assert.equal(toServerItems(many).length, MAX_CART_ITEMS);
});

test('lines with a reason block checkout and say why', () => {
  const ok = fromServerLine(server);
  const gone = fromServerLine({ ...server, id: '9', produce_id: 9, unavailable_reason: 'is no longer available' });
  assert.deepEqual(checkoutBlockers([ok, gone]).map((i) => i.id), ['9']);
  assert.equal(blockerText(gone), 'Kale is no longer available');
  assert.deepEqual(checkoutBlockers([ok]), []);
});

test('limits = backend schemas/cart.py', () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const py = readFileSync(join(repo, 'backend/app/schemas/cart.py'), 'utf8');
  assert.match(py, new RegExp(`^MAX_CART_ITEMS = ${MAX_CART_ITEMS}\\b`, 'm'));
  assert.match(py, new RegExp(`^MAX_ITEM_QUANTITY = ${MAX_ITEM_QUANTITY.toLocaleString('en-US').replace(/,/g, '_')}\\b`, 'm'));
});
