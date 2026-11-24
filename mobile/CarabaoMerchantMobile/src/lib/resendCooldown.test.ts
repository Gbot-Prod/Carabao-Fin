// S17: the OTP resend timer (src/lib/resendCooldown.ts), case for case from the web
// hooks/useResendCooldown.ts and lib/otp-cooldown.ts. `npm test`.
/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANY_TARGET,
  anyRunning,
  formatCountdown,
  OTP_RESEND_SECONDS,
  retryAfterFromError,
  secondsLeft,
  startFromError,
  startTimer,
} from './resendCooldown.ts';

const T0 = 1_000_000;

test('a sent code waits a minute for that target only', () => {
  const timers = startTimer({}, '9171234567', T0);
  assert.equal(OTP_RESEND_SECONDS, 60);
  assert.equal(secondsLeft(timers, '9171234567', T0), 60);
  assert.equal(secondsLeft(timers, '9171234567', T0 + 15_500), 45);
  assert.equal(secondsLeft(timers, '9181234567', T0), 0, 'a corrected number gets a code at once');
  assert.equal(secondsLeft(timers, '9171234567', T0 + 60_000), 0);
  assert.equal(anyRunning(timers, T0 + 59_999), true);
  assert.equal(anyRunning(timers, T0 + 60_000), false);
});

test('starting a timer drops the finished ones', () => {
  const first = startTimer({}, 'a', T0);
  const second = startTimer(first, 'b', T0 + 61_000);
  assert.deepEqual(Object.keys(second), ['b']);
});

test('retryAfterFromError reads a field, the header, then the words', () => {
  assert.equal(retryAfterFromError(null), null);
  assert.equal(retryAfterFromError({ retryAfter: 12.2 }), 13);
  assert.equal(retryAfterFromError({ response: { status: 429, headers: { 'retry-after': '30' } } }), 30);
  // The backend's own sentence (app/services/otp.py reserve_send), as this app's ApiError holds it.
  assert.equal(
    retryAfterFromError({ status: 429, message: 'Please wait 42 seconds before requesting another code.' }),
    42,
  );
  assert.equal(retryAfterFromError({ message: 'Try again in 5 minutes.' }), 300);
  assert.equal(retryAfterFromError({ status: 400, message: 'Wrong code.' }), null);
});

test('a refusal restarts the timer; a wait past the cooldown blocks every target', () => {
  const short = startFromError({}, 'x', { message: 'Please wait 20 seconds' }, T0);
  assert.equal(secondsLeft(short, 'x', T0), 20);
  assert.equal(secondsLeft(short, 'y', T0), 0);

  const hourly = startFromError({}, 'x', { message: 'Try again in 10 minutes.' }, T0);
  assert.ok(ANY_TARGET in hourly);
  assert.equal(secondsLeft(hourly, 'y', T0), 600);

  const none = {};
  assert.equal(startFromError(none, 'x', new Error('boom'), T0), none);
});

test('the countdown reads as the web formatCountdown', () => {
  assert.equal(formatCountdown(45), '0:45');
  assert.equal(formatCountdown(720), '12:00');
  assert.equal(formatCountdown(-3), '0:00');
  assert.equal(formatCountdown(59.2), '1:00');
});
