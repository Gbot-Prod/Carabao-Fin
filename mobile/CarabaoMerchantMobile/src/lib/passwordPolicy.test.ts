// Shared with mobile/CarabaoMobile/src/lib/passwordPolicy.test.ts. Keep both copies the same (sharedCopies.test.ts).
/// <reference types="node" />
// Run with `npm test`. CF-0106.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStrongPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './passwordPolicy.ts';

test('a password with all four kinds of character and 8-128 chars passes', () => {
  assert.equal(isStrongPassword('Abcdef1!'), true);
  assert.equal(isStrongPassword('Ñandú#2026'), true); // non-ASCII letters count
  assert.equal(isStrongPassword(`Aa1!${'x'.repeat(PASSWORD_MAX_LENGTH - 4)}`), true);
});

test('each missing kind of character fails', () => {
  assert.equal(isStrongPassword('abcdef1!'), false, 'no uppercase');
  assert.equal(isStrongPassword('ABCDEF1!'), false, 'no lowercase');
  assert.equal(isStrongPassword('Abcdefg!'), false, 'no digit');
  assert.equal(isStrongPassword('Abcdefg1'), false, 'no symbol');
  assert.equal(isStrongPassword('Abcdef1 '), false, 'a space is not a symbol');
});

test('length limits are inclusive', () => {
  assert.equal(isStrongPassword('Aa1!'.padEnd(PASSWORD_MIN_LENGTH - 1, 'x')), false);
  assert.equal(isStrongPassword('Aa1!'.padEnd(PASSWORD_MIN_LENGTH, 'x')), true);
  assert.equal(isStrongPassword('Aa1!'.padEnd(PASSWORD_MAX_LENGTH + 1, 'x')), false);
});
