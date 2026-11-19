/// <reference types="node" />
// Run with `npm test`. CF-0122.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  checkDeleteCode, codeRequestBody, confirmed, DELETE_CODE_MAX, DELETE_CODE_MIN, DELETE_PASSWORD_MAX, sentToText,
} from './accountDeletion.ts';

test('password: blank is null (no-password accounts), long is refused', () => {
  assert.deepEqual(codeRequestBody(''), { password: null });
  assert.deepEqual(codeRequestBody(' Secret1! '), { password: ' Secret1! ' }); // sent as typed
  assert.ok('error' in codeRequestBody('x'.repeat(DELETE_PASSWORD_MAX + 1)));
});

test('code: digits only, spaces removed, backend length', () => {
  assert.deepEqual(checkDeleteCode(' 123 456 '), { code: '123456' });
  for (const bad of ['', '123', '12a456', '12345678901']) assert.ok('error' in checkDeleteCode(bad), bad);
});

test('confirm word and where the code went', () => {
  assert.equal(confirmed(' delete '), true);
  assert.equal(confirmed('DELET'), false);
  assert.equal(sentToText('1234'), 'the number ending in 1234');
  assert.equal(sentToText('•••• 9876'), 'the number ending in 9876');
  assert.equal(sentToText(''), 'your mobile number');
});

test('bounds = backend schemas/user.py', () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const py = readFileSync(join(repo, 'backend/app/schemas/user.py'), 'utf8');
  assert.match(py, new RegExp(`password: str \\| None = Field\\(default=None, max_length=${DELETE_PASSWORD_MAX}\\)`));
  assert.match(py, new RegExp(`code: str = Field\\(min_length=${DELETE_CODE_MIN}, max_length=${DELETE_CODE_MAX}\\)`));
});
