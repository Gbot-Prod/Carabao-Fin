// Run with `npm test`. CF-0131.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBuyerCode,
  payableAfterVoucher,
  voucherAppliedText,
  voucherCartKey,
  voucherDiscountLabel,
} from './vouchers.ts';

test('CF-0131 buyer code is trimmed and upper-cased (same cases as web)', () => {
  assert.equal(normalizeBuyerCode('  save10 '), 'SAVE10');
  assert.equal(normalizeBuyerCode('harvest-25'), 'HARVEST-25');
  assert.equal(normalizeBuyerCode('ab'), null);
  assert.equal(normalizeBuyerCode('-SAVE'), null);
  assert.equal(normalizeBuyerCode('SAVE 10'), null);
  assert.equal(normalizeBuyerCode('A'.repeat(33)), null);
  assert.equal(normalizeBuyerCode(''), null);
});

test('CF-0131 applied text and discount label match the web texts', () => {
  const v = { code: 'SAVE10', merchant_id: 3, merchant_name: 'Mang Ben Farm', discount: 50 };
  assert.equal(voucherAppliedText(v), 'SAVE10 applied: PHP 50.00 off Mang Ben Farm');
  assert.equal(voucherDiscountLabel(v), 'Voucher (SAVE10)');
});

test('CF-0131 payable is the total less the server discount, never below 0', () => {
  assert.equal(payableAfterVoucher(500, null), 500);
  assert.equal(payableAfterVoucher(500, { discount: 120 }), 380);
  assert.equal(payableAfterVoucher(100, { discount: 150 }), 0);
  assert.equal(payableAfterVoucher(500, { discount: -5 }), 500);
  assert.equal(payableAfterVoucher(500, { discount: Number.NaN }), 500);
});

test('CF-0131 cart key changes with a quantity, not with line order', () => {
  const a = voucherCartKey([{ produceId: 1, quantity: 2 }, { produceId: 5, quantity: 1 }]);
  const b = voucherCartKey([{ produceId: 5, quantity: 1 }, { produceId: 1, quantity: 2 }]);
  assert.equal(a, b);
  assert.notEqual(a, voucherCartKey([{ produceId: 1, quantity: 3 }, { produceId: 5, quantity: 1 }]));
});
