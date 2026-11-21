// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TURNSTILE_SITEVERIFY_URL, needsCaptcha, verifyTurnstile } from './captcha.ts';

test('needsCaptcha covers every code-sending path, however it is spelled', () => {
  assert.equal(needsCaptcha('/api/auth/phone-number/send-otp'), true);
  assert.equal(needsCaptcha('/api/auth/phone-number/request-password-reset'), true);
  assert.equal(needsCaptcha('/api/auth/request-password-reset'), true);
  assert.equal(needsCaptcha('/api/auth/Phone-Number/Send-OTP'), true);
  assert.equal(needsCaptcha('/api/auth//phone-number/send-otp/'), true);
  assert.equal(needsCaptcha('/api/auth/phone-number/send%2Dotp'), true);
});

test('needsCaptcha leaves other endpoints alone', () => {
  assert.equal(needsCaptcha('/api/auth/phone-number/verify'), false);
  assert.equal(needsCaptcha('/api/auth/sign-in/email'), false);
  assert.equal(needsCaptcha('/api/auth/reset-password'), false);
  assert.equal(needsCaptcha('/api/auth/get-session'), false);
  assert.equal(needsCaptcha('/phone-number/send-otp'), false);
});

const fakeFetch = (response: Response | Error) =>
  (async (url: unknown, init?: RequestInit) => {
    assert.equal(url, TURNSTILE_SITEVERIFY_URL);
    assert.deepEqual(JSON.parse(String(init?.body)), { secret: 's', response: 't' });
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;

test('verifyTurnstile reads Cloudflare\'s answer', async () => {
  const ok = await verifyTurnstile({ token: 't', secret: 's', fetchImpl: fakeFetch(Response.json({ success: true })) });
  assert.equal(ok, 'ok');
  const failed = await verifyTurnstile({
    token: 't',
    secret: 's',
    fetchImpl: fakeFetch(Response.json({ success: false, 'error-codes': ['invalid-input-response'] })),
  });
  assert.equal(failed, 'failed');
});

test('verifyTurnstile reports Cloudflare being unreachable', async () => {
  assert.equal(
    await verifyTurnstile({ token: 't', secret: 's', fetchImpl: fakeFetch(new Error('network')) }),
    'unavailable',
  );
  assert.equal(
    await verifyTurnstile({ token: 't', secret: 's', fetchImpl: fakeFetch(new Response('', { status: 500 })) }),
    'unavailable',
  );
});
