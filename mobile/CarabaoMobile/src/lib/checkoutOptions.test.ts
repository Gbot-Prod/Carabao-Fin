/// <reference types="node" />
// Run with `npm test`. CF-0115.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  dateLabel, defaultDeliveryDate, deliveryDateChoices, deliveryDateError, MAX_DELIVERY_DAYS_AHEAD, placeOrderFailure,
} from './checkoutOptions.ts';

const today = '2026-11-19'; // a Thursday

test('labels: Today, Tomorrow, then weekday day month', () => {
  assert.equal(dateLabel('2026-11-19', today), 'Today');
  assert.equal(dateLabel('2026-11-20', today), 'Tomorrow');
  assert.equal(dateLabel('2026-11-23', today), 'Mon 23 Nov');
  assert.equal(dateLabel('2027-01-01', today), 'Fri 1 Jan');
});

test('choices start today, default is tomorrow, all within the backend limit', () => {
  const c = deliveryDateChoices(today);
  assert.equal(c.length, 14);
  assert.equal(c[0].value, today);
  assert.equal(defaultDeliveryDate(today), '2026-11-20');
  assert.equal(deliveryDateChoices(today, 100).length, MAX_DELIVERY_DAYS_AHEAD + 1);
  for (const { value } of deliveryDateChoices(today, 100)) assert.equal(deliveryDateError(value, today), null, value);
});

test('date errors = backend messages', () => {
  assert.equal(deliveryDateError('2026-11-18', today), 'Delivery date cannot be in the past');
  assert.equal(deliveryDateError('2026-12-20', today), 'Delivery date must be within 30 days');
  assert.equal(deliveryDateError('2026-12-19', today), null); // day 30 is allowed
  assert.equal(deliveryDateError('', today), 'Choose a delivery date.');
});

test('failure text: server message first, cart reloaded on 400 / 409', () => {
  assert.deepEqual(placeOrderFailure(409, "Only 2 kg of 'Kale' left"), {
    text: "Only 2 kg of 'Kale' left\nYour cart was refreshed.", reloadCart: true,
  });
  assert.deepEqual(placeOrderFailure(400, 'Cart is empty'), { text: 'Cart is empty', reloadCart: true });
  assert.deepEqual(placeOrderFailure(429, 'Request failed (429)'), { text: 'Too many tries. Wait a minute and try again.', reloadCart: false });
  assert.equal(placeOrderFailure(429, 'Slow down: 5 orders an hour').text, 'Slow down: 5 orders an hour');
  assert.equal(placeOrderFailure(0, '').reloadCart, false);
  assert.equal(placeOrderFailure(500, '').text, 'The order was not placed. Please try again.');
});

test('limit = backend MAX_DELIVERY_DAYS_AHEAD', () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const py = readFileSync(join(repo, 'backend/app/api/routes/orders.py'), 'utf8');
  assert.match(py, new RegExp(`^MAX_DELIVERY_DAYS_AHEAD = ${MAX_DELIVERY_DAYS_AHEAD}\\b`, 'm'));
});
