/// <reference types="node" />
// Run with `npm test`. CF-0115.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeOrderFailure } from './checkoutOptions.ts';

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
