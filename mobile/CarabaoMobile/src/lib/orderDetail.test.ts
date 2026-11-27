/// <reference types="node" />
// Run with `npm test`. CF-0105.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chatTitle, deliveryProofState, isOrderRef, orderActions, orderRef, parseOrderId,
} from './orderDetail.ts';

test('cancel only while preparing, no confirm while in transit (as the backend)', () => {
  const none = { canCancel: false, canCancelUnpaid: false, canTrack: false };
  assert.deepEqual(orderActions('processing'), { ...none, canCancel: true, canTrack: true });
  assert.deepEqual(orderActions('shipped'), { ...none, canTrack: true });
  assert.deepEqual(orderActions('out_for_delivery'), { ...none, canTrack: true });
  assert.deepEqual(orderActions('pending'), { ...none, canCancelUnpaid: true }); // CF-0124
  for (const s of ['delivered', 'cancelled', 'payment_mismatch', 'something_new']) {
    assert.deepEqual(orderActions(s), none, s);
  }
});

test('order reference matches backend order_ref', () => {
  assert.equal(orderRef(42, '2026-11-19T08:00:00Z'), 'CB-2026-0042');
  assert.equal(orderRef(12345, '2025-01-01'), 'CB-2025-12345');
  assert.equal(orderRef(7, null), 'CB-XXXX-0007');
  assert.equal(orderRef(7, 'garbage'), 'CB-XXXX-0007');
});

test('order reference check accepts only the backend form', () => {
  assert.equal(isOrderRef(orderRef(42, '2026-01-01')), true);
  assert.equal(isOrderRef('CB-XXXX-0007'), true);
  for (const bad of ['CB-2026-42', 'Pay at evil.example', 'cb-2026-0042', '', undefined, 42]) {
    assert.equal(isOrderRef(bad), false, String(bad));
  }
});

test('chat title: only the form the app sends; never a fake support header', () => {
  assert.equal(chatTitle('Chat with Dela Cruz Farm', false, 7), 'Chat with Dela Cruz Farm');
  assert.equal(chatTitle('Chat with Carabao Support', false, 7), 'Order #7');
  assert.equal(chatTitle('Your account is locked, call 0917…', false, 7), 'Order #7');
  assert.equal(chatTitle(`Chat with ${'x'.repeat(81)}`, false, 7), 'Order #7');
  assert.equal(chatTitle('Chat with A\nB', false, null), 'Order chat');
  assert.equal(chatTitle(undefined, true, null), 'Carabao support');
});

test('order id parameter: plain positive whole numbers only', () => {
  assert.equal(parseOrderId('42'), 42);
  assert.equal(parseOrderId('1'), 1);
  for (const bad of [undefined, '', '0', '-1', '01', ' 7', '7 ', '1e3', '0x10', '3.5', '7/../x', 'abc', '12345678901']) {
    assert.equal(parseOrderId(bad), null, String(bad));
  }
  assert.equal(parseOrderId(['42']), null);
});

test('delivery photos card: dispute states of a farm-marked delivery', () => {
  const base = { status: 'delivered', delivery_confirmed_by: 'merchant', can_dispute: true };
  assert.equal(deliveryProofState(base), 'open');
  assert.equal(deliveryProofState({ ...base, can_dispute: false }), 'closed');
  assert.equal(deliveryProofState({ ...base, delivery_buyer_confirmed_at: 'x' }), 'confirmed');
  assert.equal(deliveryProofState({ ...base, delivery_disputed_at: 'x' }), 'disputed');
  assert.equal(deliveryProofState({ ...base, delivery_disputed_at: 'x', dispute_resolution: 'refund' }), 'refund');
  // Not a farm-marked delivery: no dispute card.
  assert.equal(deliveryProofState({ ...base, delivery_confirmed_by: 'buyer' }), null);
  assert.equal(deliveryProofState({ ...base, status: 'shipped' }), null);
});
