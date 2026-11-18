import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shopSlug } from './shop-slug.ts';

const API_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// CF-0053
test('slugs always match the API pattern', () => {
  for (const [title, want] of [
    ['Dela Cruz Farm', 'dela-cruz-farm'],
    ['  Niño’s  Gulayan!! ', 'nino-s-gulayan'],
    ['Bukid ng Ñora', 'bukid-ng-nora'],
    ['🌽🌽', 'shop-abc123'],
    ['---', 'shop-abc123'],
  ] as const) {
    const slug = shopSlug(title, 'abc123');
    assert.equal(slug, want, title);
    assert.match(slug, API_PATTERN);
  }
});

test('long titles are cut without a trailing dash', () => {
  const slug = shopSlug(`${'a'.repeat(79)} b c`, 'x');
  assert.ok(slug.length <= 80);
  assert.match(slug, API_PATTERN);
  assert.equal(shopSlug('', ''), 'shop-1');
});
