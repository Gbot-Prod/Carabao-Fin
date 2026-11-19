// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStrongPassword } from './password-policy.ts';

test('accepts a password with every kind of character', () => {
  assert.equal(isStrongPassword('Carabao1!'), true);
  assert.equal(isStrongPassword('Ñanay2024?'), true);
});

test('refuses a password that misses a rule', () => {
  assert.equal(isStrongPassword('Cara1!'), false, 'too short');
  assert.equal(isStrongPassword('carabao1!'), false, 'no uppercase');
  assert.equal(isStrongPassword('CARABAO1!'), false, 'no lowercase');
  assert.equal(isStrongPassword('Carabao!!'), false, 'no number');
  assert.equal(isStrongPassword('Carabao12'), false, 'no symbol');
  assert.equal(isStrongPassword('Carabao 12'), false, 'a space is not a symbol');
  assert.equal(isStrongPassword(`Aa1!${'x'.repeat(125)}`), false, 'too long');
});
