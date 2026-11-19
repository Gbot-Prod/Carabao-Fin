// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_RATE_RULES, authRateLimit, authRateLimitStorage } from './auth-rate-limit.ts';

test('limits are on in production and on request locally', () => {
  assert.equal(authRateLimit({ NODE_ENV: 'production' }).enabled, true);
  assert.equal(authRateLimit({ NODE_ENV: 'development' }).enabled, false);
  assert.equal(authRateLimit({ NODE_ENV: 'development', BETTER_AUTH_RATE_LIMIT: 'true' }).enabled, true);
});

test('storage is memory unless database is asked for exactly', () => {
  assert.equal(authRateLimitStorage({}), 'memory');
  assert.equal(authRateLimitStorage({ BETTER_AUTH_RATE_LIMIT_STORAGE: ' Database ' }), 'database');
  assert.equal(authRateLimitStorage({ BETTER_AUTH_RATE_LIMIT_STORAGE: 'redis' }), 'memory');
  assert.equal(authRateLimit({ BETTER_AUTH_RATE_LIMIT_STORAGE: 'database' }).storage, 'database');
});

test('credential and second-step endpoints have strict rules', () => {
  for (const path of ['/sign-in/email', '/sign-in/phone-number', '/two-factor/verify-totp', '/two-factor/verify-backup-code', '/two-factor/verify-otp']) {
    const rule = AUTH_RATE_RULES[path];
    assert.ok(rule, path);
    assert.ok(rule.max <= 10 && rule.window >= 900, path);
  }
  assert.ok(authRateLimit({}).max <= 100);
});
