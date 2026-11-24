// S15 (plan §5.10): the voucher checks the create form runs, the labels the list shows and the
// API body it sends. Every rule and word here is the web merchant lib/vouchers.ts (CF-0061);
// the backend checks the same ones again (schemas/voucher.py, services/vouchers.check_rules).
/// <reference types="node" />
// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVoucherInput,
  canDelete,
  checkVoucherDraft,
  CODE_MAX_LENGTH,
  CODE_MESSAGE,
  CODE_PATTERN,
  deleteConfirmText,
  describeVoucher,
  draftToInput,
  EMPTY_DRAFT,
  firstVoucherError,
  lastDay,
  MAX_PERCENT,
  usesLabel,
  voucherSaveErrors,
  voucherStatus,
  type VoucherDraft,
} from './vouchers.ts';
import type { ApiVoucher } from './api.ts';

/** A draft that passes every check; a test overrides the boxes it is about. */
const draft = (over: Partial<VoucherDraft> = {}): VoucherDraft => ({
  code: 'SAVE10',
  kind: 'percent',
  value: '10',
  minSubtotal: '',
  maxDiscount: '',
  usageLimit: '',
  perUserLimit: '1',
  startsOn: '',
  endsOn: '',
  ...over,
});

/** A stored voucher as the API sends it: on, 10% off, never used. */
const voucher = (over: Partial<ApiVoucher> = {}): ApiVoucher => ({
  id: 1,
  code: 'SAVE10',
  kind: 'percent',
  value: 10,
  min_subtotal: 0,
  max_discount: null,
  usage_limit: null,
  per_user_limit: 1,
  starts_at: null,
  expires_at: null,
  active: true,
  created_at: '2026-11-24T09:00:00+08:00',
  uses: 0,
  ...over,
});

test('S15 code pattern and limits = the web lib/vouchers.ts', () => {
  assert.equal(CODE_MAX_LENGTH, 32);
  assert.equal(MAX_PERCENT, 90);
  for (const code of ['SAVE10', 'AB-12', 'A12', 'X'.repeat(32)]) {
    assert.ok(CODE_PATTERN.test(code), code);
  }
  for (const code of ['AB', 'save10', '-SAVE10', 'SAVE 10', 'X'.repeat(33)]) {
    assert.ok(!CODE_PATTERN.test(code), code);
  }
  // A new form is percent off, one use per buyer (the backend's defaults).
  assert.deepEqual(EMPTY_DRAFT, {
    code: '', kind: 'percent', value: '', minSubtotal: '', maxDiscount: '',
    usageLimit: '', perUserLimit: '1', startsOn: '', endsOn: '',
  });
});

test('S15 checkVoucherDraft accepts a filled form and names each box it refuses', () => {
  assert.deepEqual(checkVoucherDraft(draft()), {});
  assert.deepEqual(checkVoucherDraft(draft({ code: ' save10 ', minSubtotal: '500', usageLimit: '100', endsOn: '2026-12-31' })), {});

  // The code goes as the web's words, the same sentence the web form shows.
  assert.deepEqual(checkVoucherDraft(draft({ code: 'AB' })), { code: CODE_MESSAGE });
  // The discount: a whole number, 1 to 90 for a percent voucher (0 and 91 both fail).
  for (const value of ['', '0', 'abc', '9.5']) {
    assert.equal(checkVoucherDraft(draft({ value })).value, 'Enter the discount as a whole number.', value);
  }
  assert.equal(checkVoucherDraft(draft({ value: '91' })).value, 'A percent voucher is 1 to 90 %.');
  // A fixed amount has no percent cap.
  assert.deepEqual(checkVoucherDraft(draft({ kind: 'fixed', value: '5000' })), {});

  // Each optional amount: blank is fine, "0" is not (the web says "1 or more").
  assert.equal(checkVoucherDraft(draft({ minSubtotal: 'x' })).minSubtotal, 'Minimum spend must be a whole number, 0 or more.');
  assert.equal(checkVoucherDraft(draft({ maxDiscount: '0' })).maxDiscount, 'Maximum discount must be a whole number, 1 or more.');
  assert.equal(checkVoucherDraft(draft({ usageLimit: '0' })).usageLimit, 'Total uses must be a whole number, 1 or more.');
  assert.deepEqual(checkVoucherDraft(draft({ perUserLimit: '' })), {});
  // A cap belongs to a percent voucher only, as the web sends it.
  assert.deepEqual(checkVoucherDraft(draft({ kind: 'fixed', maxDiscount: 'x' })), {});
});

test('S15 dates: real days, in order (the web date inputs cannot send a bad day)', () => {
  assert.equal(checkVoucherDraft(draft({ startsOn: '2026-02-30' })).startsOn, 'The first day must be a real date, like 2026-12-31.');
  assert.equal(checkVoucherDraft(draft({ endsOn: '31-12-2026' })).endsOn, 'The last day must be a real date, like 2026-12-31.');
  assert.deepEqual(
    checkVoucherDraft(draft({ startsOn: '2026-12-31', endsOn: '2026-12-31' })),
    {},
  );
  assert.equal(
    checkVoucherDraft(draft({ startsOn: '2026-12-31', endsOn: '2026-12-30' })).endsOn,
    'The last day must be on or after the first day.',
  );
});

test('S15 firstVoucherError follows the web draftToInput order', () => {
  assert.equal(firstVoucherError({}), null);
  assert.equal(
    firstVoucherError(checkVoucherDraft(draft({ code: 'AB', value: '0', endsOn: 'x' }))),
    CODE_MESSAGE,
  );
  assert.equal(firstVoucherError({ value: 'v', usageLimit: 'u' }), 'v');
  // draftToInput is the same answer in the web's shape.
  assert.deepEqual(draftToInput(draft({ code: 'AB' })), { error: CODE_MESSAGE });
});

