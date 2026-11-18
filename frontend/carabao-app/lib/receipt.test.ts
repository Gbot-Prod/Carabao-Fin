import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasReceipt, receiptPeso, refundNote, shortReference } from './receipt.ts';

// CF-0049
test('receipts exist once money landed, also after a refund', () => {
  for (const s of ['paid', 'refund_pending', 'refunded']) assert.equal(hasReceipt(s), true, s);
  for (const s of ['awaiting_payment', 'unpaid', '', null, undefined]) assert.equal(hasReceipt(s), false, String(s));
});

test('pesos are whole and grouped', () => {
  assert.equal(receiptPeso(1234), '₱1,234');
  assert.equal(receiptPeso(0), '₱0');
  assert.equal(receiptPeso(Number.NaN), '₱0');
});

test('refund notes and short references', () => {
  assert.equal(refundNote('paid'), null);
  assert.match(refundNote('refunded') ?? '', /refunded/);
  assert.match(refundNote('refund_pending') ?? '', /in progress/);
  assert.equal(shortReference('pay_abcdefghijk123456'), '…123456');
  assert.equal(shortReference('pay_1'), 'pay_1');
  assert.equal(shortReference(null), null);
});
