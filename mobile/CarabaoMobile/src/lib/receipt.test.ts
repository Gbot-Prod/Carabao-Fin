/// <reference types="node" />
// Run with `npm test`. CF-0135 (M54). The first three tests are the web lib/receipt.test.ts cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  hasReceipt, receiptFailure, receiptPeso, receiptShareText, receiptSummaryRows, refundNote,
  shortReference, RECEIPT_TEXT, WITH_RECEIPT,
} from './receipt.ts';

const repo = (p: string) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');

test('CF-0135 receipts exist once money landed, also after a refund', () => {
  for (const s of ['paid', 'refund_pending', 'refunded']) assert.equal(hasReceipt(s), true, s);
  for (const s of ['awaiting_payment', 'unpaid', '', null, undefined]) assert.equal(hasReceipt(s), false, String(s));
});

test('CF-0135 pesos are whole and grouped', () => {
  assert.equal(receiptPeso(1234), '₱1,234');
  assert.equal(receiptPeso(0), '₱0');
  assert.equal(receiptPeso(Number.NaN), '₱0');
});

test('CF-0135 refund notes and short references', () => {
  assert.equal(refundNote('paid'), null);
  assert.match(refundNote('refunded') ?? '', /refunded/);
  assert.match(refundNote('refund_pending') ?? '', /in progress/);
  assert.equal(shortReference('pay_abcdefghijk123456'), '…123456');
  assert.equal(shortReference('pay_1'), 'pay_1');
  assert.equal(shortReference(null), null);
});

test('CF-0135 failures map like the web page (404, 409, else retry)', () => {
  assert.equal(receiptFailure(404), 'missing');
  assert.equal(receiptFailure(409), 'unpaid');
  assert.equal(receiptFailure(500), 'error');
  assert.equal(receiptFailure(undefined), 'error');
});

test('CF-0135 summary rows show the server amounts, voucher only when used', () => {
  const plain = receiptSummaryRows({ subtotal: 500, delivery_fee: 80, discount: 0, voucher_code: null, total: 580 });
  assert.deepEqual(plain.map((r) => r.label), ['Subtotal', 'Delivery', 'Total paid']);
  const withVoucher = receiptSummaryRows({ subtotal: 1500, delivery_fee: 80, discount: 50, voucher_code: 'SAVE10', total: 1530 });
  assert.deepEqual(withVoucher.map((r) => [r.label, r.value]), [
    ['Subtotal', '₱1,500'], ['Delivery', '₱80'], ['Voucher (SAVE10)', '−₱50'], ['Total paid', '₱1,530'],
  ]);
  assert.equal(withVoucher.at(-1)?.total, true);
});

test('CF-0135 share text has the lines and totals but no address or phone', () => {
  const text = receiptShareText(
    {
      receipt_number: 'CB-2026-0042', order_id: 42, payment_status: 'refunded', farm_name: 'Mang Ben Farm',
      lines: [{ name: 'Kale', unit: 'kg', quantity: 2, unit_price: 250, line_total: 500 }],
      subtotal: 500, delivery_fee: 80, discount: 0, total: 580,
    },
    'Nov 20, 2026',
  );
  assert.match(text, /CB-2026-0042/);
  assert.match(text, /2 × Kale \(kg\) @ ₱250 = ₱500/);
  assert.match(text, /Total paid: ₱580/);
  assert.match(text, /This payment was refunded\./);
  assert.doesNotMatch(text, /Billed to|Delivery: \d/);
});

test('CF-0135 in step with web and backend', () => {
  const web = repo('frontend/carabao-app/lib/receipt.ts');
  const page = repo('frontend/carabao-app/app/(site)/(app)/orders/[orderId]/receipt/page.tsx');
  const backend = repo('backend/app/services/order_status.py');
  // receipt states = backend MONEY_RECEIVED_STATUSES = web WITH_RECEIPT
  const block = backend.match(/MONEY_RECEIVED_STATUSES = frozenset\(\s*\{([^}]*)\}/);
  assert.ok(block);
  const names = [...block[1].matchAll(/TransactionStatus\.([A-Z_]+)/g)].map((m) => m[1].toLowerCase()).sort();
  assert.deepEqual(names, [...WITH_RECEIPT].sort());
  for (const s of WITH_RECEIPT) assert.match(web, new RegExp(`'${s}'`));
  // same refund texts and page texts
  assert.match(web, /This payment was refunded\./);
  assert.match(web, /A refund for this payment is in progress\./);
  for (const t of Object.values(RECEIPT_TEXT)) assert.ok(page.includes(t), t);
  // the receipt route is still there with its 404 / 409
  const routes = repo('backend/app/api/routes/orders.py');
  assert.match(routes, /"\/orders\/me\/\{order_id\}\/receipt"/);
  assert.match(routes, /status_code=409, detail="This order has no payment yet, so no receipt\."/);
});