test('S15 buildVoucherInput sends the web body: upper case, whole pesos, Manila days', () => {
  assert.deepEqual(
    buildVoucherInput(draft({
      code: ' save10 ', minSubtotal: '500', maxDiscount: '50', usageLimit: '100',
      perUserLimit: '2', startsOn: '2026-12-01', endsOn: '2026-12-31',
    })),
    {
      code: 'SAVE10', kind: 'percent', value: 10, min_subtotal: 500, max_discount: 50,
      usage_limit: 100, per_user_limit: 2, active: true,
      // A day starts at 00:00 in Manila (UTC+8, no DST).
      starts_at: '2026-12-01T00:00:00+08:00',
      // expires_at is exclusive, so the last day is the day after the one typed.
      expires_at: '2027-01-01T00:00:00+08:00',
    },
  );
  // Blank options: no minimum, no caps, no days; a fixed voucher never carries a cap.
  assert.deepEqual(buildVoucherInput(draft({ kind: 'fixed', value: '100', maxDiscount: '50' })), {
    code: 'SAVE10', kind: 'fixed', value: 100, min_subtotal: 0, max_discount: null,
    usage_limit: null, per_user_limit: 1, starts_at: null, expires_at: null, active: true,
  });
  // The last day of the year still rolls over.
  assert.equal(
    buildVoucherInput(draft({ endsOn: '2026-12-31' })).expires_at,
    '2027-01-01T00:00:00+08:00',
  );
  const made = draftToInput(draft());
  assert.ok('input' in made);
  assert.equal(made.input.value, 10);
});

test('S15 list labels: what a code takes off, its uses and its status', () => {
  assert.equal(describeVoucher(voucher()), '10% off');
  assert.equal(describeVoucher(voucher({ max_discount: 50 })), '10% off (up to ₱50)');
  assert.equal(describeVoucher(voucher({ max_discount: 50, min_subtotal: 500 })), '10% off (up to ₱50), min. ₱500');
  assert.equal(describeVoucher(voucher({ kind: 'fixed', value: 100 })), '₱100 off');
  assert.equal(describeVoucher(voucher({ kind: 'fixed', value: 1000, min_subtotal: 500 })), '₱1,000 off, min. ₱500');

  assert.equal(usesLabel(voucher({ uses: 3 })), '3');
  assert.equal(usesLabel(voucher({ uses: 3, usage_limit: 100 })), '3 / 100');
  assert.equal(usesLabel(voucher({ uses: 3, usage_limit: 100, per_user_limit: 2 })), '3 / 100 (2 per buyer)');

  const now = new Date('2026-11-24T10:00:00+08:00');
  assert.equal(voucherStatus(voucher({ active: false }), now), 'off');
  assert.equal(voucherStatus(voucher({ starts_at: '2026-12-01T00:00:00+08:00' }), now), 'scheduled');
  assert.equal(voucherStatus(voucher({ starts_at: '2026-11-01T00:00:00+08:00' }), now), 'active');
  assert.equal(voucherStatus(voucher({ expires_at: '2026-11-24T10:00:00+08:00' }), now), 'expired');
  assert.equal(voucherStatus(voucher({ usage_limit: 5, uses: 5 }), now), 'used up');
  assert.equal(voucherStatus(voucher({ usage_limit: 5, uses: 4 }), now), 'active');
  // Off wins over the dates: a code that is off is simply off.
  assert.equal(voucherStatus(voucher({ active: false, expires_at: '2020-01-01T00:00:00+08:00' }), now), 'off');

  // expires_at is the first moment it stops; the list shows its day before.
  assert.equal(lastDay('2027-01-01T00:00:00+08:00'), '2026-12-31T15:59:59.999Z');
  assert.equal(lastDay('2026-12-31T00:00:00+08:00'), '2026-12-30T15:59:59.999Z');
});

test('S15 delete only on a code no order used (CF-0061)', () => {
  assert.equal(canDelete(voucher()), true);
  assert.equal(canDelete(voucher({ uses: 1 })), false);
  assert.equal(deleteConfirmText('SAVE10'), 'Delete voucher SAVE10?');
});

test('S15 voucherSaveErrors puts server messages under their box (plan rule 8)', () => {
  assert.deepEqual(voucherSaveErrors(null, { code: 'Code taken' }), {
    fields: { code: 'Code taken' },
    top: null,
  });
  // The backend's names land on the form's boxes.
  assert.deepEqual(
    voucherSaveErrors(null, { min_subtotal: 'a', max_discount: 'b', per_user_limit: 'c', expires_at: 'd' }),
    {
      fields: { minSubtotal: 'a', maxDiscount: 'b', perUserLimit: 'c', endsOn: 'd' },
      top: null,
    },
  );
  // No box for it: the top of the form, once each.
  assert.deepEqual(voucherSaveErrors('Something broke', { kind: 'x', unknown: 'x' }), {
    fields: {},
    top: 'x',
  });
  // A plain message (network, 5xx, 409) is the top when no field took it.
  assert.deepEqual(voucherSaveErrors(' Could not save. '), { fields: {}, top: 'Could not save.' });
  // A field message shows alone; the general one does not repeat above it.
  assert.deepEqual(voucherSaveErrors('Could not save.', { value: 'Bad value' }), {
    fields: { value: 'Bad value' },
    top: null,
  });
  assert.deepEqual(voucherSaveErrors(null, { code: '  ' }), { fields: {}, top: null });
});
