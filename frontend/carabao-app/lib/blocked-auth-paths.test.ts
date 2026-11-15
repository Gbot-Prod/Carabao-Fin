// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedAuthPath } from './blocked-auth-paths.ts';

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
