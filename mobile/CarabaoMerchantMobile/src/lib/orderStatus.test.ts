// Shared with mobile/CarabaoMobile/src/lib/orderStatus.test.ts. Keep both copies the same (sharedCopies.test.ts).
/// <reference types="node" />
// Run with `npm test`. CF-0106.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDER_STATUSES, ORDER_STATUS_LABELS, isOrderStatus, orderStatusColor, orderStatusLabel, timelineIndex,
} from './orderStatus.ts';

test('every status has a label', () => {
  for (const s of ORDER_STATUSES) assert.ok(ORDER_STATUS_LABELS[s], s);
});

test('unknown statuses are shown readably, not as snake_case', () => {
  assert.equal(isOrderStatus('on_hold'), false);
  assert.equal(orderStatusLabel('on_hold'), 'On hold');
  assert.equal(orderStatusLabel('processing'), 'Preparing');
});

test('colours group the statuses', () => {
  assert.equal(orderStatusColor('delivered'), 'green');
  assert.equal(orderStatusColor('shipped'), 'blue');
  assert.equal(orderStatusColor('out_for_delivery'), 'blue');
  assert.equal(orderStatusColor('processing'), 'yellow');
  for (const s of ['pending', 'cancelled', 'payment_mismatch', 'x']) assert.equal(orderStatusColor(s), 'gray', s);
});

test('timeline: in order, cancelled and payment problems are not steps', () => {
  assert.deepEqual(
    ['pending', 'processing', 'shipped', 'out_for_delivery', 'delivered'].map(timelineIndex),
    [0, 1, 2, 3, 4],
  );
  assert.equal(timelineIndex('cancelled'), -1);
  assert.equal(timelineIndex('payment_mismatch'), -1);
});
