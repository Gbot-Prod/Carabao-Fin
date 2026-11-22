// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OTP_RESEND_SECONDS,
  OTP_SEND_PATHS,
  formatCountdown,
  resendWaitSeconds,
  retryAfterFromError,
} from './otp-cooldown.ts';

// BetterAuth 1.7.26's own row names (plugins/phone-number/routes.mjs). If an
// upgrade renames them, this fails instead of the resend wait silently stopping.
test('OTP_SEND_PATHS uses the rows BetterAuth writes', () => {
  assert.deepEqual(OTP_SEND_PATHS['/phone-number/send-otp']('+639171234567'), ['phone-number-otp-+639171234567']);
  assert.deepEqual(OTP_SEND_PATHS['/phone-number/request-password-reset']('+639171234567'), [
    'phone-number-reset-+639171234567',
    'phone-reset-wait-+639171234567',
  ]);
});

const now = new Date('2026-11-17T00:01:00Z');

test('resendWaitSeconds counts down from the last code', () => {
  assert.equal(resendWaitSeconds(null, now), 0);
  assert.equal(resendWaitSeconds(new Date('2026-11-17T00:00:59Z'), now), 59);
  assert.equal(resendWaitSeconds(new Date('2026-11-17T00:00:15.500Z'), now), 16);
  assert.equal(resendWaitSeconds(new Date('2026-11-17T00:00:00Z'), now), 0);
  assert.equal(resendWaitSeconds('2026-11-16T23:00:00Z', now), 0);
  // A clock skewed into the future never waits longer than the cooldown.
  assert.equal(resendWaitSeconds(new Date('2026-11-17T00:05:00Z'), now), OTP_RESEND_SECONDS);
});

test('retryAfterFromError reads each error shape', () => {
  assert.equal(retryAfterFromError({ retryAfter: 42 }), 42);
  assert.equal(retryAfterFromError({ response: { status: 429, headers: { 'retry-after': '30' } } }), 30);
  assert.equal(
    retryAfterFromError({ response: { status: 429, data: { detail: 'Too many codes requested. Please try again in 12 minutes.' } } }),
    720,
  );
  assert.equal(retryAfterFromError(new Error('Please wait 8 seconds before requesting another code.')), 8);
  assert.equal(retryAfterFromError(new Error('Invalid or expired verification code')), null);
  assert.equal(retryAfterFromError({ response: { status: 400, headers: { 'retry-after': '30' } } }), null);
  assert.equal(retryAfterFromError(null), null);
});

test('formatCountdown', () => {
  assert.equal(formatCountdown(45), '0:45');
  assert.equal(formatCountdown(60), '1:00');
  assert.equal(formatCountdown(720), '12:00');
  assert.equal(formatCountdown(-3), '0:00');
});
