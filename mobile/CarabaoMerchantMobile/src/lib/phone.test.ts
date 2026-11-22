// Shared with mobile/CarabaoMobile/src/lib/phone.test.ts. Keep both copies the same (sharedCopies.test.ts).
/// <reference types="node" />
// Run with `npm test`. CF-0106. Same cases as backend phone_verification.normalize_ph_mobile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPhMobile, normalizePhMobile } from './phone.ts';

test('every common way to write a PH mobile number gives +639XXXXXXXXX', () => {
  for (const input of ['09123456789', '0912 345 6789', '0912-345-6789', '(0912) 345 6789', '9123456789',
    '639123456789', '+639123456789', '+63 912 345 6789', '  09123456789  ']) {
    assert.equal(normalizePhMobile(input), '+639123456789', input);
  }
});

test('landlines, short, long, foreign and non-digit numbers are refused', () => {
  for (const input of ['', '0212345678', '0812345678', '091234567', '091234567890', '+19123456789',
    '+6391234567a', '63-8123456789', 'abc']) {
    assert.equal(normalizePhMobile(input), null, input);
  }
});

test('display form groups the digits; other values pass through', () => {
  assert.equal(formatPhMobile('+639123456789'), '+63 912 345 6789');
  assert.equal(formatPhMobile('0912'), '0912');
  assert.equal(formatPhMobile(null), '');
  assert.equal(formatPhMobile(undefined), '');
});
