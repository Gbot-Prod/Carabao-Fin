/// <reference types="node" />
// Run with `npm test`. CF-0111.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryFeeLabel, deliveryTimeLabel, ratingLabel } from './farms.ts';

test('a farm without reviews is "New", not 0 stars', () => {
  assert.equal(ratingLabel(4.25), '4.3');
  assert.equal(ratingLabel(5), '5.0');
  for (const r of [0, null, undefined, Number.NaN]) assert.equal(ratingLabel(r), 'New', String(r));
});

test('delivery time: days, or left out when unknown', () => {
  assert.equal(deliveryTimeLabel(1), '1 day');
  assert.equal(deliveryTimeLabel(3), '3 days');
  for (const d of [0, -1, null, undefined]) assert.equal(deliveryTimeLabel(d), null, String(d));
});

test('delivery fee: pesos, free, or left out when unknown (never a made-up ₱0)', () => {
  assert.equal(deliveryFeeLabel(50), '₱50 delivery');
  assert.equal(deliveryFeeLabel(1500), '₱1,500 delivery');
  assert.equal(deliveryFeeLabel(0), 'Free delivery');
  for (const f of [null, undefined, -5]) assert.equal(deliveryFeeLabel(f), null, String(f));
});
