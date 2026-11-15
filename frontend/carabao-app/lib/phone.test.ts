// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayEmail, formatPhMobile, isPlaceholderEmail, normalizePhMobile } from './phone.ts';

test('every way of writing a PH mobile number becomes +639XXXXXXXXX', () => {
  for (const typed of [
    '09123456789', '0912 345 6789', '0912-345-6789', '9123456789',
    '912 345 6789', '+639123456789', '+63 912 345 6789', '639123456789', '(0912) 345 6789',
  ]) {
    assert.equal(normalizePhMobile(typed), '+639123456789', typed);
  }
});

test('anything else is refused, so one number can only sign up once', () => {
  for (const typed of [
    '', '12345', '0812 345 6789', '+1 555 123 4567', '091234567890', '+63 812 345 6789', '09123abc789',
  ]) {
    assert.equal(normalizePhMobile(typed), null, typed);
  }
});

test('phone signup placeholder emails are never shown', () => {
  assert.equal(isPlaceholderEmail('639123456789@phone.carabao.invalid'), true);
  assert.equal(displayEmail('639123456789@Phone.Carabao.Invalid'), null);
  assert.equal(displayEmail('juan@example.com'), 'juan@example.com');
  assert.equal(displayEmail(null), null);
});

test('stored numbers display grouped', () => {
  assert.equal(formatPhMobile('+639123456789'), '+63 912 345 6789');
  assert.equal(formatPhMobile(null), '');
});
