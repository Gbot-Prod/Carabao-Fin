/// <reference types="node" />
// Run with `npm test`. CF-0105.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderActions, orderRef, parseOrderId } from './orderDetail.ts';

test('cancel only while preparing, confirm only in transit (as the backend)', () => {
  assert.deepEqual(orderActions('processing'), { canCancel: true, canConfirm: false, canTrack: true });
  assert.deepEqual(orderActions('shipped'), { canCancel: false, canConfirm: true, canTrack: true });
  assert.deepEqual(orderActions('out_for_delivery'), { canCancel: false, canConfirm: true, canTrack: true });
  for (const s of ['pending', 'delivered', 'cancelled', 'payment_mismatch', 'something_new']) {
    assert.deepEqual(orderActions(s), { canCancel: false, canConfirm: false, canTrack: false }, s);
  }
});

test('order reference matches backend order_ref', () => {
  assert.equal(orderRef(42, '2026-11-19T08:00:00Z'), 'CB-2026-0042');
  assert.equal(orderRef(12345, '2025-01-01'), 'CB-2025-12345');
  assert.equal(orderRef(7, null), 'CB-XXXX-0007');
  assert.equal(orderRef(7, 'garbage'), 'CB-XXXX-0007');
});

test('order id parameter: plain positive whole numbers only', () => {
  assert.equal(parseOrderId('42'), 42);
  assert.equal(parseOrderId('1'), 1);
  for (const bad of [undefined, '', '0', '-1', '01', ' 7', '7 ', '1e3', '0x10', '3.5', '7/../x', 'abc', '12345678901']) {
    assert.equal(parseOrderId(bad), null, String(bad));
  }
  assert.equal(parseOrderId(['42']), null);
});
