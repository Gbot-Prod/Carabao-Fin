// Merchant copy of the web's lib/shop-slug.test.ts (S14: the screen builds a new shop's
// slug from its title, exactly as the web Shop tab does).
/// <reference types="node" />
// Run with `npm test`. CF-0053.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shopSlug } from './shopSlug.ts';
import { SHOP_SLUG_MAX, SHOP_SLUG_PATTERN } from './shopPage.ts';

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
    assert.match(slug, SHOP_SLUG_PATTERN);
  }
});

test('long titles are cut without a trailing dash', () => {
  const slug = shopSlug(`${'a'.repeat(79)} b c`, 'x');
  assert.ok(slug.length <= 80);
  assert.equal(SHOP_SLUG_MAX, 80);
  assert.match(slug, SHOP_SLUG_PATTERN);
  assert.equal(shopSlug('', ''), 'shop-1');
});

test('a title of only digits gets a farm- prefix (a bare number is a farm id)', () => {
  assert.equal(shopSlug('1990', 'x'), 'farm-1990');
  assert.equal(shopSlug('Farm 1990', 'x'), 'farm-1990');
  assert.equal(shopSlug('12 34', 'x'), '12-34');
});
