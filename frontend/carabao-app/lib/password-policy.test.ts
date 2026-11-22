// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStrongAdminPassword, isStrongPassword } from './password-policy.ts';

test('admin rule: the same rule at 12+ characters', () => {
  assert.equal(isStrongAdminPassword('Carabao1!'), false, '9 characters');
  assert.equal(isStrongAdminPassword('Carabao2026!'), true);
  assert.equal(isStrongAdminPassword('carabao2026!'), false, 'no uppercase');
  assert.equal(isStrongAdminPassword(`Aa1!${'x'.repeat(125)}`), false, 'too long');
});

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
