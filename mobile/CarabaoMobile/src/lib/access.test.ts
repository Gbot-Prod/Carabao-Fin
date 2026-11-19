/// <reference types="node" />
// Run with `npm test`. CF-0120.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAccess } from './access.ts';
import { emitSessionExpired, onSessionExpired, resetSessionEventsForTest, sessionGone } from './sessionEvents.ts';

const signedIn = { isLoading: false, isAuthenticated: true };

test('sign-in first, then the role', () => {
  assert.equal(decideAccess({ isLoading: true, isAuthenticated: false }, 'merchant', 'idle'), 'wait');
  assert.equal(decideAccess({ isLoading: false, isAuthenticated: false }, undefined, 'idle'), 'signin');
  assert.equal(decideAccess(signedIn, undefined, 'idle'), 'allowed');
  assert.equal(decideAccess(signedIn, 'user', 'idle'), 'allowed');
});

test('merchant screens wait for the server, then allow only merchants', () => {
  assert.equal(decideAccess(signedIn, 'merchant', 'idle'), 'wait');
  assert.equal(decideAccess(signedIn, 'merchant', 'loading'), 'wait');
  assert.equal(decideAccess(signedIn, 'merchant', 'error'), 'error');
  assert.equal(decideAccess(signedIn, 'merchant', { isMerchant: false }), 'forbidden');
  assert.equal(decideAccess(signedIn, 'merchant', { isMerchant: true }), 'allowed');
});

test('admin screens are never open on mobile (ADMIN_WEB_ONLY)', () => {
  assert.equal(decideAccess(signedIn, 'admin', { isMerchant: true }), 'forbidden');
});

test('session expiry: only a signed-in 401 after the refresh, and only once in a burst', () => {
  assert.equal(sessionGone(401, true, true), true);
  assert.equal(sessionGone(401, true, false), false); // first 401: retry with a fresh token
  assert.equal(sessionGone(401, false, true), false); // public call
  assert.equal(sessionGone(403, true, true), false); // forbidden is not signed out
  resetSessionEventsForTest();
  let calls = 0;
  const off = onSessionExpired(() => { calls += 1; });
  assert.equal(emitSessionExpired(10_000), true);
  assert.equal(emitSessionExpired(12_000), false); // same burst
  assert.equal(emitSessionExpired(20_000), true);
  off();
  emitSessionExpired(40_000);
  assert.equal(calls, 2);
});
