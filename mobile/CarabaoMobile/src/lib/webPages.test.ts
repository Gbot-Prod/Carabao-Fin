/// <reference types="node" />
// Run with `npm test`. CF-0132.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WEB_PAGES, webPageUrl, type WebPage } from './webPages.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('CF-0132 known pages join to the web base', () => {
  assert.equal(webPageUrl('https://carabao.ph', 'help'), 'https://carabao.ph/help');
  assert.equal(webPageUrl('https://carabao.ph/', 'terms'), 'https://carabao.ph/help/terms');
  assert.equal(webPageUrl('http://localhost:3000//', 'privacy'), 'http://localhost:3000/help/privacy');
});

test('CF-0132 an unknown key is refused', () => {
  assert.throws(() => webPageUrl('https://carabao.ph', 'admin' as WebPage));
  assert.throws(() => webPageUrl('https://carabao.ph', '__proto__' as WebPage));
});

test('CF-0132 each path is a real web route (frontend app/(help))', () => {
  const app = join(here, '../../../../frontend/carabao-app/app/(help)');
  for (const path of Object.values(WEB_PAGES)) {
    assert.ok(existsSync(join(app, path, 'page.tsx')), `${path} has no page.tsx on the web`);
  }
});

test('CF-0132 Profile has no row that does nothing on tap', () => {
  const src = readFileSync(join(here, '../screens/ProfileScreen.tsx'), 'utf8');
  assert.doesNotMatch(src, /onPress=\{\(\)\s*=>\s*\{\s*\}\}/);
  assert.doesNotMatch(src, /No cards saved/);
});
