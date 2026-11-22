// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enrolmentIdentifier,
  enrolmentLinkState,
  enrolmentTokenMatches,
  hashEnrolmentToken,
  isMobileRequest,
  sessionPassedTotp,
} from './admin-two-factor.ts';

const now = new Date('2026-11-16T00:00:00Z');
const later = new Date('2026-11-17T00:00:00Z');
const earlier = new Date('2026-11-15T00:00:00Z');

test('the identifier and hash match the backend (admin_enrolment.py)', () => {
  assert.equal(enrolmentIdentifier('abc'), 'admin-2fa-enrol-abc');
  // hashlib.sha256(b"token").hexdigest()
  assert.equal(
    hashEnrolmentToken('token'),
    '3c469e9d6c5875d37a43f353d4f88e61fcf812c66eee3457465a40b0da4153e0',
  );
});

test('only the right token, before it expires, matches', () => {
  const stored = { value: hashEnrolmentToken('right'), expiresAt: later };
  assert.equal(enrolmentTokenMatches('right', stored, now), true);
  assert.equal(enrolmentTokenMatches('wrong', stored, now), false);
  assert.equal(enrolmentTokenMatches('', stored, now), false);
  assert.equal(enrolmentTokenMatches(null, stored, now), false);
  assert.equal(enrolmentTokenMatches('right', null, now), false);
  assert.equal(enrolmentTokenMatches('right', { ...stored, expiresAt: earlier }, now), false);
  // The stored value is the hash, so the hash itself is not a token.
  assert.equal(enrolmentTokenMatches(stored.value, stored, now), false);
  // Dates read from the database can be strings.
  assert.equal(enrolmentTokenMatches('right', { ...stored, expiresAt: later.toISOString() }, now), true);
});

test('the setup page tells which link problem it is', () => {
  const row = { identifier: enrolmentIdentifier('me'), expiresAt: later };
  assert.equal(enrolmentLinkState(row, 'me', now), 'ok');
  assert.equal(enrolmentLinkState(row, 'someone-else', now), 'other-account');
  assert.equal(enrolmentLinkState({ ...row, expiresAt: earlier }, 'me', now), 'expired');
  assert.equal(enrolmentLinkState(null, 'me', now), 'replaced');
  // A row that is not a setup token is never this user's link.
  assert.equal(enrolmentLinkState({ identifier: 'trust-device-x', expiresAt: later }, 'me', now), 'other-account');
});

test('a session passed the code step only after a code', () => {
  assert.equal(sessionPassedTotp('/two-factor/verify-totp', false), true);
  assert.equal(sessionPassedTotp('/two-factor/verify-backup-code', true), true);
  // Password sign-in with 2FA on: the plugin keeps the session only for a
  // device that was trusted after a code.
  assert.equal(sessionPassedTotp('/sign-in/email', true), true);
  assert.equal(sessionPassedTotp('/sign-in/phone-number', true), true);
  assert.equal(sessionPassedTotp('/sign-in/email', false), false);
  // CF-0017: social and link sign-ins never count.
  for (const path of ['/callback/:id', '/sign-in/social', '/verify-email', '/phone-number/verify', '/two-factor/enable']) {
    assert.equal(sessionPassedTotp(path, true), false, path);
  }
  assert.equal(sessionPassedTotp(undefined, true), false);
});

test('mobile app requests are recognised', () => {
  assert.equal(isMobileRequest(new Headers({ 'expo-origin': 'carabaomobile://' })), true);
  assert.equal(isMobileRequest(new Headers({ origin: 'carabaomobile://' })), true);
  // The merchant app gets the same refusal (plan §6).
  assert.equal(isMobileRequest(new Headers({ 'expo-origin': 'carabaomerchant://' })), true);
  assert.equal(isMobileRequest(new Headers({ origin: 'carabaomerchant://' })), true);
  assert.equal(isMobileRequest(new Headers({ origin: 'exp://192.168.1.2:8081' })), true);
  assert.equal(isMobileRequest(new Headers({ origin: 'https://carabao.ph' })), false);
  assert.equal(isMobileRequest(new Headers()), false);
  assert.equal(isMobileRequest(undefined), false);
});
