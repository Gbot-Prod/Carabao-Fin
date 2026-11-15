// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNextPath } from './next-path.ts';

test('a path on this site is kept, with its query', () => {
  assert.equal(safeNextPath('/two-factor/enrol?token=abc_DEF-123'), '/two-factor/enrol?token=abc_DEF-123');
  assert.equal(safeNextPath('/order'), '/order');
});

test('anything else falls back to /', () => {
  for (const raw of [
    null,
    undefined,
    '',
    'https://evil.example/x',
    '//evil.example/x',
    '/\\evil.example',
    '/\tevil',
    'javascript:alert(1)',
    'order',
  ]) {
    assert.equal(safeNextPath(raw), '/', String(raw));
  }
});
