/// <reference types="node" />
// Run with `npm test`. CF-0130.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_URI_MAX, safeImageUri } from './imageUri.ts';

test('CF-0130 image uri: https links pass, trimmed', () => {
  assert.equal(safeImageUri(' https://pub-1.r2.dev/produce/7/a.webp '), 'https://pub-1.r2.dev/produce/7/a.webp');
  assert.equal(safeImageUri('https://cdn.example:8443/x.png?v=2'), 'https://cdn.example:8443/x.png?v=2');
  assert.equal(safeImageUri('https://cdn.example'), 'https://cdn.example');
});

test('CF-0130 image uri: other schemes, credentials and junk are refused', () => {
  for (const bad of [
    undefined, null, 42, ['https://a.b/c.png'], '', '   ',
    'http://cdn.example/a.png',
    'file:///data/user/0/app/secret.db',
    'content://com.android.contacts/photo',
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    'https://user:pass@cdn.example/a.png',
    'https://evil.example@cdn.example/a.png',
    'https://cdn.example/a b.png',
    'https://cdn.example/a\n.png',
    'https://cdn.example/a\b.png',
    '//cdn.example/a.png',
    '/uploads/a.png',
    `https://cdn.example/${'x'.repeat(IMAGE_URI_MAX)}`,
  ]) {
    assert.equal(safeImageUri(bad), null, JSON.stringify(bad));
  }
});

test('CF-0130 image uri: http only in a development build', () => {
  assert.equal(safeImageUri('http://192.168.1.5:9000/a.png', true), 'http://192.168.1.5:9000/a.png');
  assert.equal(safeImageUri('http://192.168.1.5:9000/a.png', false), null);
  assert.equal(safeImageUri('file:///a.png', true), null);
});
