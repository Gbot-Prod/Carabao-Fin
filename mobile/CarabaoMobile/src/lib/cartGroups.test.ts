/// <reference types="node" />
// Run with `npm test`. CF-0106.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotals, DEFAULT_DELIVERY_FEE, groupCartByFarm, parsePendingOrders } from './cartGroups.ts';
import type { CartItem } from './CartContext';

const line = (over: Partial<CartItem>): CartItem => ({
  id: '1', produceId: 1, merchantId: 1, farm: 'A', produce: 'Kale', unit: 'kg', price: 100, quantity: 1,
  deliveryFee: 50, ...over,
});

test('one group per farm, each with its own delivery fee once', () => {
  const groups = groupCartByFarm([
    line({ id: '1', merchantId: 1, price: 100, quantity: 2 }),
    line({ id: '2', merchantId: 1, price: 30, quantity: 1 }),
    line({ id: '3', merchantId: 2, farm: 'B', price: 10, quantity: 3, deliveryFee: 70 }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => [g.key, g.subtotal, g.deliveryFee, g.total]), [
    ['m1', 230, 50, 280],
    ['m2', 30, 70, 100],
  ]);
  assert.deepEqual(cartTotals(groups), { itemTotal: 260, deliveryTotal: 120, grandTotal: 380 });
});

test('a line with no merchant id groups by farm name; an unknown fee uses the default', () => {
  const groups = groupCartByFarm([line({ merchantId: null, farm: 'Old Farm', deliveryFee: null })]);
  assert.equal(groups[0].key, 'fOld Farm');
  assert.equal(groups[0].deliveryFee, DEFAULT_DELIVERY_FEE);
});

test('an empty cart has no groups and zero totals', () => {
  assert.deepEqual(groupCartByFarm([]), []);
  assert.deepEqual(cartTotals([]), { itemTotal: 0, deliveryTotal: 0, grandTotal: 0 });
});

test('pending orders param: only well-formed rows are kept (CF-0114)', () => {
  const ok = { id: 4, ref: 'CB-2026-0004', farm: ' A ', total: 90 };
  const bad = [
    { ...ok, id: 0 }, { ...ok, id: 1.5 }, { ...ok, id: '4' },
    { ...ok, ref: 'Pay now at evil.example' }, { ...ok, farm: '' }, { ...ok, farm: 'x'.repeat(101) },
    { ...ok, total: -1 }, { ...ok, total: 1.5 }, { ...ok, total: 10_000_001 },
  ];
  assert.deepEqual(parsePendingOrders(JSON.stringify([ok, ...bad])), [{ ...ok, farm: 'A' }]);
  assert.equal(parsePendingOrders(JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ ...ok, id: i + 1 })))).length, 20);
  assert.deepEqual(parsePendingOrders('x'.repeat(10_001)), []);
});

test('pending orders param: bad JSON or rows without a numeric id are dropped', () => {
  const ok = { id: 4, ref: 'CB-2026-0004', farm: 'A', total: 90 };
  assert.deepEqual(parsePendingOrders(JSON.stringify([ok, { id: 'x' }, null])), [ok]);
  assert.deepEqual(parsePendingOrders('{not json'), []);
  assert.deepEqual(parsePendingOrders(JSON.stringify({ id: 4 })), []);
  assert.deepEqual(parsePendingOrders(undefined), []);
});
