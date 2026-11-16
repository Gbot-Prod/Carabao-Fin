// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MERCHANT_PAGES, merchantPageForNotification } from './merchant-links.ts';
import { makeSurfaces } from './urls.ts';

test('the plain dashboard link opens the page for its kind', () => {
  assert.equal(merchantPageForNotification('/merchantDashboard', 'new_order'), '/sales');
  assert.equal(merchantPageForNotification('/merchantDashboard', 'chat_message'), '/sales');
  assert.equal(merchantPageForNotification('/merchantDashboard', 'review_received'), '/reviews');
  assert.equal(merchantPageForNotification('/merchantDashboard', 'payout_released'), '/earnings');
  assert.equal(merchantPageForNotification('/merchantDashboard/', 'payout_destination_changed'), '/earnings');
});

test('an unknown kind opens the dashboard', () => {
  assert.equal(merchantPageForNotification('/merchantDashboard', 'something_new'), '/');
});

test('other links are not changed here', () => {
  for (const link of [null, undefined, '', '/orders/5', '/admin/orders', '/merchantDashboard/routing/3', '/merchantDashboards']) {
    assert.equal(merchantPageForNotification(link, 'new_order'), null, String(link));
  }
});

test('every merchant page is served on merchant.<root>, not sent to the apex', () => {
  const s = makeSurfaces({ rootDomain: 'carabao.test', appSurface: 'public', appUrl: 'http://carabao.test:3000' });
  for (const path of Object.values(MERCHANT_PAGES)) {
    const probe = path === '/routing' ? '/routing/5' : path;
    const decision = s.route({ host: 'merchant.carabao.test:3000', pathname: probe, search: '' });
    const expected = probe === '/' ? '/merchant' : `/merchant${probe}`;
    assert.deepEqual(decision, { kind: 'rewrite', path: expected }, probe);
  }
});

test('notification pages are merchant pages', () => {
  const pages = new Set<string>(Object.values(MERCHANT_PAGES));
  for (const kind of ['new_order', 'chat_message', 'review_received', 'payout_released', 'payout_destination_changed']) {
    assert.ok(pages.has(merchantPageForNotification('/merchantDashboard', kind)!), kind);
  }
});
