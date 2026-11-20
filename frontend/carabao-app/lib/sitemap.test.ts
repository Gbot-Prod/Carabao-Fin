import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HELP_PATHS, buyerSitemap, helpSitemap } from './sitemap.ts';

// CF-0041
const BASE = 'https://carabao.online';

test('buyer sitemap: home, farm list, farms by id with lastModified', () => {
  const entries = buyerSitemap(BASE, [
    { id: 7, updated_at: '2026-11-12T03:04:05+00:00' },
    { id: 2, updated_at: '2026-11-15T00:00:00Z' },
  ]);
  assert.deepEqual(
    entries.map((e) => e.url),
    [`${BASE}/`, `${BASE}/farms`, `${BASE}/farms/2`, `${BASE}/farms/7`],
  );
  assert.equal(entries[2].lastModified?.toISOString(), '2026-11-15T00:00:00.000Z');
  assert.equal(entries[3].lastModified?.toISOString(), '2026-11-12T03:04:05.000Z');
  // Farm list takes the newest farm date; home has none.
  assert.equal(entries[1].lastModified?.toISOString(), '2026-11-15T00:00:00.000Z');
  assert.equal('lastModified' in entries[0], false);
});

test('buyer sitemap: missing or bad dates are left out, bad and duplicate ids dropped', () => {
  const entries = buyerSitemap(BASE, [
    { id: 3, updated_at: 'not a date' },
    { id: 3, updated_at: '2026-01-01T00:00:00Z' },
    { id: 4 },
    { id: 0 },
    { id: 1.5 },
  ]);
  assert.deepEqual(entries.map((e) => e.url), [`${BASE}/`, `${BASE}/farms`, `${BASE}/farms/3`, `${BASE}/farms/4`]);
  assert.ok(entries.every((e) => !('lastModified' in e)));
});

test('buyer sitemap with no farms still lists the two buyer pages', () => {
  assert.deepEqual(buyerSitemap(BASE, []).map((e) => e.url), [`${BASE}/`, `${BASE}/farms`]);
});

test('buyer sitemap lists listings after farms; bad and duplicate ids dropped (CF-0091)', () => {
  const entries = buyerSitemap(BASE, [{ id: 2 }], [9, 4, 9, 0, -1, 2.5]);
  assert.deepEqual(entries.map((e) => e.url), [
    `${BASE}/`,
    `${BASE}/farms`,
    `${BASE}/farms/2`,
    `${BASE}/listings/4`,
    `${BASE}/listings/9`,
  ]);
  assert.ok(entries.slice(3).every((e) => !('lastModified' in e) && e.priority === 0.7));
});

test('help sitemap lists every help page through the given URL builder', () => {
  const onHelpHost = helpSitemap((p) => new URL(p, 'https://help.carabao.online').toString());
  assert.deepEqual(
    onHelpHost.map((e) => e.url),
    ['https://help.carabao.online/', 'https://help.carabao.online/contact', 'https://help.carabao.online/terms', 'https://help.carabao.online/privacy'],
  );
  const oneHost = helpSitemap((p) => new URL(p === '/' ? '/help' : `/help${p}`, BASE).toString());
  assert.equal(oneHost[1].url, `${BASE}/help/contact`);
  assert.equal(onHelpHost.length, HELP_PATHS.length);
});

test('buyer sitemap uses the farm slug URL, the id only without a usable slug', () => {
  const entries = buyerSitemap(BASE, [
    { id: 1, shop_page: { slug: 'la-trinidad-highland' } },
    { id: 2, shop_page: null },
    { id: 3, shop_page: { slug: '12345' } },
  ]);
  assert.deepEqual(
    entries.map((e) => e.url),
    [`${BASE}/`, `${BASE}/farms`, `${BASE}/farms/la-trinidad-highland`, `${BASE}/farms/2`, `${BASE}/farms/3`],
  );
});
