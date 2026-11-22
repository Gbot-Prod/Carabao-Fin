// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedAuthPath, isBlockedOnAdminSurface } from './blocked-auth-paths.ts';

test('every admin plugin endpoint is blocked', () => {
  for (const endpoint of [
    'ban-user', 'unban-user', 'set-role', 'remove-user', 'impersonate-user',
    'stop-impersonating', 'set-user-password', 'create-user', 'update-user',
    'list-users', 'get-user', 'list-user-sessions', 'revoke-user-session',
    'revoke-user-sessions', 'has-permission', 'some-future-endpoint',
  ]) {
    assert.equal(isBlockedAuthPath(`/api/auth/admin/${endpoint}`), true, endpoint);
  }
  assert.equal(isBlockedAuthPath('/api/auth/admin'), true);
});

test('spelling variants are blocked too', () => {
  for (const path of [
    '/api/auth/Admin/ban-user',
    '/api/auth//admin/ban-user',
    '/api/auth/admin/ban-user/',
    '/api/auth/%61dmin/impersonate-user',
    '/api/auth/admin%2Fset-role',
  ]) {
    assert.equal(isBlockedAuthPath(path), true, path);
  }
});

test('the rest of BetterAuth stays open', () => {
  for (const path of [
    '/api/auth/sign-in/email',
    '/api/auth/sign-up/email',
    '/api/auth/get-session',
    '/api/auth/token',
    '/api/auth/jwks',
    '/api/auth/request-password-reset',
    '/api/auth/two-factor/verify-totp',
    '/api/auth/administrator-notes', // only the exact /admin segment is closed
  ]) {
    assert.equal(isBlockedAuthPath(path), false, path);
  }
});

test('admin deploy: only its own endpoints are open', () => {
  for (const path of [
    '/api/auth/sign-in/email',
    '/api/auth/sign-out',
    '/api/auth/get-session',
    '/api/auth/token',
    '/api/auth/jwks',
    '/api/auth/two-factor/verify-totp',
    '/api/auth/two-factor/enable',
    '/api/auth/change-password',
    '/api/auth/update-user',
  ]) {
    assert.equal(isBlockedOnAdminSurface(path), false, path);
  }
  for (const path of [
    '/api/auth/sign-up/email',
    '/api/auth/sign-in/social',
    '/api/auth/sign-in/phone-number',
    '/api/auth/phone-number/send-otp',
    '/api/auth/phone-number/verify',
    '/api/auth/callback/google',
    // No password reset on the admin deploy (make_admin.py --recover instead).
    '/api/auth/request-password-reset',
    '/api/auth/reset-password',
    '/api/auth/reset-password/abc123',
    '/api/auth/set-password',
    '/api/auth/change-email',
    '/api/auth/admin/set-role',
    '/api/auth/Sign-In/Social',
    '/api/auth//sign-up/email',
    '/api/auth/sign-in/email-otp',
    '/api/auth/tokens',
  ]) {
    assert.equal(isBlockedOnAdminSurface(path), true, path);
  }
  // Not a Better Auth path: left to the rest of the app.
  assert.equal(isBlockedOnAdminSurface('/api/csp-report'), false);
});
