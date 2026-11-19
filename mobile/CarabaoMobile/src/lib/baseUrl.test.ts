/// <reference types="node" />
// Run with `npm test`. CF-0103.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBaseUrl } from './baseUrl.ts';

test('development allows http on localhost and LAN, and strips trailing slashes', () => {
  assert.equal(checkBaseUrl('X', 'http://localhost:8000', false), 'http://localhost:8000');
  assert.equal(checkBaseUrl('X', ' http://192.168.1.20:8000/ ', false), 'http://192.168.1.20:8000');
  assert.equal(checkBaseUrl('X', 'http://[::1]:3000//', false), 'http://[::1]:3000');
});

test('production refuses http and accepts https', () => {
  assert.throws(() => checkBaseUrl('EXPO_PUBLIC_API_URL', 'http://api.example.com', true), /must use https/);
  assert.throws(() => checkBaseUrl('X', 'http://localhost:8000', true), /must use https/);
  assert.equal(checkBaseUrl('X', 'https://api.example.com', true), 'https://api.example.com');
  assert.equal(checkBaseUrl('X', 'https://example.com/api/', true), 'https://example.com/api');
});

test('the scheme check is not fooled by case tricks or other schemes', () => {
  for (const bad of ['HTTP://api.example.com', 'ftp://api.example.com', 'javascript:alert(1)', 'api.example.com', '//api.example.com', '']) {
    assert.throws(() => checkBaseUrl('X', bad, false), /not a valid/, bad);
  }
});

test('credentials, query, fragment and spaces are refused', () => {
  for (const bad of [
    'https://user:pass@api.example.com',
    'https://evil.example@api.example.com',
    'https://api.example.com/?next=x',
    'https://api.example.com/#x',
    'https://api.exa mple.com',
    'https://api.example.com/a b',
  ]) {
    assert.throws(() => checkBaseUrl('X', bad, true), /not a valid/, bad);
  }
});

test('the error names the setting', () => {
  assert.throws(() => checkBaseUrl('EXPO_PUBLIC_WEB_URL', 'nope', false), /EXPO_PUBLIC_WEB_URL/);
});
