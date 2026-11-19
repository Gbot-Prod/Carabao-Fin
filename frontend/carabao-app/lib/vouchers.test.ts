// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_DRAFT, describeVoucher, draftToInput, normalizeBuyerCode, voucherStatus } from './vouchers.ts';
import type { Voucher } from '../util/api/vouchers.ts';

const base: Voucher = {
  id: 1, code: 'SAVE10', kind: 'percent', value: 10, min_subtotal: 0, max_discount: null,
  usage_limit: null, per_user_limit: 1, starts_at: null, expires_at: null, active: true,
  created_at: null, uses: 0,
};

test('describes percent and fixed vouchers', () => {
  assert.equal(describeVoucher(base), '10% off');
  assert.equal(describeVoucher({ ...base, max_discount: 50, min_subtotal: 500 }), '10% off (up to ₱50), min. ₱500');
  assert.equal(describeVoucher({ ...base, kind: 'fixed', value: 1000 }), '₱1,000 off');
});

test('status follows on/off, dates and the use cap', () => {
  const now = new Date('2026-11-19T04:00:00Z');
  assert.equal(voucherStatus(base, now), 'active');
  assert.equal(voucherStatus({ ...base, active: false }, now), 'off');
  assert.equal(voucherStatus({ ...base, starts_at: '2026-11-20T00:00:00+08:00' }, now), 'scheduled');
  assert.equal(voucherStatus({ ...base, expires_at: '2026-11-19T00:00:00+08:00' }, now), 'expired');
  assert.equal(voucherStatus({ ...base, usage_limit: 3, uses: 3 }, now), 'used up');
});

test('a good draft becomes the API body, dates on the Manila calendar', () => {
  const r = draftToInput({
    ...EMPTY_DRAFT, code: ' harvest-25 ', value: '15', maxDiscount: '100', minSubtotal: '300',
    usageLimit: '50', perUserLimit: '2', startsOn: '2026-12-01', endsOn: '2026-12-31',
  });
  assert.ok('input' in r);
  assert.deepEqual(r.input, {
    code: 'HARVEST-25', kind: 'percent', value: 15, min_subtotal: 300, max_discount: 100,
    usage_limit: 50, per_user_limit: 2, starts_at: '2026-12-01T00:00:00+08:00',
    expires_at: '2027-01-01T00:00:00+08:00', active: true,
  });
  const fixed = draftToInput({ ...EMPTY_DRAFT, code: 'LESS50', kind: 'fixed', value: '50', maxDiscount: '9' });
  assert.ok('input' in fixed);
  assert.equal(fixed.input.max_discount, null); // only for percent
  assert.equal(fixed.input.min_subtotal, 0);
});

test('bad drafts give a message, not a body', () => {
  for (const d of [
    { code: 'ab', value: '10' },
    { code: 'bad code', value: '10' },
    { code: 'OK10', value: '' },
    { code: 'OK10', value: '1.5' },
    { code: 'OK10', value: '95' },
    { code: 'OK10', value: '10', usageLimit: '0' },
    { code: 'OK10', value: '10', minSubtotal: '-5' },
    { code: 'OK10', value: '10', startsOn: '2026-12-10', endsOn: '2026-12-01' },
  ]) {
    const r = draftToInput({ ...EMPTY_DRAFT, ...d });
    assert.ok('error' in r, JSON.stringify(d));
  }
});

test('a typed buyer code is normalised or refused before any request', () => {
  assert.equal(normalizeBuyerCode('  save10 '), 'SAVE10');
  assert.equal(normalizeBuyerCode('harvest-25'), 'HARVEST-25');
  for (const bad of ['', 'ab', 'bad code', '-START', 'x'.repeat(33), '<script>']) {
    assert.equal(normalizeBuyerCode(bad), null, bad);
  }
});
